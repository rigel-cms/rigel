import type { ManifestCollection } from "./types";
import { isPlainObject } from "../schema/validate";

export const COLLECTION_LEDGER = ".rigel-collection.json";
export interface CollectionLedgerEntry { slug: string; sha: string; frontmatter: Record<string, unknown> }
type Shape = Pick<ManifestCollection, "name" | "fields" | "columns" | "locale">;

export function collectionFingerprint(collection: Shape): string {
  return JSON.stringify([collection.name, collection.locale ?? null, collection.fields, collection.columns ?? null]);
}

export function serializeCollectionLedger(collection: Shape, entries: CollectionLedgerEntry[]): string {
  return JSON.stringify({ version: 1, fingerprint: collectionFingerprint(collection), entries: [...entries].sort((a, b) => a.slug.localeCompare(b.slug)) }) + "\n";
}

export function readCollectionLedger(text: string, collection: Shape): CollectionLedgerEntry[] | null {
  try {
    const data = JSON.parse(text);
    if (!isPlainObject(data) || data.version !== 1 || data.fingerprint !== collectionFingerprint(collection) || !Array.isArray(data.entries)) return null;
    const slugs = new Set<string>();
    for (const entry of data.entries) {
      if (!isPlainObject(entry) || Object.keys(entry).some(key => !["slug", "sha", "frontmatter"].includes(key)) || typeof entry.slug !== "string" || !/^[a-z0-9][a-z0-9_-]*$/.test(entry.slug) || typeof entry.sha !== "string" || !/^[a-f0-9]{40}$/.test(entry.sha) || !isPlainObject(entry.frontmatter) || slugs.has(entry.slug)) return null;
      slugs.add(entry.slug);
    }
    return data.entries as unknown as CollectionLedgerEntry[];
  } catch { return null; }
}
