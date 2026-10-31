import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { transpileModule } from "typescript";
import { contentForLocale, selectionInContent } from "../manifest/content-locales";
import { buildSidebar, validateSidebar, type Selection } from "../manifest/navigation";
import type { Manifest } from "../manifest/types";
import { validateSchema } from "../schema/validate";
import type { DocumentDef } from "../schema/types";
import { effectiveSlug } from "../slugs";
import { previewPath } from "../preview";

const fields = [{ key: "title", label: "Title", type: "string" as const }];
const types: DocumentDef[] = [
  { name: "articleEn", title: "Articles EN", type: "document", folder: "articles/en", locale: "en", category: "Articles", fields },
  { name: "articleFr", title: "Articles FR", type: "document", folder: "articles/fr", locale: "fr", category: "Articles", fields },
  { name: "announcement", title: "Announcements", type: "document", folder: "announcements", locale: "fr", category: "Announcements", fields },
  { name: "page", title: "Pages", type: "document", folder: "pages", fields },
  { name: "shared", title: "Shared", type: "document", folder: "shared", shared: true, category: "Globals", fields },
  { name: "settings", title: "Settings", type: "document", folder: "settings", shared: true, singleton: true, category: "Globals", fields },
];
const manifest: Manifest = {
  contentLocales: { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] },
  pages: [
    { slug: "legacy", label: "A legacy article", category: "Articles", groups: [], values: {} },
    { slug: "home", label: "Home", groups: [], values: {} },
    { slug: "footer", label: "Footer", shared: true, category: "Globals", groups: [], values: {} },
  ],
  schema: { objects: [], documents: types },
  documents: types.map(type => ({ id: `${type.name}:stored`, type: type.name, slug: "stored", data: { title: type.title, slug: `${type.name.toLowerCase()}-url`, draft: type.name === "articleFr", category: "Ignored data" } })),
};
const source = readFileSync(new URL("./App.svelte", import.meta.url), "utf8");
function list(locale: string, category?: string, sortBy = "", sortDir = 1, manifestSource = manifest) {
  const visibleContent = contentForLocale(manifestSource, locale);
  const start = source.indexOf("  const sortedPages = $derived.by(() => {");
  const end = source.indexOf("\n  function documentCell", start);
  expect(start).toBeGreaterThan(0);
  const code = transpileModule(source.slice(start, end).replace("$derived.by", "run"), { compilerOptions: { target: 99 } }).outputText;
  return new Function("visibleContent", "pageCategory", "sortBy", "sortDir", "effectiveSlug", "manifest", "previewPath", `
    const docTypes = visibleContent.schema.documents;
    const pageDocuments = visibleContent.documents.filter(doc => docTypes.some(type => type.name === doc.type && !type.shared));
    const run = fn => fn();
    ${code}
    return sortedPages;
  `)(visibleContent, category, sortBy, sortDir, effectiveSlug, manifestSource, previewPath) as { path: string | null; slug: string; title: string; category?: string; draft: boolean; target: Selection }[];
}

test("Pages derive sortable public paths from locale mappings, not preview templates or filenames", () => {
  const configured: Manifest = { ...manifest, preview: {
    draftUrl: "https://preview.example.com/", liveUrl: "https://example.com/",
    pages: { home: "/", legacy: "/archive/" },
    documents: {
      articleEn: { url: "/articles/{slug}/", template: "/rigel/preview/article/" },
      articleFr: { url: "/fr/articles/{slug}/", template: "/rigel/preview/article/" },
    },
  } };
  for (const locale of ["en", "fr"]) {
    const rows = list(locale, undefined, "path", 1, configured);
    expect(rows.find(row => row.title === "Home")?.path).toBe("/");
    expect(rows.find(row => row.title === "A legacy article")?.path).toBe("/archive/");
    expect(rows.find(row => row.title === `Articles ${locale.toUpperCase()}`)?.path).toBe(`${locale === "fr" ? "/fr" : ""}/articles/article${locale}-url/`);
    expect(rows.find(row => row.title === "Pages")?.path).toBeNull();
    const paths = rows.map(row => row.path ?? "");
    expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
    expect(list(locale, undefined, "path", -1, configured).map(row => row.path ?? "")).toEqual([...paths].reverse());
  }
});

