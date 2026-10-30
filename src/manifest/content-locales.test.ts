import { expect, test } from "vitest";
import { parseConfig, type ContentLocalesConfig } from "../config";
import type { Manifest } from "./types";
import { contentForLocale, selectionInContent, validateContentLocale } from "./content-locales";
import { buildSidebar } from "./navigation";

const contentLocales: ContentLocalesConfig = { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] };
const fields = [{ key: "title", label: "Title", type: "string" as const }];
const documents = [
  { name: "pageEn", title: "English pages", type: "document" as const, folder: "pages/en", locale: "en", fields },
  { name: "landingEn", title: "English landing pages", type: "document" as const, folder: "landings", locale: "en", fields },
  { name: "pageFr", title: "French pages", type: "document" as const, folder: "pages/fr", locale: "fr", fields },
  { name: "shared", title: "Shared", type: "document" as const, folder: "shared", shared: true, fields },
  { name: "settingsFr", title: "French settings", type: "document" as const, folder: "settings/fr", shared: true, singleton: true, locale: "fr", fields },
  { name: "service", title: "Service pages", type: "document" as const, folder: "pages/de", fields },
];
const source: Manifest = {
  contentLocales,
  pages: [{ slug: "home", label: "Home", locale: "en", groups: [], values: {} }, { slug: "accueil", label: "Accueil", locale: "fr", category: "French", groups: [], values: {} }, { slug: "global", label: "Global", shared: true, groups: [], values: {} }],
  collections: [{ name: "blogEn", label: "Blog EN", locale: "en", fields: [], posts: [] }, { name: "blogFr", label: "Blog FR", locale: "fr", fields: [], posts: [] }, { name: "news", label: "News", fields: [], posts: [] }],
  schema: { objects: [], documents },
  documents: documents.map(type => ({ id: type.name + ":home", type: type.name, slug: "home", data: { title: type.title } })),
  menus: { maxDepth: 3, entries: [] },
};

test("content locales are separate from editor languages and copied without normalization", () => {
  const cfg = parseConfig({ contentLocales, languages: ["es"] });
  expect(cfg.languages).toEqual(["en", "es"]);
  expect(cfg.contentLocales).toEqual(contentLocales);
  expect(cfg.contentLocales).not.toBe(contentLocales);
  expect(cfg.contentLocales!.locales[0]).not.toBe(contentLocales.locales[0]);
  expect(parseConfig().contentLocales).toBeUndefined();
  expect(parseConfig({ contentLocales: { defaultLocale: "pt-BR", locales: [{ code: "pt-BR", label: "Português" }] } }).contentLocales!.defaultLocale).toBe("pt-BR");
});

test.each([null, {}, { defaultLocale: "en", locales: [] }, { ...contentLocales, defaultLocale: "de" }, { ...contentLocales, locales: [{ code: "en", label: " " }] }, { ...contentLocales, locales: [{ code: "en_US", label: "English" }] }, { ...contentLocales, locales: [{ code: "en", label: "English" }, { code: "EN", label: "Duplicate" }] }, { ...contentLocales, locales: [null] }])("rejects malformed content locales %j", value => {
  expect(() => parseConfig({ contentLocales: value as ContentLocalesConfig })).toThrow(/contentLocales/);
});

test("rejects invalid or unknown annotations on document types, collections and copy pages", () => {
  for (const locale of ["de", "", "en_US", null, 42]) {
    expect(() => parseConfig({ contentLocales, schema: { objects: [], documents: [{ ...documents[0], locale: locale as string }] } })).toThrow(/content locale/);
    expect(() => parseConfig({ contentLocales, collections: [{ name: "blog", folder: "blog", fields: [], locale: locale as string }] })).toThrow(/content locale/);
    expect(() => validateContentLocale(locale, contentLocales, "copy")).toThrow(/content locale/);
  }
  expect(() => validateContentLocale(undefined, contentLocales, "copy")).not.toThrow();
});

test("filters all content discovery together, without changing documents or inferring from folders", () => {
  const before = structuredClone(source);
  const en = contentForLocale(source, undefined), fr = contentForLocale(source, "fr");
  expect(en.pages.map(page => page.slug)).toEqual(["home", "global"]);
  expect(fr.pages.map(page => page.slug)).toEqual(["accueil", "global"]);
  expect(en.schema!.documents.map(type => type.name)).toEqual(["pageEn", "landingEn", "shared", "service"]);
  expect(fr.schema!.documents.map(type => type.name)).toEqual(["pageFr", "shared", "settingsFr", "service"]);
  expect(fr.documents!.map(doc => doc.type)).toEqual(["pageFr", "shared", "settingsFr", "service"]);
  expect(fr.collections!.map(collection => collection.name)).toEqual(["blogFr", "news"]);
  expect(en.menus).toBe(source.menus);
  expect(fr.documents![0]).toBe(source.documents![2]);
  expect(source).toEqual(before);
  const links = buildSidebar(en).filter(node => node.kind === "link");
  expect(links.map(node => node.label)).toEqual(["Pages", "Blog EN", "News", "Shared", "Global", "Menus", "Media"]);
  const custom = contentForLocale({ ...source, sidebar: [{ kind: "link", target: { kind: "documents", type: "pageFr" } }, { kind: "link", target: { kind: "document", type: "settingsFr", id: "settingsFr:home" } }, { kind: "link", target: { kind: "page", slug: "accueil" } }] }, "en");
  expect(buildSidebar(custom).filter(node => node.kind === "link").map(node => node.label)).toEqual(links.map(node => node.label));
});

test("destination selection checks retain shared/media/aggregate content but reject other locales", () => {
  const fr = contentForLocale(source, "fr");
  for (const selection of [null, { kind: "media" }, { kind: "menus" }, { kind: "pages" }, { kind: "documents", type: "shared" }, { kind: "document", type: "pageFr", id: "pageFr:new" }, { kind: "page", slug: "global" }] as const) expect(selectionInContent(fr, selection)).toBe(true);
  for (const selection of [{ kind: "documents", type: "pageEn" }, { kind: "document", type: "pageEn", id: "pageEn:home" }, { kind: "collection", name: "blogEn" }, { kind: "post", collection: "blogEn", slug: "post" }, { kind: "page", slug: "home" }, { kind: "pages", category: "missing" }] as const) expect(selectionInContent(fr, selection)).toBe(false);
});

test("disabled content locales preserve the exact manifest and navigation, including dormant annotations", () => {
  const { contentLocales: ignored, ...disabled } = source;
  expect(contentForLocale(disabled, "fr")).toBe(disabled);
  expect(contentForLocale(disabled, undefined)).toBe(disabled);
  expect(buildSidebar(contentForLocale(disabled, "fr"))).toEqual(buildSidebar(disabled));
  expect(parseConfig({ schema: { objects: [], documents } }).schema!.documents).toHaveLength(documents.length);
});
