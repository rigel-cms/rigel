import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CollectionConfig } from "../config";
import type { ContentDocument } from "../schema/types";
import { validateBody } from "../article-body";
import { validateCollectionValues } from "./collections";
import { assertUniqueUrlSlugs } from "../slugs";
import { COLLECTION_LEDGER, serializeCollectionLedger, type CollectionLedgerEntry } from "./collection-ledger";
import { systemMessage, type Translator } from "../editor/i18n/format";

let writes: Promise<unknown> = Promise.resolve();
export function collectionWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writes.then(operation); writes = result.catch(() => {}); return result;
}

export async function safeCollectionFile(folder: string, name: string, t: Translator = systemMessage): Promise<string> {
  const directory = path.resolve(folder);
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(t("connection.invalidDirectory"));
  }
  const file = path.join(directory, name);
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(t("connection.invalidFile"));
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return file;
}

export async function rebuildCollectionLedger(collection: CollectionConfig, documents: ContentDocument[] = [], t: Translator = systemMessage, signal?: AbortSignal): Promise<number> {
  const ledger = await safeCollectionFile(collection.folder, COLLECTION_LEDGER, t);
  const entries: CollectionLedgerEntry[] = [];
  for (const name of (await readdir(collection.folder)).filter(name => name.endsWith(".json") && name !== COLLECTION_LEDGER).sort()) {
    signal?.throwIfAborted();
    if (!/^[a-z0-9][a-z0-9_-]*\.json$/.test(name)) throw new Error(t("connection.invalidRemoteFilename"));
    const file = await safeCollectionFile(collection.folder, name, t), bytes = await readFile(file);
    const post = JSON.parse(bytes.toString("utf8"));
    validateBody(post.body, t); validateCollectionValues(collection.fields, post.frontmatter, documents, t);
    entries.push({ slug: name.slice(0, -5), sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"), frontmatter: post.frontmatter });
  }
  assertUniqueUrlSlugs(entries.map(entry => ({ slug: entry.slug, values: entry.frontmatter })), t);
  const temporary = `${ledger}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await writeFile(temporary, serializeCollectionLedger(collection, entries), { flag: "wx" });
    await safeCollectionFile(collection.folder, COLLECTION_LEDGER, t);
    signal?.throwIfAborted();
    await rename(temporary, ledger);
  } finally { await rm(temporary, { force: true }); }
  return entries.length;
}
