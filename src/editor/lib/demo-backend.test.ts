import { afterEach, expect, test, vi } from "vitest";
import type { Manifest } from "../../manifest/types";
import { emptyBody } from "../../article-body";
import { validateDemoSelection } from "./demo-backend";
import { importImageUrl, importStockImage, uploadImage, uploadMedia } from "./images";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "demo" } }));
afterEach(() => vi.unstubAllGlobals());
const seed = (): Manifest => ({ backend: "demo", pages: [{ slug: "home", label: "Home", groups: [], values: { hero: { title: "Hello" } } }], collections: [{ name: "blog", label: "Blog", fields: [{ key: "title", label: "Title", type: "string", required: true }], posts: [{ slug: "hello", frontmatter: { title: "Hello" }, body: emptyBody() }] }], menus: { maxDepth: 3, entries: [{ slug: "main", title: "Main", items: [] }] }, schema: { objects: [], documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", fields: [{ key: "title", label: "Title", type: "string" }] }] }, documents: [{ id: "page:home", type: "page", slug: "home", data: { title: "Home" } }] });

test("demo validates copy, posts, documents and menus with no network or browser storage", () => {
  const fetch = vi.fn(() => { throw new Error("Unexpected fetch"); });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("localStorage", { getItem() { throw new Error("Unexpected storage"); }, setItem() { throw new Error("Unexpected storage"); } });
  vi.stubGlobal("sessionStorage", { getItem() { throw new Error("Unexpected storage"); }, setItem() { throw new Error("Unexpected storage"); } });
  const manifest = seed(), before = structuredClone(manifest);
  validateDemoSelection(manifest, { kind: "page", slug: "home" }, { hero: { title: "Changed" } }, "", false);
  validateDemoSelection(manifest, { kind: "post", collection: "blog", slug: "hello" }, { title: "Changed" }, emptyBody(), false);
  validateDemoSelection(manifest, { kind: "post", collection: "blog", slug: "new" }, { title: "New" }, emptyBody(), true);
  validateDemoSelection(manifest, { kind: "document", type: "page", id: "page:new" }, { title: "New" }, "", true);
  validateDemoSelection(manifest, { kind: "document", type: "page", id: "page:home" }, { title: "Changed" }, "", false);
  validateDemoSelection(manifest, { kind: "menu", slug: "main" }, { title: "Changed", items: [] }, "", false);
  expect(manifest).toEqual(before);
  expect(fetch).not.toHaveBeenCalled();
});

test("demo preserves validation and create/update isolation", () => {
  const manifest = seed();
  expect(() => validateDemoSelection(manifest, { kind: "post", collection: "blog", slug: "new" }, { title: "" }, emptyBody(), true)).toThrow();
  expect(() => validateDemoSelection(manifest, { kind: "post", collection: "blog", slug: "hello" }, { title: "New" }, emptyBody(), true)).toThrow();
  expect(() => validateDemoSelection(manifest, { kind: "document", type: "page", id: "page:missing" }, { title: "New" }, "", false)).toThrow();
  expect(() => validateDemoSelection({ ...manifest, backend: "github" }, { kind: "page", slug: "home" }, {}, "", false)).toThrow();
});

test("all demo upload/import paths reject before any fetch or Unsplash tracking", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(uploadImage(new Blob(["image"]))).rejects.toThrow(/read-only/);
  await expect(uploadMedia(new File(["image"], "photo.png"))).rejects.toThrow(/read-only/);
  await expect(importImageUrl("https://example.com/photo.png")).rejects.toThrow(/read-only/);
  await expect(importStockImage({ source: "unsplash", id: "photo", url: "https://images.unsplash.com/photo", thumb: "", credit: "" })).rejects.toThrow(/read-only/);
  expect(fetch).not.toHaveBeenCalled();
});
