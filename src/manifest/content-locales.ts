import type { ContentLocalesConfig } from "../config";
import type { Manifest } from "./types";
import type { Selection } from "./navigation";

const CODE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export function validateContentLocales(value: unknown): asserts value is ContentLocalesConfig {
  const config = value as ContentLocalesConfig | null;
  if (!config || typeof config !== "object" || !Array.isArray(config.locales) || !config.locales.length || Array.from(config.locales).some(locale => !locale || typeof locale.code !== "string" || !CODE.test(locale.code) || typeof locale.label !== "string" || !locale.label.trim()) || new Set(config.locales.map(locale => locale.code.toLowerCase())).size !== config.locales.length || !config.locales.some(locale => locale.code === config.defaultLocale)) {
    throw new Error("rigel: contentLocales requires unique locale codes, non-empty labels and a defaultLocale matching a configured code");
  }
}

export function validateContentLocale(locale: unknown, config: ContentLocalesConfig | undefined, scope: string): void {
  if (locale === undefined) return;
  if (typeof locale !== "string" || !CODE.test(locale)) throw new Error(`rigel: ${scope}: invalid content locale`);
  if (config && !config.locales.some(entry => entry.code === locale)) throw new Error(`rigel: ${scope}: unknown content locale ${locale}`);
}

export function contentForLocale(manifest: Manifest, locale: string | undefined): Manifest {
  if (!manifest.contentLocales) return manifest;
  const selected = locale ?? manifest.contentLocales.defaultLocale;
  const visible = (entry: { locale?: string }) => entry.locale === undefined || entry.locale === selected;
  const types = manifest.schema?.documents.filter(visible);
  return {
    ...manifest,
    pages: manifest.pages.filter(visible),
    ...(manifest.collections ? { collections: manifest.collections.filter(visible) } : {}),
    ...(manifest.schema ? { schema: { ...manifest.schema, documents: types! } } : {}),
    ...(manifest.documents ? { documents: manifest.documents.filter(doc => types?.some(type => type.name === doc.type)) } : {}),
  };
}

export function selectionInContent(manifest: Manifest, selection: Selection | null): boolean {
  if (!selection) return true;
  switch (selection.kind) {
    case "page": return manifest.pages.some(page => page.slug === selection.slug);
    case "pages": return !selection.category || manifest.pages.some(page => !page.shared && page.category === selection.category) || !!manifest.schema?.documents.some(type => !type.shared && type.category === selection.category);
    case "document":
    case "documents": return !!manifest.schema?.documents.some(type => type.name === selection.type);
    case "post": return !!manifest.collections?.some(collection => collection.name === selection.collection);
    case "collection": return !!manifest.collections?.some(collection => collection.name === selection.name);
    default: return true;
  }
}
