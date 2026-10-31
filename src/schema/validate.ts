import {
  FIELD_KEY_PATTERN,
  KEY_PATTERN,
  RESERVED_KEYS,
  SLUG_PATTERN,
  type ArrayItem,
  type ContentDocument,
  type DocumentDef,
  type FieldDef,
  type ObjectDef,
  type ScalarFieldType,
  type Schema,
} from "./types";
import { systemMessage, type Parameters, type Translator } from "../editor/i18n/format";
import { matchesMediaAccept, safeFileUrl } from "../media-types";

const SCALARS: ScalarFieldType[] = ["string", "text", "markdown", "boolean", "number", "date", "image", "file", "url", "color", "code", "password"];
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const FOLDER_PART = /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/;

export class SchemaError extends Error {}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function fail(path: string, key: string, message: Translator = systemMessage, parameters: Parameters = {}): never {
  throw new SchemaError(message(key, { path, ...parameters }));
}

export function objectDef(schema: Schema, name: string, message: Translator = systemMessage): ObjectDef {
  const def = schema.objects.find((entry) => entry.name === name);
  if (!def) fail(name, "validation.schema.unknownObject", message);
  return def;
}

export function documentDef(schema: Schema, name: string, message: Translator = systemMessage): DocumentDef {
  const def = schema.documents.find((entry) => entry.name === name);
  if (!def) fail(name, "validation.schema.unknownDocument", message);
  return def;
}

export function validateSchema(input: Schema): Schema {
  if (!isPlainObject(input) || !Array.isArray(input.documents) || !Array.isArray(input.objects))
    throw new SchemaError("Schema requires documents and objects arrays");
  const schema = input;
  const names = new Set<string>();
  const folders = new Set<string>();
  for (const doc of schema.documents) {
    if (doc.type !== "document" || !/^[a-z][a-zA-Z0-9-]*$/.test(doc.name)) throw new SchemaError(`Invalid document type name: ${doc.name}`);
    if (names.has(doc.name)) throw new SchemaError(`Duplicate document type: ${doc.name}`);
    names.add(doc.name);
    if (doc.demo !== undefined && typeof doc.demo !== "boolean") throw new SchemaError(`Document type ${doc.name}: demo must be boolean`);
    if (doc.creatable !== undefined && typeof doc.creatable !== "boolean") throw new SchemaError(`Document type ${doc.name}: creatable must be boolean`);
    if (typeof doc.title !== "string" || !doc.title.trim()) throw new SchemaError(`Document type ${doc.name} requires a title`);
    if (doc.category !== undefined && (typeof doc.category !== "string" || !doc.category.trim())) throw new SchemaError(`Document type ${doc.name}: category must be a non-empty string`);
    const parts = String(doc.folder).split("/");
    if (!parts.length || parts.some((part) => !FOLDER_PART.test(part))) throw new SchemaError(`Document type ${doc.name} has an unsafe folder`);
    if (folders.has(doc.folder)) throw new SchemaError(`Duplicate document folder: ${doc.folder}`);
    folders.add(doc.folder);
    if (!Array.isArray(doc.fields) || !doc.fields.length) throw new SchemaError(`Document type ${doc.name} requires fields`);
    validateFieldsShape(schema, doc.fields, doc.name);
    if (doc.columns !== undefined && (!Array.isArray(doc.columns) || doc.columns.some(key => typeof key !== "string" || !["title", "slug", ...doc.fields.map(field => field.key)].includes(key)))) throw new SchemaError(`Document type ${doc.name}: columns must name declared fields, title or slug`);
    for (const section of doc.template ?? []) {
      const def = schema.objects.find((entry) => entry.name === section.type);
      if (!def || def.type !== "section") throw new SchemaError(`Document type ${doc.name} template references unknown section ${section.type}`);
    }
  }
  const objectNames = new Set<string>();
  for (const object of schema.objects) {
    if (!/^[a-z][a-zA-Z0-9-]*$/.test(object.name)) throw new SchemaError(`Invalid object name: ${object.name}`);
    if (objectNames.has(object.name)) throw new SchemaError(`Duplicate object type: ${object.name}`);
    objectNames.add(object.name);
    if (object.type !== "object" && object.type !== "section") throw new SchemaError(`Object ${object.name} must be an object or section`);
    if (!Array.isArray(object.fields) || !object.fields.length) throw new SchemaError(`Object ${object.name} requires fields`);
    validateFieldsShape(schema, object.fields, object.name);
  }
  for (const doc of schema.documents) validateFieldTargets(schema, doc.fields, doc.name);
  for (const object of schema.objects) validateFieldTargets(schema, object.fields, object.name);
  return schema;
}

