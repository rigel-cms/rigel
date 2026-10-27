import { cloneJson, newKey, regenerateKeys, setPath } from "../../schema/paths";
import { translate } from "../i18n";
import { isPlainObject, objectDef } from "../../schema/validate";
import type { ContentDocument, DocumentDef, FieldDef, Schema } from "../../schema/types";

export interface SelectedField {
  docId: string;
  path: string;
  sectionKey?: string;
}

export function sectionList(values: Record<string, unknown>): Record<string, unknown>[] {
  return Array.isArray(values.sections) ? (values.sections as Record<string, unknown>[]) : [];
}

export function sectionTypeDef(schema: Schema, type: unknown) {
  return schema.objects.find((object) => object.name === type && object.type === "section");
}

export function sectionLabel(schema: Schema, type: unknown, fallback = translate("fields.section")): string {
  return sectionTypeDef(schema, type)?.title ?? String(type ?? fallback);
}

export function fieldForPath(schema: Schema, docType: DocumentDef, values: Record<string, unknown>, path: string): FieldDef | null {
  if (!path) return null;
  if (path.startsWith("sections.")) {
    const [scope, key, ...rest] = path.split(".");
    if (scope !== "sections" || !key) return null;
    const section = sectionList(values).find((entry) => entry._key === key);
    const def = section ? sectionTypeDef(schema, section._type) : undefined;
    return def ? lookupField(schema, def.fields, rest) : null;
  }
  return lookupField(schema, docType.fields, path.split("."));
}

function lookupField(schema: Schema, fields: FieldDef[], segments: string[]): FieldDef | null {
  let list = fields;
  for (let index = 0; index < segments.length; index++) {
    const field = list.find((entry) => entry.key === segments[index]);
    if (!field) return null;
    if (index === segments.length - 1) return field;
    if (field.type === "object") {
      list = field.of ? objectDef(schema, field.of).fields : field.fields ?? [];
      continue;
    }
    if (field.type === "array") {
      index++;
      if (index >= segments.length) return null;
      const item = field.items?.find((entry) => entry.type === "object");
      if (!item || item.type !== "object") return null;
      list = item.name ? objectDef(schema, item.name).fields : item.fields ?? [];
      continue;
    }
    return null;
  }
  return null;
}

export function itemFields(schema: Schema, field: FieldDef): FieldDef[] {
  const item = field.items?.find((entry) => entry.type === "object");
  if (!item || item.type !== "object") return [];
  return item.name ? objectDef(schema, item.name).fields : item.fields ?? [];
}

export function objectFields(schema: Schema, field: FieldDef): FieldDef[] {
  return field.of ? objectDef(schema, field.of).fields : field.fields ?? [];
}

export function defaultValue(field: FieldDef): unknown {
  if (field.initialValue !== undefined) return regenerateKeys(cloneJson(field.initialValue));
  if (field.type === "array") return [];
  if (field.type === "boolean") return false;
  if (field.type === "number") return 0;
  if (field.type === "color") return "#000000";
  if (field.type === "object") return {};
  if (field.type === "reference") return undefined;
  return "";
}

export function blankItem(fields: FieldDef[]): Record<string, unknown> {
  const item: Record<string, unknown> = { _key: newKey() };
  for (const field of fields) {
    const value = defaultValue(field);
    if (value !== undefined) item[field.key] = value;
  }
  return item;
}

export function moveItem(list: unknown[], index: number, delta: number): unknown[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function duplicateItem(list: unknown[], index: number): unknown[] {
  const item = list[index];
  const copy = isPlainObject(item) ? regenerateKeys(cloneJson(item)) : item;
  return [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
}

export function replaceAt(values: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const next = cloneJson(values);
  if (!setPath(next, path, value)) return values;
  return next;
}

export function referenceOptions(documents: ContentDocument[], to: string[]) {
  return documents.filter((doc) => to.includes(doc.type));
}
