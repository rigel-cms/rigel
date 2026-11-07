import type { DocumentDef, Schema } from "../schema/types";
import { isPlainObject } from "../schema/validate";

export function documentLedgerShape(type: DocumentDef, schema: Schema) {
  return { name: type.name, locale: type.locale, columns: type.columns, fields: [type, schema.objects] };
}

export function documentReferences(value: unknown): string[] {
  const refs = new Set<string>();
  function visit(value: unknown) {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainObject(value)) {
      if (typeof value._ref === "string") refs.add(value._ref);
      Object.values(value).forEach(visit);
    }
  }
  visit(value);
  return [...refs].sort();
}

export function documentMetadata(type: DocumentDef, data: Record<string, unknown>) {
  const result: Record<string, unknown> = { _references: documentReferences(data).map(_ref => ({ _ref })) };
  for (const key of new Set(["_id", "_type", "title", "name", "slug", "draft", ...(type.columns ?? [])])) {
    if (type.fields.some(field => field.key === key && ["password", "markdown", "code"].includes(field.type))) continue;
    const value = typeof data[key] === "string" && !["slug", "_id", "_type"].includes(key) ? (data[key] as string).slice(0, 1024) : data[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") result[key] = value;
  }
  return result;
}

export function validDocumentMetadata(data: Record<string, unknown>) {
  if (["_id", "_type", "title", "name", "slug"].some(key => Object.hasOwn(data, key) && typeof data[key] !== "string") || (Object.hasOwn(data, "draft") && typeof data.draft !== "boolean") || (typeof data.slug === "string" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.slug))) return false;
  return Array.isArray(data._references) && data._references.every(ref => isPlainObject(ref) && Object.keys(ref).length === 1 && typeof ref._ref === "string" && /^[a-z][a-zA-Z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref._ref)) && Object.entries(data).every(([key, value]) => key === "_references" || ["string", "number", "boolean"].includes(typeof value));
}
