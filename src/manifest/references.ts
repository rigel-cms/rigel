import type { CollectionField, Manifest } from "./types";
import type { Selection } from "./navigation";
import { referrers } from "../schema/validate";
import type { ContentDocument } from "../schema/types";
import { systemMessage, type Translator } from "../editor/i18n/format";

export function entryUsage(manifest: Manifest, id: string) {
  const entries: { label: string; group: string; locale?: string; target: Selection }[] = [];
  let complete = !(manifest.documents ?? []).some(doc => doc.loaded === "identity");
  for (const doc of referrers(manifest.documents ?? [], id)) {
    const type = manifest.schema?.documents.find(type => type.name === doc.type);
    if (doc.id !== id && type) entries.push({ label: String(doc.data.title || doc.data.name || doc.slug), group: type.title, locale: type.locale, target: { kind: "document", type: doc.type, id: doc.id } });
  }
  for (const collection of manifest.collections ?? []) {
    const fields = collection.fields.filter(field => field.type === "reference" && field.to);
    if (!fields.length) continue;
    if (collection.index && collection.index.state !== "complete") complete = false;
    for (const post of collection.posts) if (fields.some(field => {
      const value = post.frontmatter[field.key];
      return field.multiple ? Array.isArray(value) && value.includes(id) : value === id;
    })) entries.push({ label: String(post.frontmatter.title || post.slug), group: collection.label, locale: collection.locale, target: { kind: "post", collection: collection.name, slug: post.slug } });
  }
  return { entries, complete };
}

export interface ReferenceOption {
  value: string;
  label: string;
  description?: string;
  photo?: string;
  email?: string;
  url?: string;
}

export function referenceOptions(field: CollectionField, documents: ContentDocument[] = []): ReferenceOption[] {
  if (field.options) return field.options;
  return documents.filter(doc => doc.type === field.to).map(doc => ({
    value: doc.id,
    label: String(doc.data.name ?? doc.data.title ?? doc.slug),
    ...Object.fromEntries(["description", "photo", "email", "url"].filter(key => typeof doc.data[key] === "string").map(key => [key, doc.data[key]])),
  }));
}

export function referenceLabel(value: unknown, options: ReferenceOption[], message: Translator = systemMessage): string {
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map(id => options.find(option => option.value === id)?.label ?? message("system.reference.unavailable", { id: String(id) })).join(", ");
}

export function collectionPreviewValues(fields: CollectionField[], values: Record<string, unknown>, documents: ContentDocument[], message: Translator = systemMessage): Record<string, unknown> {
  return { ...values, ...Object.fromEntries(fields.filter(field => field.type === "reference").map(field => [field.key, referenceLabel(values[field.key], referenceOptions(field, documents), message)])) };
}

export function validateCollectionReferences(fields: CollectionField[], values: Record<string, unknown>, documents: ContentDocument[], message: Translator = systemMessage): void {
  for (const field of fields.filter(field => field.type === "reference")) {
    const value = values[field.key];
    if (value === undefined) continue;
    if (field.multiple ? !Array.isArray(value) : typeof value !== "string") throw new Error(message(field.multiple ? "system.reference.expectedMany" : "system.reference.expectedOne", { label: field.label }));
    const selected = field.multiple ? value as unknown[] : value === "" ? [] : [value];
    const options = referenceOptions(field, documents);
    if (new Set(selected).size !== selected.length || selected.some(id => typeof id !== "string" || !options.some(option => option.value === id))) throw new Error(message("system.reference.existingOnly", { label: field.label }));
  }
}
