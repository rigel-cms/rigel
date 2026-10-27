import type { CollectionField } from "./types";
import type { ContentDocument } from "../schema/types";
import { systemMessage, type Translator } from "../editor/i18n/format";

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
