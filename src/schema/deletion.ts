import { systemMessage, type Translator } from "../editor/i18n/format";
import type { ContentDocument, DocumentDef, Schema } from "./types";
import { referrers, SchemaError } from "./validate";

export function isProtectedDocument(type: DocumentDef, slug: string): boolean {
  return type.shared === true || type.singleton === true || type.creatable === false || type.protectedSlugs?.includes(slug) === true;
}

export function assertDocumentUnreferenced(schema: Schema, documents: ContentDocument[], id: string, t: Translator = systemMessage): void {
  const remaining = documents.filter(doc => doc.id !== id && schema.documents.some(type => type.name === doc.type));
  if (referrers(remaining, id).length) throw new SchemaError(t("local.documentReferenced"));
}
