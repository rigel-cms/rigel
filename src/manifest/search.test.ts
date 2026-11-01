import { expect, test } from "vitest";
import { parseConfig, type RigelConfig } from "../config";
import type { Manifest } from "./types";
import { effectiveSearchScope, searchIndex } from "./search";
import { emptyBody } from "../article-body";

const manifest: Manifest = {
  contentLocales: { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] },
  pages: ["en", "fr"].map(locale => ({ slug: `legacy-${locale}`, label: "Same", locale, groups: [], values: {} })),
  schema: { objects: [], documents: ["en", "fr", undefined].map(locale => ({ name: locale ?? "shared", title: "Pages", type: "document", folder: locale ?? "shared", locale, fields: [] })) },
  documents: ["en", "fr", "shared"].map(type => ({ id: `${type}:home`, type, slug: "home", data: { title: "Same" } })),
  collections: ["en", "fr", undefined].map(locale => ({ name: `blog-${locale ?? "shared"}`, label: "Blog", locale, fields: [], posts: [{ slug: "same", frontmatter: { title: "Same" }, body: emptyBody() }] })),
  menus: { maxDepth: 3, entries: [{ slug: "main", title: "Same", items: [] }] },
};
const t = (key: string) => key;

test.each([undefined, null, {}, { scope: "invalid" }, { scope: 1 }, { scope: "all" }])("invalid or absent developer search config falls back to all: %j", search => {
  expect(parseConfig({ search } as unknown as Partial<RigelConfig>).search).toEqual({ scope: "all" });
});

test("scope resolves explicit overrides, inheritance and invalid preferences without UI language", () => {
  expect(parseConfig({ search: { scope: "currentLocale" } }).search).toEqual({ scope: "currentLocale" });
  for (const override of [undefined, null, "inherit", false, {}, "invalid"]) expect(effectiveSearchScope({ scope: "currentLocale" }, override)).toBe("currentLocale");
  expect(effectiveSearchScope({ scope: "currentLocale" }, "all")).toBe("all");
  expect(effectiveSearchScope({ scope: "all" }, "currentLocale")).toBe("currentLocale");
  expect(effectiveSearchScope(undefined, undefined)).toBe("all");
});

test("all resource kinds use stable target identities, real locale metadata and shared resources once", () => {
  const index = searchIndex(manifest, "all", "en", t);
  expect(index).toHaveLength(13);
  expect(new Set(index.map(hit => hit.id)).size).toBe(index.length);
  expect(index.filter(hit => hit.label === "Same")).toHaveLength(9);
  expect(index.find(hit => hit.selection.kind === "document" && hit.selection.type === "fr")).toMatchObject({ language: "Français", locale: "fr", selection: { kind: "document", type: "fr", id: "fr:home" } });
  expect(index.filter(hit => hit.selection.kind === "document" && hit.selection.type === "shared")).toHaveLength(1);
  expect(index.filter(hit => hit.selection.kind === "menu")).toHaveLength(1);
  expect(index.find(hit => hit.selection.kind === "menu")?.language).toBeUndefined();
  expect(searchIndex({ ...manifest, documents: [...manifest.documents!, ...manifest.documents!] }, "all", "fr", t)).toEqual(index);
});

test.each(["en", "fr"])("current locale %s includes only selected and shared resources", locale => {
  const index = searchIndex(manifest, "currentLocale", locale, t);
  expect(index).toHaveLength(9);
  expect(index.every(hit => !hit.locale || hit.locale === locale)).toBe(true);
  expect(index.filter(hit => hit.selection.kind === "menu")).toHaveLength(1);
  expect(index.some(hit => hit.selection.kind === "document" && hit.selection.type === "shared")).toBe(true);
});

test("single-language and unconfigured sites keep results without language badges", () => {
  for (const contentLocales of [undefined, { defaultLocale: "en", locales: [{ code: "en", label: "English" }] }]) {
    const content = { ...manifest, contentLocales };
    expect(searchIndex(content, "all", "en", t)).toHaveLength(13);
    expect(searchIndex(content, "all", "en", t).every(hit => !hit.language)).toBe(true);
    if (!contentLocales) expect(searchIndex(content, "currentLocale", "en", t)).toEqual(searchIndex(content, "all", "en", t));
  }
});
