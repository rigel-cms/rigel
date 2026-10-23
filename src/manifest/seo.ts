import type { CollectionField } from "./types";

export const SEO_FIELDS = [
  { key: "metaTitle", label: "SEO title", type: "string" },
  { key: "description", label: "SEO description", type: "text" },
  { key: "ogImage", label: "Social image", type: "image" },
] satisfies CollectionField[];

export function isSeoField(key: string): boolean {
  return key === "metaTitle" || key === "description" || key === "ogImage";
}

export function withSeoFields<T extends { key: string }>(fields: T[]): (T | typeof SEO_FIELDS[number])[] {
  return [...fields, ...SEO_FIELDS.filter(field => !fields.some(existing => existing.key === field.key)).map(field => ({ ...field }))];
}
