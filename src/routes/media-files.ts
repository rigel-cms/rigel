import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaMetadata, safeMediaName } from "../media-types";
import { fileURLToPath } from "node:url";
import { systemMessage, type Translator } from "../editor/i18n/format";

export const imageFile = /\\.(jpe?g|png|webp|gif|avif)$/i;
const SIDECAR = ".rigel-media.json";
const META_KEYS: Record<string, number> = { name: 120, title: 200, description: 1000, alt: 1000, author: 80 };
export interface MediaMeta { name?: string; title?: string; description?: string; alt?: string; author?: string; }
export interface ListedAsset extends MediaMeta { url: string; name: string; type: string; size: number; modified: string; }

export function mediaFolder(folder = "rigel-media") {
  if (!folder.split("/").every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(part))) throw new Error("Invalid media folder");
  return folder;
}
export async function mediaDirectory(publicDir: string, folder = "rigel-media", create = false) {
  mediaFolder(folder);
  if (create) await mkdir(fileURLToPath(publicDir), { recursive: true });
  let directory = await realpath(fileURLToPath(publicDir));
  for (const part of folder.split("/")) {
    directory = path.join(directory, part);
    if (create) await mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe media directory");
  }
  return directory;
}

function sanitize(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
  return clean || undefined;
}

/** User-facing renameable label: safe chars + length, no extension required (text display name). */
export function safeDisplayName(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 120
    && !value.startsWith(".") && /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(value);
}

async function sidecarPath(directory: string) { return path.join(directory, SIDECAR); }

export async function loadMediaSidecar(directory: string): Promise<Record<string, MediaMeta>> {
  let text: string;
  try { text = await readFile(await sidecarPath(directory), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return {}; }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, MediaMeta> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const meta: MediaMeta = {};
      for (const [k, max] of Object.entries(META_KEYS)) {
        const clean = sanitize((value as Record<string, unknown>)[k], max);
        if (clean !== undefined) meta[k as keyof MediaMeta] = clean;
      }
      out[key] = meta;
    }
    return out;
  } catch { return {}; }
}

export async function writeMediaSidecar(directory: string, record: Record<string, MediaMeta>): Promise<void> {
  const target = await sidecarPath(directory);
  const tmp = path.join(directory, `.${SIDECAR}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(record, null, 2), { flag: "wx" });
  await rename(tmp, target);
}

let pendingSidecarWrite: Promise<unknown> = Promise.resolve();
function queueMediaWrite<T>(operation: () => Promise<T>): Promise<T> {
  const update = pendingSidecarWrite.catch(() => {}).then(operation);
  pendingSidecarWrite = update;
  return update;
}
export function updateMediaSidecar(directory: string, url: string, patch: MediaMeta, defaults: MediaMeta = {}, file?: string): Promise<void> {
  return queueMediaWrite(async () => {
    if (file) {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe media file");
    }
    const record = await loadMediaSidecar(directory);
    record[url] = { ...defaults, ...(record[url] ?? {}), ...patch };
    await writeMediaSidecar(directory, record);
  });
}
export function deleteMediaFile(publicDir: string, folder: string | undefined, url: string): Promise<boolean> {
  return queueMediaWrite(async () => {
    if (!(await listMedia(publicDir, folder)).some(asset => asset.url === url)) return false;
    const relative = decodeURIComponent(url.slice(1));
    const parent = await mediaDirectory(publicDir, path.posix.dirname(relative));
    const file = path.join(parent, path.posix.basename(relative));
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Unsafe media file");
    const directory = await mediaDirectory(publicDir, folder);
    const record = await loadMediaSidecar(directory), next = { ...record };
    delete next[url];
    await writeMediaSidecar(directory, next);
    try { await unlink(file); }
    catch (error) { await writeMediaSidecar(directory, record); throw error; }
    return true;
  });
}

export function validateMetaUpdate(
  body: unknown,
  existing: Set<string>,
  message: Translator = systemMessage,
): { ok: true; value: { url: string; name?: string; title?: string; description?: string; alt?: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: message("local.invalidMetadataBody") };
  const b = body as Record<string, unknown>;
  const allowed = ["url", "name", "title", "description", "alt"];
  if (Object.keys(b).some(key => !allowed.includes(key))) return { ok: false, error: message("local.unknownMetadataField") };
  if (typeof b.url !== "string" || !existing.has(b.url)) return { ok: false, error: message("local.unknownAsset") };
  const value: { url: string; name?: string; title?: string; description?: string; alt?: string } = { url: b.url };
  if ("name" in b) {
    const candidate = typeof b.name === "string" ? b.name.trim() : b.name;
    if (!safeDisplayName(candidate)) return { ok: false, error: message("local.invalidDisplayName") };
    value.name = typeof candidate === "string" ? candidate : undefined;
  }
  if ("title" in b) {
    if (typeof b.title !== "string") return { ok: false, error: message("local.metadataTitleString") };
    value.title = sanitize(b.title, 200);
  }
  if ("description" in b) {
    if (typeof b.description !== "string") return { ok: false, error: message("local.metadataDescriptionString") };
    value.description = sanitize(b.description, 1000);
  }
  if ("alt" in b) {
    if (typeof b.alt !== "string") return { ok: false, error: message("local.metadataAltString") };
    if (!mediaMetadata(b.url)?.type.startsWith("image/")) return { ok: false, error: message("local.metadataAltImagesOnly") };
    value.alt = sanitize(b.alt.replace(/\s+/g, " "), 1000) ?? "";
  }
  return { ok: true, value };
}

export async function listMedia(publicDir: string, folder = "rigel-media") {
  const assets: ListedAsset[] = [];
  let directory = "";
  try { directory = await mediaDirectory(publicDir, folder); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!directory) return assets;
  const sidecar = await loadMediaSidecar(directory);
  async function walk(current: string, relative = "") {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const name = relative + entry.name;
      if (entry.isDirectory()) await walk(path.join(current, entry.name), name + "/");
      else if (entry.isFile() && safeMediaName(entry.name)) {
        const info = await lstat(path.join(current, entry.name));
        if (!info.isFile()) continue;
        const metadata = mediaMetadata(name)!;
        const url = "/" + `${folder}/${name}`.split("/").map(encodeURIComponent).join("/");
        const meta = sidecar[url] ?? {};
        assets.push({ name: meta.name ?? name, url, type: metadata.type, size: info.size, modified: info.mtime.toISOString(), title: meta.title, description: meta.description, alt: meta.alt, author: meta.author });
      }
    }
  }
  await walk(directory);
  return assets.sort((a, b) => a.name.localeCompare(b.name));
}