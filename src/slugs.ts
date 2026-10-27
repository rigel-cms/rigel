import type { ContentDocument, Schema } from "./schema/types";
import type { PreviewConfig } from "./preview";
import { systemMessage, type Translator } from "./editor/i18n/format";

export function slugify(input: string, existingSlugs: Iterable<string> = []): string {
  const base = input.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  if (!base) return "";
  const existing = new Set(existingSlugs);
  let slug = base;
  for (let suffix = 2; existing.has(slug); suffix++) slug = `${base}-${suffix}`;
  return slug;
}

export function normalizeUrlSlug(value: unknown, message: Translator = systemMessage): string {
  if (typeof value !== "string" || !slugify(value)) throw new Error(message("validation.slug.required"));
  return slugify(value);
}

export function effectiveSlug(values: Record<string, unknown>, storageSlug: string, message: Translator = systemMessage): string {
  if (!Object.hasOwn(values, "slug")) return storageSlug;
  if (typeof values.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(values.slug)) throw new Error(message("validation.slug.invalid"));
  return values.slug;
}

export function assertUniqueUrlSlugs(entries: { slug: string; values: Record<string, unknown> }[], message: Translator = systemMessage): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = effectiveSlug(entry.values, entry.slug, message);
    if (seen.has(slug)) throw new Error(message("validation.slug.duplicate", { slug }));
    seen.add(slug);
  }
}

export function validateDocumentSlugs(schema: Schema, documents: ContentDocument[], preview?: PreviewConfig, message: Translator = systemMessage): void {
  const seen = new Set<string>();
  const pages = documents.filter(doc => schema.documents.some(type => type.name === doc.type && !type.shared));
  const fixedRoutes = Object.entries(preview?.pages ?? {}).filter(([key]) => !pages.some(doc => doc.slug === key)).map(([, route]) => typeof route === "string" ? route : route.url);
  for (const doc of documents) {
    const type = schema.documents.find(type => type.name === doc.type);
    if (!type || type.shared) continue;
    const slug = effectiveSlug(doc.data, doc.slug, message);
    const mapping = preview?.documents?.[doc.type];
    const route = mapping ? slug === "home" && mapping.index ? mapping.index : mapping.url.replaceAll("{slug}", slug) : `/${slug}/`;
    if (seen.has(route) || fixedRoutes.includes(route)) throw new Error(message("validation.slug.duplicate", { slug }));
    seen.add(route);
  }
}