test("document categories are optional fixed non-empty strings without normalization", () => {
  for (const category of [undefined, "Articles", " Articles traduits "]) {
    const schema = { objects: [], documents: [{ ...types[0], category }] };
    expect(validateSchema(schema).documents[0].category).toBe(category);
  }
  for (const category of ["", "  ", null, 42, [], {}]) {
    expect(() => validateSchema({ objects: [], documents: [{ ...types[0], category: category as string }] })).toThrow(/category must be a non-empty string/);
  }
});

test("default and configured sidebar categories merge legacy and native types in the active locale", () => {
  const custom = { kind: "link" as const, target: { kind: "pages" as const, category: "Articles" }, label: "Our articles", icon: "folder" };
  expect(() => validateSidebar([custom])).not.toThrow();
  for (const locale of ["en", "fr"]) {
    const visible = contentForLocale(manifest, locale);
    const categories = buildSidebar(visible).flatMap(node => node.kind === "link" && node.target.kind === "pages" && node.target.category ? [node.label] : []);
    expect(categories).toEqual(locale === "en" ? ["Articles"] : ["Announcements", "Articles"]);
    const configured = buildSidebar({ ...visible, sidebar: [custom] });
    expect(configured[0]).toEqual(custom);
    expect(configured.filter(node => node.kind === "link" && node.target.kind === "pages" && node.target.category === "Articles")).toHaveLength(1);
    expect(selectionInContent(visible, { kind: "pages", category: "Articles" })).toBe(true);
    expect(selectionInContent(visible, { kind: "pages", category: "Globals" })).toBe(false);
    expect(selectionInContent(visible, { kind: "pages", category: "Announcements" })).toBe(locale === "fr");
    expect(configured.some(node => node.kind === "link" && node.target.kind === "documents" && node.target.type === "shared")).toBe(true);
    expect(configured.some(node => node.kind === "link" && node.target.kind === "document" && node.target.type === "settings")).toBe(true);
  }
  const empty = { ...manifest, pages: [], documents: [] };
  expect(selectionInContent(contentForLocale(empty, "en"), { kind: "pages", category: "Articles" })).toBe(true);
  expect(buildSidebar(contentForLocale(empty, "en")).some(node => node.kind === "link" && node.target.kind === "pages" && node.target.category === "Articles")).toBe(true);
  expect(selectionInContent(contentForLocale(empty, "en"), { kind: "pages", category: "Announcements" })).toBe(false);
});

test("native category rows share legacy lists, sorting, draft status and document targets without leaking locales or shared records", () => {
  for (const locale of ["en", "fr"]) {
    const articles = list(locale, "Articles");
    expect(articles.map(row => row.title)).toEqual(["A legacy article", locale === "en" ? "Articles EN" : "Articles FR"]);
    expect(articles[1]).toEqual({ path: null, slug: `article${locale}-url`, title: locale === "en" ? "Articles EN" : "Articles FR", category: "Articles", draft: locale === "fr", target: { kind: "document", type: locale === "en" ? "articleEn" : "articleFr", id: `article${locale === "en" ? "En" : "Fr"}:stored` } });
    expect(list(locale, "Globals")).toEqual([]);
    expect(list(locale, "missing")).toEqual([]);
    const all = list(locale);
    expect(all.find(row => row.title === "Pages")?.category).toBeUndefined();
    expect(all.some(row => ["Shared", "Settings", "Footer"].includes(row.title))).toBe(false);
    for (const sortBy of ["slug", "category"]) {
      const ascending = list(locale, undefined, sortBy);
      expect(ascending.map(row => row[sortBy as "slug" | "category"] ?? "")).toEqual(all.map(row => row[sortBy as "slug" | "category"] ?? "").sort((a, b) => a.localeCompare(b)));
    }
    expect(list(locale, "Articles", "title", -1)).toEqual([...articles].reverse());
  }
});

