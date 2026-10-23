import type { CollectionField } from "./types";
import type { ContentDocument } from "../schema/types";
import { validateCollectionReferences } from "./references";

export function initialCollectionValues(fields: CollectionField[], title: string): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => [field.key,
    field.type === "boolean" ? field.key === "draft" :
    field.type === "tags" || (field.type === "reference" && field.multiple) ? [] :
    field.type === "date" ? new Date().toISOString().slice(0, 10) :
    field.key === "title" && field.type === "string" ? title : "",
  ]));
}

export function validateCollectionValues(fields: CollectionField[], values: Record<string, unknown>, documents: ContentDocument[] = []): void {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid article frontmatter");
  for (const field of fields) {
    const value = values[field.key];
    if (field.required && (value === undefined || value === null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && !value.length))) throw new Error(`${field.label}: required`);
    if (value === undefined || field.type === "reference") continue;
    const valid = field.type === "boolean" ? typeof value === "boolean" :
      field.type === "tags" ? Array.isArray(value) && value.every(tag => typeof tag === "string") :
      field.type === "date" ? typeof value === "string" && (value === "" || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value)) :
      typeof value === "string";
    if (!valid) throw new Error(`${field.label}: expected ${field.type}`);
  }
  validateCollectionReferences(fields, values, documents);
}
