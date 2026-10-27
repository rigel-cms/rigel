import type { APIRoute } from "astro";
import { requestTranslator } from "../editor/i18n/server";
import { randomUUID } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mediaDirectory, listMedia, updateMediaSidecar, deleteMediaFile, validateMetaUpdate } from "./media-files";
import { DEFAULT_MAX_FILE_SIZE, mediaHeaders, mediaMetadata, safeMediaName } from "../media-types";
import { validMediaBytes } from "./media-validation";
import config from "virtual:rigel-config";

export const prerender = false;

export const GET: APIRoute = async ({ params, request }) => {
  const t = requestTranslator(request);
  const filename = params.filename ?? "";
  if (import.meta.env.PROD || !safeMediaName(filename) || filename.startsWith(".") || /[/\\\u0000]/.test(filename)) {
    return new Response(t("local.notFound"), { status: 404 });
  }
  try {
    const file = path.join(await mediaDirectory(config.publicDir!, config.mediaDir), filename);
    if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new Error();
    const bytes = await readFile(file);
    return new Response(new Uint8Array(bytes), { headers: mediaHeaders(filename, new URL(request.url).searchParams.get("preview") === "1") });
  } catch {
    return new Response(t("local.notFound"), { status: 404 });
  }
};

export const POST: APIRoute = async ({ request }) => {
  const t = requestTranslator(request);
  if (import.meta.env.PROD) {
    return new Response("Local backend is dev-only", { status: 404 });
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return new Response("Same-origin request required", { status: 403 });
  }
  const mime = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  const supplied = request.headers.get("X-Rigel-Filename");
  const fallback = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mime ?? ""];
  const metadata = supplied ? (safeMediaName(supplied) ? mediaMetadata(supplied) : undefined) : fallback ? mediaMetadata(`image.${fallback}`) : undefined;
  if (!metadata || metadata.type !== mime) return new Response(t("local.unsupportedMedia"), { status: 415 });
  const limit = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const length = request.headers.get("Content-Length");
  if (length !== null && !/^\d+$/.test(length)) {
    return new Response("Invalid Content-Length", { status: 400 });
  }
  if (length !== null && Number(length) > limit) {
    return new Response(t("local.mediaTooLarge", { limit: limit / 1024 / 1024 }), { status: 413 });
  }
  if (!request.body) return new Response(t("local.emptyMedia"), { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        void reader.cancel().catch(() => {});
        return new Response(t("local.mediaTooLarge", { limit: limit / 1024 / 1024 }), { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response(t("local.readImageFailed"), { status: 400 });
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  if (!bytes.length) return new Response(t("local.emptyImage"), { status: 400 });
  const extension = metadata.extension === "jpeg" ? "jpg" : metadata.extension;
  if (!validMediaBytes(bytes, extension)) return new Response(t("local.mediaBytesMismatch"), { status: 415 });
  const filename = `${randomUUID()}.${extension}`;
  let url = "";
  try {
    const directory = await mediaDirectory(config.publicDir!, config.mediaDir, true);
    const existing = await lstat(path.join(directory, filename)).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error();
    await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
    url = `/${(config.mediaDir ?? "rigel-media").split("/").map(encodeURIComponent).join("/")}/${filename}`;
    const author = (request.headers.get("X-Rigel-Author") ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
    await updateMediaSidecar(directory, url, author ? { author } : {}, { name: (supplied ?? filename).slice(0, 120) });
  } catch {
    return new Response(t("local.saveImageFailed"), { status: 500 });
  }
  return Response.json({ url });
  };

  export const PUT: APIRoute = async ({ request }) => {
  const t = requestTranslator(request);
    if (import.meta.env.PROD) {
      return new Response("Local backend is dev-only", { status: 404 });
    }
    if (request.headers.get("Origin") !== new URL(request.url).origin) {
      return new Response("Same-origin request required", { status: 403 });
    }
    let body: unknown;
    try { body = await request.json(); } catch { return new Response("Invalid JSON body", { status: 400 }); }
    let directory: string;
    try { directory = await mediaDirectory(config.publicDir!, config.mediaDir, true); }
    catch { return new Response(t("local.mediaDirectoryUnavailable"), { status: 500 }); }
    const assets = await listMedia(config.publicDir!, config.mediaDir);
    const valid = validateMetaUpdate(body, new Set(assets.map(asset => asset.url)), t);
    if (!valid.ok) return new Response(valid.error, { status: 400 });
    const patch: { name?: string; title?: string; description?: string; alt?: string } = {};
    if (valid.value.name !== undefined) patch.name = valid.value.name;
    if (valid.value.title !== undefined) patch.title = valid.value.title;
    if (valid.value.description !== undefined) patch.description = valid.value.description;
    if (valid.value.alt !== undefined) patch.alt = valid.value.alt;
    try {
      const file = path.join(fileURLToPath(config.publicDir!), ...valid.value.url.slice(1).split("/").map(decodeURIComponent));
      await updateMediaSidecar(directory, valid.value.url, patch, {}, file);
    } catch (error) {
      return new Response(t("local.saveMetadataFailed"), { status: (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500 });
    }
    return Response.json((await listMedia(config.publicDir!, config.mediaDir)).find(asset => asset.url === valid.value.url) ?? { url: valid.value.url });
  };

export const DELETE: APIRoute = async ({ request }) => {
  const t = requestTranslator(request);
  if (import.meta.env.PROD) return new Response("Local backend is dev-only", { status: 404 });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return new Response("Same-origin request required", { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return new Response("Invalid JSON body", { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !("url" in body) || typeof body.url !== "string") return new Response(t("local.mediaUrlRequired"), { status: 400 });
  try {
    if (!await deleteMediaFile(config.publicDir!, config.mediaDir, body.url)) return new Response(t("local.fileNotFound"), { status: 404 });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(t("local.deleteFileFailed"), { status: 500 });
  }
};
