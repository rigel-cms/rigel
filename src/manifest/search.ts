import type { SearchScope } from "../config";
import type { Manifest } from "./types";
import type { Selection } from "./navigation";
import { contentForLocale } from "./content-locales";

export interface SearchHit {
  id: string;
  label: string;
  hint: string;
  locale?: string;
  language?: string;
  selection: Selection;
}

export function effectiveSearchScope(config: Manifest["search"], override: unknown): SearchScope {
  return override === "all" || override === "currentLocale" ? override : config?.scope === "currentLocale" ? "currentLocale" : "all";
}

export function searchIndex(manifest: Manifest, scope: SearchScope, locale: string | undefined, t: (key: string, params?: Record<string, string>) => string): SearchHit[] {
  const content = scope === "currentLocale" ? contentForLocale(manifest, locale) : manifest;
  const hits = new Map<string, SearchHit>();
  function add(selection: Selection, label: string, hint: string, code?: string) {
    const id = JSON.stringify(selection);
    const language = manifest.contentLocales && manifest.contentLocales.locales.length > 1 ? manifest.contentLocales.locales.find(entry => entry.code === code)?.label : undefined;
    if (!hits.has(id)) hits.set(id, { id, label, hint, selection, locale: code, language });
  }
  for (const page of content.pages) add({ kind: "page", slug: page.slug }, page.label, t("shell.page"), page.locale);
  for (const doc of content.documents ?? []) {
    const type = content.schema?.documents.find(type => type.name === doc.type);
    add({ kind: "document", type: doc.type, id: doc.id }, String(doc.data.title ?? doc.data.name ?? doc.slug), t("shell.searchItemHint", { name: doc.type, slug: doc.slug }), type?.locale);
  }
  for (const collection of content.collections ?? []) {
    add({ kind: "collection", name: collection.name }, collection.label, t("shell.collection"), collection.locale);
    for (const post of collection.posts) add({ kind: "post", collection: collection.name, slug: post.slug }, String(post.frontmatter.title ?? post.slug), t("shell.searchItemHint", { name: collection.label, slug: post.slug }), collection.locale);
  }
  if (content.menus) {
    add({ kind: "menus" }, t("shell.menus"), t("shell.collection"));
    for (const menu of content.menus.entries) add({ kind: "menu", slug: menu.slug }, menu.title, t("shell.searchMenuHint", { slug: menu.slug }));
  }
  return [...hits.values()];
}
