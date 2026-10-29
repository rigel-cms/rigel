import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { transpileModule } from "typescript";
import { compile } from "svelte/compiler";
import { contentForLocale, selectionInContent } from "../manifest/content-locales";
import type { Manifest } from "../manifest/types";
import { slugify, validateDocumentSlugs } from "../slugs";
import { newDocumentFromTemplate } from "../schema/paths";
import { systemMessage } from "./i18n/format";

const source = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
function editor(manifest: Manifest, selection: unknown, dirty = true) {
  const functions = ["requestNavigation", "cancelNavigation", "focusContentLocale", "switchContentLocale", "saveAndLeave", "discardAndLeave", "newPage"].map(name => {
    const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
    expect(start).toBeGreaterThan(0);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  }).join("\n");
  const code = transpileModule(functions, { compilerOptions: { target: 99 } }).outputText;
  return new Function("manifest", "sel", "dirty", "contentForLocale", "selectionInContent", "slugify", "validateDocumentSlugs", "newDocumentFromTemplate", "$t", `
    let contentLocale = 'en', selectedContentLocale = 'en', localeControlRevision = 0;
    let pendingNavigation = null, pendingNavigationCancel = null, publishOpen = false, publishBusy = false, saveState = 'idle';
    let newEntry = null, newDocument = null, succeeds = true, saves = 0;
    let draft = { title: 'Unsaved edits' }, docBase = null, actionDialog = null;
    const schema = manifest.schema, pageDocType = schema?.documents[0];
    const focused = [];
    const tick = async () => {};
    const document = { querySelector: selector => ({ focus: options => focused.push({ selector, options }) }) };
    async function save() { saves++; if (succeeds) dirty = false; return succeeds; }
    function openSelection(next) { sel = next; dirty = false; }
    ${code}
    return { switchContentLocale, saveAndLeave, discardAndLeave,
      cancel: cancelNavigation, failSave() { succeeds = false; }, focused,
      navigate() { requestNavigation(() => openSelection(null)); },
      create(type, title) { newPage(schema.documents.find(entry => entry.name === type)); actionDialog.onconfirm(title); },
      created() { return newDocument; },
      state() { return { locale: selectedContentLocale, sel, dirty, pending: !!pendingNavigation, saves, draft }; }
    };
  `)(manifest, selection, dirty, contentForLocale, selectionInContent, slugify, validateDocumentSlugs, newDocumentFromTemplate, systemMessage);
}
const manifest: Manifest = {
  contentLocales: { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] },
  pages: [{ slug: "home", label: "Home", locale: "en", groups: [], values: {} }, { slug: "shared", label: "Shared", groups: [], values: {} }],
};

test("selector compiles, only appears when opted in, and search uses the same filtered content", () => {
  expect(() => compile(source, { filename: "App.svelte", generate: "client" })).not.toThrow();
  expect(source).toContain('manifest.contentLocales && manifest.contentLocales.locales.length > 1');
  expect(source).toContain('<TopBar manifest={visibleContent}');
  expect(source).toContain('label={$t("shell.contentLanguage")}');
  expect(source).toContain('value={contentLocale}');
  expect(source).toContain('{#key localeControlRevision}');
});

test("cancel keeps locale, selection and edits with no writes and restores the remounted selector", async () => {
  const app = editor(manifest, { kind: "page", slug: "home" });
  const before = app.state();
  app.switchContentLocale("fr");
  expect(app.state()).toEqual({ ...before, pending: true });
  app.cancel();
  await Promise.resolve();
  expect(app.state()).toEqual(before);
  expect(app.focused).toEqual([{ selector: ".content-language button[role=combobox]", options: { preventScroll: true } }]);
  expect(source).toContain('oncancel={cancelNavigation}');
  const dialog = readFileSync(new URL("./lib/UnsavedChanges.svelte", import.meta.url), "utf8");
  expect(dialog.match(/onclick=\{oncancel\}/g)).toHaveLength(2);
  expect(dialog).toContain('if (!busy) oncancel();');
});

