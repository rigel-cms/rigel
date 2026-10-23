import { documentDef, isPlainObject, objectDef } from "./validate";
import {
  SLUG_PATTERN,
  type ContentDocument,
  type DocumentDef,
  type FieldDef,
  type Schema,
} from "./types";

export function newKey(): string {
  return `k${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface ResolvedPath {
  found: boolean;
  value?: unknown;
}

const BLOCKED = new Set(["__proto__", "constructor", "prototype"]);

export function resolvePath(values: unknown, path: string): ResolvedPath {
  let current: unknown = values;
  for (const segment of path.split(".")) {
    if (BLOCKED.has(segment)) return { found: false };
    if (Array.isArray(current)) {
      const item = current.find((entry) => isPlainObject(entry) && entry._key === segment);
      if (item !== undefined) {
        current = item;
        continue;
      }
      if (!/^\d+$/.test(segment)) return { found: false };
      const index = Number(segment);
      if (index >= current.length) return { found: false };
      current = current[index];
      continue;
    }
    if (!isPlainObject(current) || !Object.hasOwn(current, segment)) return { found: false };
    current = current[segment];
  }
  return { found: true, value: current };
}

export function setPath(values: Record<string, unknown>, path: string, next: unknown): boolean {
  const segments = path.split(".");
  if (!segments.length || segments.some((segment) => BLOCKED.has(segment))) return false;
  let current: unknown = values;
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index];
    if (Array.isArray(current)) {
      current = /^\d+$/.test(segment)
        ? current[Number(segment)]
        : current.find((entry) => isPlainObject(entry) && entry._key === segment);
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else return false;
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = /^\d+$/.test(last)
      ? Number(last)
      : current.findIndex((entry) => isPlainObject(entry) && entry._key === last);
    if (index < 0 || index >= current.length) return false;
    current[index] = next;
    return true;
  }
  if (!isPlainObject(current)) return false;
  current[last] = next;
  return true;
}

export function sectionDef(schema: Schema, type: string) {
  return schema.objects.find((entry) => entry.name === type && entry.type === "section");
}

export function arrayObjectFields(schema: Schema, field: FieldDef): FieldDef[] {
  const item = field.items?.find((entry) => entry.type === "object" && entry.name);
  if (!item || item.type !== "object") return [];
  return objectDef(schema, item.name!).fields;
}

export function fieldByKey(fields: FieldDef[], key: string): FieldDef | undefined {
  return fields.find((field) => field.key === key);
}

export function regenerateKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => regenerateKeys(item)) as T;
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) next[key] = regenerateKeys(child);
  if (typeof value._key === "string") next._key = newKey();
  return next as T;
}

export function newDocumentFromTemplate(schema: Schema, typeName: string, title: string, slug: string): Record<string, unknown> {
  if (!SLUG_PATTERN.test(slug)) throw new Error("Slug must be lowercase letters, numbers and single dashes.");
  const def = documentDef(schema, typeName);
  const data: Record<string, unknown> = { ...def.initialValue, _id: `${typeName}:${slug}`, _type: typeName, slug };
  for (const field of def.fields) {
    if (field.key === "title") data.title = title;
    else if (field.key === "name" && !def.fields.some(field => field.key === "title")) data.name = title;
    else if (data[field.key] !== undefined) continue;
    else if (field.initialValue !== undefined) data[field.key] = field.initialValue;
    else if (field.type === "array") data[field.key] = [];
  }
  if (def.template?.length) {
    data.sections = def.template.map((section) => {
      const sectionType = sectionDef(schema, section.type);
      if (!sectionType) throw new Error(`Template references unknown section ${section.type}`);
      const values: Record<string, unknown> = { _key: newKey(), _type: section.type };
      for (const field of sectionType.fields) {
        if (section.values && Object.hasOwn(section.values, field.key)) values[field.key] = section.values[field.key];
        else if (field.initialValue !== undefined) values[field.key] = field.initialValue;
        else if (field.type === "array") values[field.key] = [];
      }
      return values;
    });
  }
  return regenerateKeys(data);
}

export function assertUniqueSlug(documents: ContentDocument[], typeName: string, slug: string, legacySlugs: string[] = []) {
  if (!SLUG_PATTERN.test(slug)) throw new Error("Slug must be lowercase letters, numbers and single dashes.");
  if (documents.some((doc) => doc.type === typeName && doc.slug === slug)) throw new Error(`A ${typeName} document with slug "${slug}" already exists.`);
  if (legacySlugs.includes(slug)) throw new Error(`The slug "${slug}" is already used by a copy page.`);
}

export function pageRoute(slug: string, mapping: { url: string; index?: string } | undefined): string | null {
  if (!mapping) return null;
  if (slug === "home" && mapping.index) return mapping.index;
  const path = mapping.url.replaceAll("{slug}", slug);
  return /^\/(?!\/)/.test(path) && !/[\\\s?#]/.test(path) && !path.split("/").includes("..") && !/^\/rigel(?:\/|$)/.test(path) ? path : null;
}
