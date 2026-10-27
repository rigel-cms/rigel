export type ScalarFieldType = "string" | "text" | "markdown" | "boolean" | "number" | "date" | "image" | "url" | "color" | "code" | "password";

export type ArrayItem =
  | { type: "object"; name?: string; title?: string; fields?: FieldDef[] }
  | { type: "reference"; to: string[] }
  | { type: ScalarFieldType };

export interface FieldDef {
  key: string;
  label: string;
  labelKey?: string;
  type: ScalarFieldType | "object" | "array" | "reference";
  placeholder?: string;
  required?: boolean;
  initialValue?: unknown;
  fields?: FieldDef[];
  of?: string;
  items?: ArrayItem[];
  to?: string[];
  min?: number;
  max?: number;
}

export interface ObjectDef {
  name: string;
  title: string;
  type: "object" | "section";
  fields: FieldDef[];
}

export interface DocumentTemplateSection {
  type: string;
  values?: Record<string, unknown>;
}

export interface DocumentDef {
  name: string;
  title: string;
  type: "document";
  folder: string;
  fields: FieldDef[];
  columns?: string[];
  shared?: boolean;
  singleton?: boolean;
  demo?: boolean;
  creatable?: boolean;
  template?: DocumentTemplateSection[];
  initialValue?: Record<string, unknown>;
}

export interface Schema {
  documents: DocumentDef[];
  objects: ObjectDef[];
}

export interface ContentDocument {
  id: string;
  type: string;
  slug: string;
  data: Record<string, unknown>;
}

export const RESERVED_KEYS = new Set(["_id", "_type", "_key", "slug"]);
export const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;

export function defineField(field: FieldDef): FieldDef {
  return field;
}

export function defineObject(object: ObjectDef): ObjectDef {
  return object;
}

export function defineDocument(document: DocumentDef): DocumentDef {
  return document;
}

export function defineSchema(schema: Schema): Schema {
  return schema;
}
