import type { CollectionField } from "./types";
import { systemMessage } from "../editor/i18n/format";

export const SEO_FIELDS = [
  { key: "metaTitle", label: systemMessage("defaults.seoTitle"), labelKey: "defaults.seoTitle", type: "string" },
  { key: "description", label: systemMessage("defaults.seoDescription"), labelKey: "defaults.seoDescription", type: "text" },
  { key: "ogImage", label: systemMessage("defaults.socialImage"), labelKey: "defaults.socialImage", type: "image" },
] satisfies CollectionField[];

export function isSeoField(key: string): boolean {
  return key === "metaTitle" || key === "description" || key === "ogImage";
}

export function withSeoFields<T extends { key: string }>(fields: T[]): (T | typeof SEO_FIELDS[number])[] {
  return [...fields, ...SEO_FIELDS.filter(field => !fields.some(existing => existing.key === field.key)).map(field => ({ ...field }))];
}
