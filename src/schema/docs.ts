import { isPlainObject } from "./validate";
import type { ContentDocument } from "./types";

export interface DocumentIndex {
  byId: Map<string, ContentDocument>;
  list: ContentDocument[];
}

export function buildDocumentIndex(documents: ContentDocument[]): DocumentIndex {
  const byId = new Map<string, ContentDocument>();
  for (const doc of documents) byId.set(doc.id, doc);
  return { byId, list: documents };
}

export function deref(value: unknown, index: DocumentIndex): ContentDocument | undefined {
  if (!isPlainObject(value) || typeof value._ref !== "string") return undefined;
  return index.byId.get(value._ref);
}

export function referencedIds(value: unknown): string[] {
  const ids: string[] = [];
  const visit = (current: unknown) => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (!isPlainObject(current)) return;
    if (typeof current._ref === "string") ids.push(current._ref);
    for (const child of Object.values(current)) visit(child);
  };
  visit(value);
  return [...new Set(ids)];
}