function validateFieldsShape(schema: Schema, fields: FieldDef[], scope: string) {
  const keys = new Set<string>();
  for (const field of fields) {
    if (!isPlainObject(field)) throw new SchemaError(`${scope}: invalid field`);
    if (!FIELD_KEY_PATTERN.test(String(field.key)) || RESERVED_KEYS.has(field.key)) throw new SchemaError(`${scope}: invalid field key ${field.key}`);
    if (keys.has(field.key)) throw new SchemaError(`${scope}: duplicate field key ${field.key}`);
    keys.add(field.key);
    if (typeof field.label !== "string" || !field.label.trim()) throw new SchemaError(`${scope}.${field.key}: label required`);
    if (field.accept !== undefined && (field.type !== "file" || typeof field.accept !== "string" || !field.accept.split(",").every(token => /^(?:\.[a-z0-9]+|[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*))$/i.test(token.trim())))) throw new SchemaError(`${scope}.${field.key}: accept must contain file extensions or MIME types`);
    if (![...SCALARS, "object", "array", "reference"].includes(field.type)) throw new SchemaError(`${scope}.${field.key}: unknown field type ${field.type}`);
    if (field.type === "object") {
      if (field.of) objectDef(schema, field.of);
      else if (!field.fields?.length) throw new SchemaError(`${scope}.${field.key}: object requires fields or a declared object`);
      else validateFieldsShape(schema, field.fields, `${scope}.${field.key}`);
    }
    if (field.type === "array") {
      if (!field.items?.length) throw new SchemaError(`${scope}.${field.key}: array requires items`);
      if (field.min !== undefined && (!Number.isInteger(field.min) || field.min < 0)) throw new SchemaError(`${scope}.${field.key}: invalid min`);
      if (field.max !== undefined && (!Number.isInteger(field.max) || field.max < 1)) throw new SchemaError(`${scope}.${field.key}: invalid max`);
      for (const item of field.items) {
        if (item.type === "object") {
          if (item.name) objectDef(schema, item.name);
          else if (!item.fields?.length) throw new SchemaError(`${scope}.${field.key}: array object item requires fields`);
          else validateFieldsShape(schema, item.fields, `${scope}.${field.key}[]`);
        }
        if (item.type === "reference" && (!item.to?.length || item.to.some((name) => !schema.documents.some((doc) => doc.name === name))))
          throw new SchemaError(`${scope}.${field.key}: reference target must be a declared document type`);
      }
    }
    if (field.type === "reference" && (!field.to?.length || field.to.some((name) => !schema.documents.some((doc) => doc.name === name))))
      throw new SchemaError(`${scope}.${field.key}: reference target must be a declared document type`);
  }
}

function validateFieldTargets(schema: Schema, fields: FieldDef[], scope: string) {
  for (const field of fields) {
    if (field.type === "object" && field.fields) validateFieldTargets(schema, field.fields, `${scope}.${field.key}`);
    for (const item of field.items ?? []) if (item.type === "object" && item.fields) validateFieldTargets(schema, item.fields, `${scope}.${field.key}[]`);
  }
}

function safeUrl(value: string): boolean {
  if (!value || /[\s\u0000-\u001f\u007f\\]/.test(value) || value.startsWith("//")) return false;
  if (value.startsWith("/")) return !value.split("/").includes("..");
  return /^https?:\/\/[^\s]+$/i.test(value) || /^mailto:[^\s]+$/i.test(value);
}

function scalarOk(type: ScalarFieldType, value: unknown): boolean {
  if (type === "boolean") return typeof value === "boolean";
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (typeof value !== "string") return false;
  if (type === "file") return safeFileUrl(value);
  if (type === "color") return value === "" || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (type === "image" || type === "url") return safeUrl(value);
  return true;
}

function requireValue(field: FieldDef, value: unknown, path: string, message: Translator) {
  if (value === undefined || value === null) fail(path, "validation.schema.required", message);
  if (typeof value === "string" && ["string", "text", "markdown", "image", "file", "url"].includes(field.type) && !value.trim()) fail(path, "validation.schema.required", message);
  if (field.required && Array.isArray(value) && !value.length) fail(path, "validation.schema.required", message);
}

function checkKeys(value: unknown, path: string, message: Translator) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkKeys(item, `${path}[${index}]`, message));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE.has(key)) fail(path, "validation.schema.unsafeKey", message, { key });
    checkKeys(child, `${path}.${key}`, message);
  }
}

function validateObjectFields(
  schema: Schema,
  fields: FieldDef[],
  value: Record<string, unknown>,
  path: string,
  documents: ContentDocument[],
  message: Translator,
) {
  for (const field of fields) {
    if (field.required) requireValue(field, value[field.key], `${path}.${field.key}`, message);
    if (value[field.key] === undefined) continue;
    validateFieldValue(schema, field, value[field.key], `${path}.${field.key}`, documents, message);
  }
  for (const key of Object.keys(value)) {
    if (UNSAFE.has(key)) fail(path, "validation.schema.unsafeKey", message, { key });
  }
}

