import { expect, test } from "vitest";
import { collectionFingerprint, readCollectionLedger, COLLECTION_LEDGER } from "./collection-ledger";

const collection = { name: "blog", label: "Blog", fields: [{ key: "title", label: "Title", type: "string" as const }], posts: [] };
test("collection ledgers accept only versioned metadata with exact blob identities and current configuration", () => {
  const ledger = { version: 1, fingerprint: collectionFingerprint(collection), entries: [{ slug: "hello", sha: "a".repeat(40), frontmatter: { title: "Hello" } }] };
  expect(COLLECTION_LEDGER).toBe(".rigel-collection.json");
  expect(readCollectionLedger(JSON.stringify(ledger), collection)).toEqual(ledger.entries);
  for (const invalid of ["{", JSON.stringify({ ...ledger, version: 2 }), JSON.stringify({ ...ledger, fingerprint: "old" }), JSON.stringify({ ...ledger, entries: [...ledger.entries, ...ledger.entries] }), JSON.stringify({ ...ledger, entries: [{ ...ledger.entries[0], slug: "../escape" }] }), JSON.stringify({ ...ledger, entries: [{ ...ledger.entries[0], body: {} }] })]) expect(readCollectionLedger(invalid, collection)).toBeNull();
  expect(readCollectionLedger(JSON.stringify(ledger), { ...collection, columns: ["title"] })).toBeNull();
});
