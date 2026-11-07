import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { rebuildDocumentLedger } from "./collection-ledger-store";
import { documentLedgerShape, documentMetadata, validDocumentMetadata } from "./document-ledger";
import { readDocuments } from "../schema/store";
import type { Schema } from "../schema/types";
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


test("local document metadata uses the existing ledger, exact source SHAs, excludes bodies and is ignored as source content", async () => {
  await mkdir(path.resolve("_temp"), { recursive: true });
  const root = await mkdtemp(path.resolve("_temp/document-ledger-"));
  const schema: Schema = { objects: [], documents: [{ name: "page", title: "Page", type: "document", folder: "pages", fields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "secret", label: "Secret", type: "password" }, { key: "body", label: "Body", type: "markdown" }], columns: ["secret", "body"] }] };
  try {
    await mkdir(path.join(root, "pages"));
    const text = JSON.stringify({ title: "One", secret: "private", body: "Full body", unknown: { _ref: "page:one" } });
    await writeFile(path.join(root, "pages/one.json"), text);
    const documents = await readDocuments(schema, root);
    await rebuildDocumentLedger(root, schema, schema.documents[0], documents);
    const entries = readCollectionLedger(await readFile(path.join(root, "pages", COLLECTION_LEDGER), "utf8"), documentLedgerShape(schema.documents[0], schema))!;
    expect(entries).toEqual([{ slug: "one", sha: createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"), frontmatter: { title: "One", _references: [{ _ref: "page:one" }] } }]);
    expect(await readDocuments(schema, root)).toEqual(documents);
    expect(documentMetadata(schema.documents[0], documents[0].data)).not.toHaveProperty("body");
    expect(validDocumentMetadata({ _references: [], slug: false })).toBe(false);
    expect(validDocumentMetadata({ _references: [{ _ref: "invalid" }] })).toBe(false);
    const aborted = new AbortController(); aborted.abort();
    await expect(rebuildDocumentLedger(root, schema, schema.documents[0], documents, undefined, aborted.signal)).rejects.toThrow();
    expect(await readFile(path.join(root, "pages/one.json"), "utf8")).toBe(text);
  } finally { await rm(root, { recursive: true, force: true }); }
});