function validateFieldValue(schema: Schema, field: FieldDef, value: unknown, path: string, documents: ContentDocument[], message: Translator) {
  if (field.type === "object") {
    if (!isPlainObject(value)) fail(path, "validation.schema.object", message);
    checkKeys(value, path, message);
    const def = field.of ? objectDef(schema, field.of, message) : undefined;
    validateObjectFields(schema, def?.fields ?? field.fields ?? [], value, path, documents, message);
    return;
  }
  if (field.type === "array") {
    if (!Array.isArray(value)) fail(path, "validation.schema.array", message);
    if (field.min !== undefined && value.length < field.min) fail(path, "validation.schema.minItems", message, { min: field.min });
    if (field.max !== undefined && value.length > field.max) fail(path, "validation.schema.maxItems", message, { max: field.max });
    checkKeys(value, path, message);
    const keys = new Set<string>();
    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`;
      const def = matchItem(schema, field.items!, item, itemPath, message);
      if (def.type === "reference") {
        if (!isPlainObject(item) || typeof item._ref !== "string") fail(itemPath, "validation.schema.reference", message);
        validateReference(schema, item, def.to ?? [], itemPath, documents, message);
      } else if (def.type === "object") {
        if (!isPlainObject(item)) fail(itemPath, "validation.schema.object", message);
        if (def.name && item._type !== def.name) fail(itemPath, "validation.schema.section", message, { name: def.name });
        checkKeys(item, itemPath, message);
        validateObjectFields(schema, def.fields ?? objectDef(schema, def.name!, message).fields, item, itemPath, documents, message);
      } else if (!scalarOk(def.type as ScalarFieldType, item)) {
        fail(itemPath, "validation.schema.scalar", message, { type: def.type });
      }
      if (def.type === "object" || def.type === "reference") {
        const key = item && typeof item === "object" ? (item as Record<string, unknown>)._key : undefined;
        if (typeof key !== "string" || !KEY_PATTERN.test(key)) fail(itemPath, "validation.schema.stableKey", message);
        if (keys.has(key as string)) fail(itemPath, "validation.schema.duplicateKey", message, { key });
        keys.add(key as string);
      }
    });
    return;
  }
  if (field.type === "reference") {
    if (!isPlainObject(value)) fail(path, "validation.schema.reference", message);
    validateReference(schema, value, field.to ?? [], path, documents, message);
    return;
  }
  if ((field.type === "url" || field.type === "image" || field.type === "file") && value === "" && !field.required) return;
  if (!scalarOk(field.type as ScalarFieldType, value)) fail(path, "validation.schema.scalar", message, { type: field.type });
  if (field.type === "file" && !matchesMediaAccept(value as string, field.accept)) fail(path, "validation.schema.scalar", message, { type: field.accept ?? "file" });
}

type ItemDef = { type: ScalarFieldType | "object" | "reference"; name?: string; fields?: FieldDef[]; to?: string[] };

function matchItem(schema: Schema, items: ArrayItem[], item: unknown, path: string, message: Translator): ItemDef {
  if (isPlainObject(item) && typeof item._type === "string") {
    const named = items.find((entry) => entry.type === "object" && entry.name === item._type);
    if (named && named.type === "object") return { type: "object", name: named.name, fields: named.name ? objectDef(schema, named.name, message).fields : named.fields };
    fail(path, "validation.schema.unknownSection", message, { type: item._type });
  }
  if (items.length === 1) {
    const only = items[0];
    if (only.type === "object") return { type: "object", name: only.name, fields: only.name ? objectDef(schema, only.name, message).fields : only.fields };
    if (only.type === "reference") return { type: "reference", to: only.to };
    return only;
  }
  const reference = items.find((entry) => entry.type === "reference");
  if (isPlainObject(item) && typeof item._ref === "string" && reference && reference.type === "reference") return { type: "reference", to: reference.to };
  const inline = items.find((entry) => entry.type === "object" && !entry.name);
  if (isPlainObject(item) && inline && inline.type === "object") return { type: "object", fields: inline.fields };
  const scalar = items.find((entry) => entry.type !== "object" && entry.type !== "reference" && scalarOk(entry.type, item));
  if (scalar) return scalar;
  fail(path, "validation.schema.arrayItem", message);
}

function validateReference(schema: Schema, value: Record<string, unknown>, to: string[], path: string, documents: ContentDocument[], message: Translator) {
  const ref = value._ref;
  if (typeof ref !== "string" || !/^[a-z][a-zA-Z0-9-]*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ref)) fail(path, "validation.schema.referenceId", message);
  if (!to.some((name) => ref.startsWith(`${name}:`))) fail(path, "validation.schema.referenceTarget", message, { targets: to.reduceRight((alternatives, target, index) => index === to.length - 1 ? target : message("validation.schema.referenceAlternatives", { target, alternatives }), "") });
  for (const key of Object.keys(value)) if (key !== "_ref" && !key.startsWith("_")) fail(path, "validation.schema.referenceProperty", message, { key });
  if (!documents.some((doc) => doc.id === ref)) fail(path, "validation.schema.unresolvedTarget", message, { ref });
  if (!schema.documents.some((doc) => ref.startsWith(`${doc.name}:`))) fail(path, "validation.schema.undeclaredTarget", message);
}

export function documentIndex(documents: ContentDocument[], message: Translator = systemMessage): { byId: Map<string, ContentDocument>; list: ContentDocument[] } {
  const byId = new Map<string, ContentDocument>();
  for (const doc of documents) {
    if (byId.has(doc.id)) throw new SchemaError(message("validation.schema.duplicateDocument", { id: doc.id }));
    byId.set(doc.id, doc);
  }
  return { byId, list: documents };
}

export function validateDocument(
  schema: Schema,
  typeName: string,
  slug: string,
  data: Record<string, unknown>,
  documents: ContentDocument[],
  message: Translator = systemMessage,
): Record<string, unknown> {
  const def = documentDef(schema, typeName, message);
  if (!SLUG_PATTERN.test(slug)) fail(slug, "validation.schema.slug", message);
  if (!isPlainObject(data)) fail(slug, "validation.schema.documentObject", message);
  if (data._type !== undefined && data._type !== typeName) fail(slug, "validation.schema.documentType", message, { type: typeName });
  if (data._id !== undefined && data._id !== `${typeName}:${slug}`) fail(slug, "validation.schema.documentId", message, { id: `${typeName}:${slug}` });
  checkKeys(data, slug, message);
  validateObjectFields(schema, def.fields, data, slug, documents, message);
  validateReferencesDeep(schema, def.fields, data, `${typeName}:${slug}`, `${typeName}:${slug}`, documents, message);
  return data;
}

function validateReferencesDeep(
  schema: Schema,
  fields: FieldDef[],
  value: Record<string, unknown>,
  path: string,
  self: string,
  documents: ContentDocument[],
  message: Translator,
) {
  for (const field of fields) {
    const current = value[field.key];
    if (current === undefined) continue;
    if (field.type === "reference") {
      const ref = (current as Record<string, unknown>)._ref;
      if (ref === self) fail(path, "validation.schema.selfReference", message);
      const target = documents.find((doc) => doc.id === ref);
      if (!target) fail(`${path}.${field.key}`, "validation.schema.unresolvedReference", message, { ref: String(ref) });
      const def = schema.documents.find((doc) => doc.name === target.type);
      if (!field.to?.includes(target.type) || !def) fail(`${path}.${field.key}`, "validation.schema.disallowedReference", message, { ref: String(ref) });
    } else if (field.type === "object" && isPlainObject(current)) {
      const objectFields = field.of ? objectDef(schema, field.of, message).fields : field.fields ?? [];
      validateReferencesDeep(schema, objectFields, current, `${path}.${field.key}`, self, documents, message);
    } else if (field.type === "array" && Array.isArray(current)) {
      current.forEach((item, index) => {
        if (!isPlainObject(item)) return;
        for (const entry of field.items ?? []) {
          if (entry.type === "reference" && typeof item._ref === "string") {
            const target = documents.find((doc) => doc.id === item._ref);
            if (!target) fail(`${path}.${field.key}[${index}]`, "validation.schema.unresolvedReference", message, { ref: String(item._ref) });
            if (!entry.to.includes(target.type)) fail(`${path}.${field.key}[${index}]`, "validation.schema.disallowedReference", message, { ref: String(item._ref) });
          }
          if (entry.type === "object") {
            const objectFields = entry.name ? objectDef(schema, entry.name, message).fields : entry.fields ?? [];
            validateReferencesDeep(schema, objectFields, item, `${path}.${field.key}[${index}]`, self, documents, message);
          }
        }
      });
    }
  }
}

export function referrers(documents: ContentDocument[], id: string): ContentDocument[] {
  return documents.filter((doc) => JSON.stringify(doc.data).includes(`"_ref":"${id}"`));
}

export function validateDocumentId(schema: Schema, id: string): { type: DocumentDef; slug: string } | null {
  const match = /^([a-z][a-zA-Z0-9-]*):([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(id);
  if (!match) return null;
  const type = schema.documents.find((doc) => doc.name === match[1]);
  return type ? { type, slug: match[2] } : null;
}
