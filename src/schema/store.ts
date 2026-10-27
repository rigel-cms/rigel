import { randomUUID } from "node:crypto";
import { systemMessage, type Translator } from "../editor/i18n/format";
import { link, lstat, mkdir, open, readdir, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { isPlainObject } from "./validate";
import { SLUG_PATTERN, type ContentDocument, type Schema } from "./types";
import { normalizeUrlSlug, validateDocumentSlugs } from "../slugs";
import type { PreviewConfig } from "../preview";
import { serializeContentJson, type JsonOutput } from "../json-output";

const MAX_BYTES = 1024 * 1024;
const FOLDER_PART = /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/;

export class DocumentStoreError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

async function resolveRoot(root: string): Promise<string> {
  const real = await realpath(root).catch(() => {
    throw new DocumentStoreError("Site root is unavailable", 500);
  });
  return real;
}

async function resolveFolder(root: string, folder: string): Promise<string> {
  if (!folder.split("/").every((part) => FOLDER_PART.test(part))) throw new DocumentStoreError("Unsafe document folder", 500);
  let directory = await resolveRoot(root);
  for (const part of folder.split("/")) {
    directory = path.join(directory, part);
    const info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) throw new DocumentStoreError(`Document folder ${folder} does not exist`, 500);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new DocumentStoreError(`Document folder ${folder} must contain only real directories`, 500);
  }
  return directory;
}

async function readJsonFile(file: string, t: Translator): Promise<unknown> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new DocumentStoreError("Document must be a regular file", 500);
  if (info.size > MAX_BYTES) throw new DocumentStoreError(t("local.documentTooLarge"), 413);
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function ensureFolder(root: string, folder: string): Promise<string> {
  if (!folder.split("/").every((part) => FOLDER_PART.test(part))) throw new DocumentStoreError("Unsafe document folder", 500);
  let directory = await resolveRoot(root);
  for (const part of folder.split("/")) {
    directory = path.join(directory, part);
    let info = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) {
      await mkdir(directory);
      info = await lstat(directory);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new DocumentStoreError(`Document folder ${folder} must contain only real directories`, 500);
  }
  return directory;
}

export async function readDocuments(schema: Schema, root: string, preview?: PreviewConfig, t: Translator = systemMessage): Promise<ContentDocument[]> {
  const documents: ContentDocument[] = [];
  for (const type of schema.documents) {
    let directory: string;
    try {
      directory = await resolveFolder(root, type.folder);
    } catch (error) {
      if (error instanceof DocumentStoreError && error.status === 500 && /does not exist/.test(error.message)) continue;
      throw error;
    }
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    for (const name of names) {
      const slug = name.slice(0, -5);
      if (!SLUG_PATTERN.test(slug)) throw new DocumentStoreError(`Invalid document filename ${name}`, 500);
      const data = await readJsonFile(path.join(directory, name), t);
      if (!isPlainObject(data)) throw new DocumentStoreError(`Document ${name} must be a JSON object`, 500);
      if (data._type !== undefined && data._type !== type.name) throw new DocumentStoreError(`${name}: _type must be ${type.name}`, 500);
      documents.push({ id: `${type.name}:${slug}`, type: type.name, slug, data: data as Record<string, unknown> });
    }
  }
  try { validateDocumentSlugs(schema, documents, preview, t); }
  catch (error) { throw new DocumentStoreError((error as Error).message); }
  return documents;
}

export async function readDocument(schema: Schema, root: string, typeName: string, slug: string, t: Translator = systemMessage): Promise<ContentDocument | null> {
  const documents = await readDocuments(schema, root, undefined, t);
  return documents.find((doc) => doc.type === typeName && doc.slug === slug) ?? null;
}

let writes: Promise<void> = Promise.resolve();
export function writeDocument(...args: Parameters<typeof writeDocumentFile>): Promise<void> {
  const result = writes.then(() => writeDocumentFile(...args));
  writes = result.catch(() => {});
  return result;
}

async function writeDocumentFile(
  schema: Schema,
  root: string,
  typeName: string,
  slug: string,
  data: Record<string, unknown>,
  mode: "create" | "update",
  preview?: PreviewConfig,
  jsonOutput?: JsonOutput,
  t: Translator = systemMessage,
): Promise<void> {
  const type = schema.documents.find((entry) => entry.name === typeName);
  if (!type) throw new DocumentStoreError(t("local.unknownDocumentType", { type: typeName }), 404);
  if (mode === "create" && (type.creatable === false || type.singleton)) throw new DocumentStoreError(t("local.creatingDisabled"), 403);
  if (!SLUG_PATTERN.test(slug)) throw new DocumentStoreError(t("local.invalidDocumentSlug"), 400);
  if (!isPlainObject(data)) throw new DocumentStoreError(t("local.documentObjectRequired"), 400);
  const directory = await ensureFolder(root, type.folder);
  const file = path.join(directory, `${slug}.json`);
  const existing = await lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) throw new DocumentStoreError("Document path is unsafe", 409);
  if (mode === "create" && existing) throw new DocumentStoreError(t("local.documentExists"), 409);
  if (mode === "update" && !existing) throw new DocumentStoreError(t("local.documentNotFound"), 404);
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_BYTES) throw new DocumentStoreError(t("local.documentTooLarge"), 413);
  data = { ...data };
  try {
    if (!type.shared && Object.hasOwn(data, "slug")) data.slug = normalizeUrlSlug(data.slug, t);
    const documents = await readDocuments(schema, root, preview, t);
    validateDocumentSlugs(schema, [...documents.filter(doc => doc.id !== `${typeName}:${slug}`), { id: `${typeName}:${slug}`, type: typeName, slug, data }], preview, t);
  } catch (error) { throw new DocumentStoreError((error as Error).message); }
  const serialized = serializeContentJson(data, jsonOutput);
  if (Buffer.byteLength(serialized) > MAX_BYTES) throw new DocumentStoreError(t("local.documentTooLarge"), 413);
  const temporary = path.join(directory, `.${slug}-${randomUUID()}.tmp`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode === "create") await link(temporary, file);
    else await rename(temporary, file);
  } catch (error) {
    if (error instanceof DocumentStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new DocumentStoreError(t("local.documentExists"), 409);
    throw new DocumentStoreError(t("local.writeDocumentFailed"), 500);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