test("configured all Pages covers Articles and Resources without losing other fallback content", () => {
  const source: Manifest = {
    ...manifest,
    schema: { ...manifest.schema!, documents: [...types, { name: "resource", title: "Resources", type: "document", folder: "resource", category: "Resources", fields }] },
    collections: [{ name: "news", label: "News", fields: [], posts: [] }],
    menus: { maxDepth: 3, entries: [] },
  };
  const pages = { kind: "link" as const, target: { kind: "pages" as const }, label: "Pages" };
  const articles = { kind: "link" as const, target: { kind: "pages" as const, category: "Articles" }, label: "Our articles", icon: "folder" };
  for (const locale of ["en", "fr"]) {
    const visible = contentForLocale(source, locale);
    const defaults = buildSidebar(visible).filter(node => node.kind === "link");
    expect(defaults.some(node => node.target.kind === "pages" && node.target.category === "Resources")).toBe(true);
    for (const sidebar of [undefined, [], [articles]]) {
      const targets = buildSidebar({ ...visible, sidebar }).flatMap(node => node.kind === "link" && node.target.kind === "pages" ? [node.target] : []);
      const expected = defaults.flatMap(node => node.target.kind === "pages" ? [node.target] : []);
      expect(targets).toHaveLength(expected.length);
      expect(targets).toEqual(expect.arrayContaining(expected));
    }
    for (const explicit of [[], [articles], [{ ...articles, target: { kind: "pages" as const, category: "Resources" } }]]) {
      const nodes = buildSidebar({ ...visible, sidebar: [pages, ...explicit] });
      expect(nodes.filter(node => node.kind === "link" && node.target.kind === "pages")).toEqual([pages, ...explicit]);
      expect(nodes.filter(node => node.kind === "link" && node.target.kind !== "pages")).toEqual(defaults.filter(node => node.target.kind !== "pages"));
      expect(nodes.some(node => node.kind === "heading" && node.label === "More content")).toBe(true);
    }
  }
});

test("opened native and legacy pages activate only their visible category or all Pages parent", () => {
  const functions = ["sameSel", "navActive"].map(name => {
    const start = source.indexOf(`  function ${name}(`);
    return source.slice(start, source.indexOf("\n  }", start) + 4);
  }).join("\n");
  const code = transpileModule(functions, { compilerOptions: { target: 99 } }).outputText;
  const resource: DocumentDef = { name: "resource", title: "Resources", type: "document", folder: "resource", category: "Resources", fields };
  const allTypes = [...types, resource];
  for (const locale of ["en", "fr"]) {
    const visible = contentForLocale({ ...manifest, schema: { objects: [], documents: allTypes } }, locale);
    for (const sidebar of [undefined, [{ kind: "link" as const, target: { kind: "pages" as const } }], [
      { kind: "link" as const, target: { kind: "pages" as const } },
      { kind: "link" as const, target: { kind: "pages" as const, category: "Articles" } },
    ]]) {
      const nodes = buildSidebar({ ...visible, sidebar });
      const selections: Selection[] = [
        ...visible.schema!.documents.map(type => ({ kind: "document" as const, type: type.name, id: `${type.name}:stored` })),
        ...visible.pages.map(page => ({ kind: "page" as const, slug: page.slug })),
        { kind: "pages" }, { kind: "pages", category: "Articles" },
        { kind: "menus" }, { kind: "menu", slug: "main" }, { kind: "media" },
        { kind: "post", collection: "news", slug: "post" },
      ];
      for (const sel of selections) {
        const page = sel.kind === "page" ? visible.pages.find(page => page.slug === sel.slug) : undefined;
        const type = sel.kind === "document" ? visible.schema!.documents.find(type => type.name === sel.type) : undefined;
        const entry = page ?? type;
        const categoryShown = nodes.some(node => node.kind === "link" && node.target.kind === "pages" && node.target.category === entry?.category && !!entry?.category);
        const active = new Function("sel", "docTypes", "page", "sidebar", `${code}; return navActive;`)(sel, visible.schema!.documents, page, nodes);
        for (const category of [undefined, "Articles", "Resources"]) {
          expect(active({ kind: "pages", category })).toBe(sel.kind === "pages" ? sel.category === category : !!entry && !entry.shared && category === (categoryShown ? entry.category : undefined));
        }
        expect(active(sel)).toBe(true);
        if (type?.shared) expect(active({ kind: "documents", type: type.name })).toBe(true);
        if (sel.kind === "menu") expect(active({ kind: "menus" })).toBe(true);
        if (sel.kind === "post") expect(active({ kind: "collection", name: "news" })).toBe(true);
      }
    }
  }
});
