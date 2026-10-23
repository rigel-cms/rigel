import type { APIRoute } from "astro";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mediaDirectory, listMedia, loadMediaSidecar, writeMediaSidecar, validateMetaUpdate } from "./media-files";
import { mediaMetadata, safeMediaName } from "../media-types";
import { validMediaBytes } from "./media-validation";
import config from "virtual:rigel-config";

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const filename = params.filename ?? "";
  if (import.meta.env.PROD || !safeMediaName(filename) || filename.startsWith(".") || /[/\\\u0000]/.test(filename)) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const file = path.join(await mediaDirectory(config.publicDir!, config.mediaDir), filename);
    if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new Error();
    const bytes = await readFile(file);
    const metadata = mediaMetadata(filename)!;
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": metadata.type,
      "Content-Disposition": `${metadata.category === "Images" ? "inline" : "attachment"}; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};

export const POST: APIRoute = async ({ request }) => {
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
  if (!metadata || metadata.type !== mime) return new Response("Unsupported or mismatched media type/filename", { status: 415 });
  const limit = 10 * 1024 * 1024;
  const length = request.headers.get("Content-Length");
  if (length !== null && !/^\d+$/.test(length)) {
    return new Response("Invalid Content-Length", { status: 400 });
  }
  if (length !== null && Number(length) > limit) {
    return new Response("Image exceeds 10 MiB", { status: 413 });
  }
  if (!request.body) return new Response("Empty image body", { status: 400 });
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
        return new Response("Image exceeds 10 MiB", { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response("Could not read image body", { status: 400 });
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  if (!bytes.length) return new Response("Empty image body", { status: 400 });
  const extension = metadata.extension === "jpeg" ? "jpg" : metadata.extension;
  if (!validMediaBytes(bytes, extension)) return new Response("Media type does not match its bytes", { status: 415 });
  const filename = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  let url = "";
  try {
    const directory = await mediaDirectory(config.publicDir!, config.mediaDir, true);
    const existing = await lstat(path.join(directory, filename)).catch(error => { if (error.code !== "ENOENT") throw error; });
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error();
    try {
      await writeFile(path.join(directory, filename), bytes, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    url = `/${(config.mediaDir ?? "rigel-media").split("/").map(encodeURIComponent).join("/")}/${filename}`;
    const author = (request.headers.get("X-Rigel-Author") ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
    if (author) {
      const record = await loadMediaSidecar(directory);
      record[url] = { ...(record[url] ?? {}), author };
      await writeMediaSidecar(directory, record);
    }
  } catch {
    return new Response("Could not save image", { status: 500 });
  }
  return Response.json({ url });
  };

  export const PUT: APIRoute = async ({ request }) => {
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
    catch { return new Response("Media directory unavailable", { status: 500 }); }
    const assets = await listMedia(config.publicDir!, config.mediaDir);
    const valid = validateMetaUpdate(body, new Set(assets.map(asset => asset.url)));
    if (!valid.ok) return new Response(valid.error, { status: 400 });
    const record = await loadMediaSidecar(directory);
    const patch: { name?: string; title?: string; description?: string; alt?: string } = {};
    if (valid.value.name !== undefined) patch.name = valid.value.name;
    if (valid.value.title !== undefined) patch.title = valid.value.title;
    if (valid.value.description !== undefined) patch.description = valid.value.description;
    if (valid.value.alt !== undefined) patch.alt = valid.value.alt;
    record[valid.value.url] = { ...(record[valid.value.url] ?? {}), ...patch };
    await writeMediaSidecar(directory, record);
    return Response.json((await listMedia(config.publicDir!, config.mediaDir)).find(asset => asset.url === valid.value.url) ?? { url: valid.value.url });
  };