test("cancelling other navigation never redirects focus to the language selector", async () => {
  const app = editor(manifest, { kind: "page", slug: "home" });
  app.switchContentLocale("fr");
  app.cancel();
  await Promise.resolve();
  app.focused.length = 0;
  app.navigate();
  app.cancel();
  await Promise.resolve();
  expect(app.focused).toEqual([]);
  expect(app.state()).toMatchObject({ locale: "en", sel: { kind: "page", slug: "home" }, dirty: true, pending: false, saves: 0 });
});

test("failed save keeps edits and locale; successful save switches and safely leaves hidden content", async () => {
  const app = editor(manifest, { kind: "page", slug: "home" });
  app.switchContentLocale("fr");
  app.failSave();
  await app.saveAndLeave();
  expect(app.state()).toMatchObject({ locale: "en", sel: { kind: "page", slug: "home" }, dirty: true, pending: true, saves: 1, draft: { title: "Unsaved edits" } });
  const saved = editor(manifest, { kind: "page", slug: "home" });
  saved.switchContentLocale("fr");
  await saved.saveAndLeave();
  expect(saved.state()).toMatchObject({ locale: "fr", sel: null, dirty: false, pending: false, saves: 1 });
});

test("discard switches without saving; shared selection remains available", () => {
  const app = editor(manifest, { kind: "page", slug: "home" });
  app.switchContentLocale("fr");
  app.discardAndLeave();
  expect(app.state()).toMatchObject({ locale: "fr", sel: null, dirty: false, pending: false, saves: 0 });
  const shared = editor(manifest, { kind: "page", slug: "shared" }, false);
  shared.switchContentLocale("fr");
  expect(shared.state()).toMatchObject({ locale: "fr", sel: { kind: "page", slug: "shared" }, pending: false, saves: 0 });
});

const pages: Manifest = {
  pages: [],
  schema: { objects: [], documents: ["pageEn", "pageFr"].map(name => ({
    name, title: name, type: "document", folder: name, fields: [],
  })) },
  documents: [{ id: "pageEn:home", type: "pageEn", slug: "home", data: { slug: "home" } }],
  preview: { documents: { pageEn: { url: "/{slug}/" }, pageFr: { url: "/fr/{slug}/" } } },
};

test.each([false, true])("new documents allow duplicate slugs in distinct namespaces (locales configured: %s)", locales => {
  const app = editor({ ...pages, ...(locales ? { contentLocales: manifest.contentLocales } : {}) }, null, false);
  app.create("pageFr", "Home");
  expect(app.created()).toEqual({ type: "pageFr", id: "pageFr:home", slug: "home" });
  expect(app.state().draft.slug).toBe("home");
});

test("new documents reject same-type storage IDs and actual public route collisions", () => {
  expect(() => editor(pages, null).create("pageEn", "Home")).toThrow("shell.slugAlreadyUsed");
  const overridden = { ...pages, documents: [{ ...pages.documents![0], data: { slug: "renamed" } }] };
  expect(() => editor(overridden, null).create("pageEn", "Home")).toThrow("shell.slugAlreadyUsed");
  expect(() => editor(overridden, null).create("pageEn", "Renamed")).toThrow(/already used/);
  expect(() => editor({ ...pages, preview: undefined }, null).create("pageFr", "Home")).toThrow(/already used/);
  expect(() => editor({ ...pages, preview: { documents: { ...pages.preview!.documents, pageFr: { url: "/fr/{slug}/", index: "/home/" } } } }, null).create("pageFr", "Home")).toThrow(/already used/);
});

test("new documents compare fixed legacy copy public routes, not stored slugs or templates", () => {
  const legacy = { slug: "home", label: "Home", groups: [], values: {} };
  const app = editor({ ...pages, pages: [legacy], preview: { ...pages.preview, pages: { home: "/legacy-home/" } } }, null);
  expect(() => app.create("pageFr", "Home")).not.toThrow();
  const copy = { ...legacy, slug: "copy" };
  expect(() => editor({ ...pages, pages: [copy], preview: { ...pages.preview, pages: { copy: "/fr/home/" } } }, null).create("pageFr", "Home")).toThrow(/already used/);
  expect(() => editor({ ...pages, pages: [copy], preview: { ...pages.preview, pages: { copy: { url: "/other/", template: "/fr/home/" } } } }, null).create("pageFr", "Home")).not.toThrow();
});
