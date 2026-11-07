import { expect, test } from "vitest";
import type { Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import { selectionHash, resolveHash, createHashNavigation } from "./hash-navigation";

const manifest: Manifest = {
  pages: [{ slug: "old/about", label: "About", groups: [], values: {} }],
  schema: { objects: [], documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", fields: [] }] },
  documents: [{ type: "page", id: "page:about", slug: "about", data: {} }],
  collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "hello", frontmatter: {}, body: { root: { type: "root", version: 1, children: [], direction: null, format: "", indent: 0 } } }] }],
  menus: { maxDepth: 3, entries: [{ slug: "footer", title: "Footer", items: [] }] },
};

test("editor locations round-trip through encoded hash paths", () => {
  const selections: (Selection | null)[] = [null, { kind: "pages" }, { kind: "page", slug: "old/about" },
    { kind: "documents", type: "page" }, { kind: "document", type: "page", id: "page:about" },
    { kind: "collection", name: "blog" }, { kind: "post", collection: "blog", slug: "hello" },
    { kind: "menus" }, { kind: "menu", slug: "footer" }, { kind: "media" }];
  for (const selection of selections) expect(resolveHash(selectionHash(selection), manifest)).toEqual({ selection, locale: undefined });
  expect(selectionHash({ kind: "document", type: "page", id: "page:about" })).toBe("#/pages/about");
  expect(selectionHash({ kind: "page", slug: "old/about" })).toBe("#/copy/old%2Fabout");
});

test("readable document paths retain storage identity and old links still resolve", () => {
  const content: Manifest = { ...manifest,
    schema: { objects: [], documents: [...manifest.schema!.documents, ...["logoSet", "menus", "pages", "content"].map(name => ({ name, title: name, type: "document" as const, folder: name, fields: [] }))] },
    documents: [...manifest.documents!, ...["logoSet", "menus", "pages", "content"].map(type => ({ type, id: `${type}:brands`, slug: "brands", data: { slug: "edited-public-slug" } }))],
  };
  for (const type of ["logoSet", "menus", "pages", "content"]) {
    const selection: Selection = { kind: "document", type, id: `${type}:brands` };
    expect(resolveHash(selectionHash(selection), content).selection).toEqual(selection);
    expect(resolveHash(selectionHash({ kind: "documents", type }), content).selection).toEqual({ kind: "documents", type });
  }
  expect(selectionHash({ kind: "document", type: "logoSet", id: "logoSet:brands" })).toBe("#/logoSet/brands");
  expect(selectionHash({ kind: "document", type: "menus", id: "menus:brands" })).toBe("#/content/menus/brands");
  expect(resolveHash("#/documents/page/page%3Aabout", content).selection).toEqual({ kind: "document", type: "page", id: "page:about" });
  expect(resolveHash("#/pages/old%2Fabout", content).selection).toEqual({ kind: "page", slug: "old/about" });
});

test("unresolvable or malformed locations fall back to Welcome", () => {
  for (const hash of ["#/pages/missing", "#/documents/page/missing", "#/documents/other/page%3Aabout", "#/collections/blog/missing", "#/collections/missing", "#/menus/missing", "#/media/extra", "#/pages/%ZZ", "#/pages/%00", "#garbage", "#/documents/page/page%3Aabout/extra"]) {
    expect(resolveHash(hash, manifest)).toEqual({ selection: null, locale: undefined });
  }
  expect(resolveHash("#/menus", { pages: [] }).selection).toBeNull();
});

test("content locale and page category survive links without exposing foreign entries", () => {
  const localized: Manifest = { ...manifest,
    contentLocales: { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "French" }] },
    pages: [...manifest.pages, { slug: "fr", label: "French", locale: "fr", category: "Équipe & news", groups: [], values: {} }],
  };
  const selection: Selection = { kind: "pages", category: "Équipe & news" };
  expect(resolveHash(selectionHash(selection, "fr"), localized)).toEqual({ selection, locale: "fr" });
  expect(resolveHash("#/pages/fr?locale=fr", localized)).toEqual({ selection: { kind: "page", slug: "fr" }, locale: "fr" });
  expect(resolveHash("#/pages/fr?locale=en", localized)).toEqual({ selection: null, locale: "en" });
  expect(resolveHash("#/pages?locale=unknown", localized)).toEqual({ selection: null, locale: "en" });
});

function browser() {
  const events = new EventTarget();
  const entries = [{ hash: "", state: {} as Record<string, unknown> }];
  let position = 0;
  const location = { pathname: "/rigel/", search: "?host=kept", get hash() { return entries[position].hash; } };
  const history = {
    get state() { return entries[position].state; },
    replaceState(state: Record<string, unknown>, _: string, url: string) { entries[position] = { state, hash: new URL(url, "https://example.test").hash }; },
    pushState(state: Record<string, unknown>, _: string, url: string) { entries.splice(++position); entries.push({ state, hash: new URL(url, "https://example.test").hash }); },
    go(delta: number) { queueMicrotask(() => { if (position + delta < 0 || position + delta >= entries.length) return; position += delta; events.dispatchEvent(new Event("popstate")); events.dispatchEvent(new Event("hashchange")); }); },
  };
  return { history, location, dispatchEvent: events.dispatchEvent.bind(events), addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events) } as unknown as Window;
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test("Back and Forward retain their entries after cancelling guarded navigation", async () => {
  const win = browser();
  const opened: string[] = [];
  let dirty = false, pending: (() => void) | undefined;
  const navigation = createHashNavigation(hash => opened.push(hash), action => { pending = action; }, () => dirty, win);
  navigation.write("#/pages");
  navigation.write("#/media");
  win.history.go(-1);
  await settle();
  expect(opened).toEqual(["#/pages"]);
  dirty = true;
  win.history.go(1);
  await settle();
  expect(win.location.hash).toBe("#/pages");
  expect(opened).toEqual(["#/pages"]);
  expect(pending).toBeTypeOf("function");
  pending = undefined;
  win.history.go(1);
  await settle();
  pending!();
  await settle();
  expect(win.location.hash).toBe("#/media");
  expect(opened).toEqual(["#/pages", "#/media"]);
  dirty = false;
  win.history.go(-1);
  await settle();
  expect(win.location.hash).toBe("#/pages");
  navigation.destroy();
});

test("manual hash edits are guarded, invalid hashes can be replaced, and listeners clean up", async () => {
  const win = browser();
  const opened: string[] = [];
  let pending: (() => void) | undefined;
  const navigation = createHashNavigation(hash => {
    opened.push(hash);
    if (hash === "#/invalid") navigation.write("", true);
  }, action => { pending = action; }, () => true, win);
  navigation.write("#/pages");
  win.history.pushState(null, "", "/rigel/?host=kept#/invalid");
  win.dispatchEvent(new Event("hashchange"));
  await settle();
  expect(win.location.hash).toBe("#/pages");
  expect(pending).toBeTypeOf("function");
  pending!();
  await settle();
  expect(win.location.hash).toBe("");
  navigation.destroy();
  win.history.go(-1);
  await settle();
  expect(opened).toEqual(["#/invalid"]);
});
