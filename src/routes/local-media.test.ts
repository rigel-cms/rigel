import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { APIContext } from "astro";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import config from "virtual:rigel-config";
import { GET, POST } from "./local-media";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "local", publicDir: "" } }));

const origin = "http://localhost:4321";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=", "base64");
let directory: string;
let publicDir: string;

beforeEach(async () => {
  const temp = path.resolve("_temp");
  await mkdir(temp, { recursive: true });
  directory = await mkdtemp(path.join(temp, "local-media-"));
  publicDir = path.join(directory, "custom public");
  config.publicDir = pathToFileURL(`${publicDir}/`).href;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function upload(body: BodyInit | null = png, headers: Record<string, string> = {}) {
  return POST({ request: new Request(`${origin}/rigel/api/local/media`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "image/png", ...headers },
    body,
    duplex: "half",
  } as RequestInit) } as APIContext);
}

test.each(['.private.pdf', '../file.pdf', 'folder/file.pdf', 'file\\evil.pdf', 'file.html', 'file.svg', 'file.js', 'file.exe', 'file.unknown'])('rejects unsafe explicit filename %s', async filename => {
  expect((await upload(Buffer.from('%PDF-1.4\n%%EOF'), { 'Content-Type': 'application/pdf', 'X-Rigel-Filename': filename })).status).toBe(415);
  expect(await readdir(directory)).toEqual([]);
});

test.each([
  ['file.pdf', 'application/pdf', '<html>unsafe</html>'],
  ['file.pdf', 'image/png', png],
  ['file.csv', 'text/csv', '<script>alert(1)</script>,x'],
  ['file.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'PK\u0003\u0004not a document'],
  ['file.mp4', 'video/mp4', 'not video'],
  ['file.zip', 'application/zip', 'not archive'],
])('rejects mismatched content %s', async (filename, type, bytes) => {
  expect((await upload(bytes, { 'Content-Type': type as string, 'X-Rigel-Filename': filename as string })).status).toBe(415);
});

test('PDF upload lists, reads with safe headers and preserves bytes', async () => {
  const bytes = Buffer.from('%PDF-1.4\n%%EOF');
  const response = await upload(bytes, { 'Content-Type': 'application/pdf', 'X-Rigel-Filename': 'document.pdf' });
  expect(response.status).toBe(200);
  const {url} = await response.json();
  const result = await GET({ params: { filename: url.split('/').pop() } } as unknown as APIContext);
  expect(result.headers.get('Content-Type')).toBe('application/pdf');
  expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(result.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
});

test("new uploads can be read immediately without waiting for the public-file watcher", async () => {
  const { url } = await (await upload()).json();
  const response = await GET({ params: { filename: url.split("/").pop() } } as unknown as APIContext);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
});

test.each(["../private", "file.svg", "a.png", undefined])("media reads reject filename %s", async (filename) => {
  const response = await GET({ params: { filename } } as unknown as APIContext);
  expect(response.status).toBe(404);
});

test("returns 500 for storage errors without leaking paths", async () => {
  await writeFile(publicDir, "not a directory");
  const response = await upload();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain(directory);
});

test("returns 500 when no Astro public directory is configured", async () => {
  config.publicDir = undefined;
  expect((await upload()).status).toBe(500);
  expect(await readdir(directory)).toEqual([]);
});

test("never overwrites an existing hash filename", async () => {
  const filename = `${createHash("sha256").update(png).digest("hex")}.png`;
  const mediaDir = path.join(publicDir, "rigel-media");
  await mkdir(mediaDir, { recursive: true });
  await writeFile(path.join(mediaDir, filename), "existing file");
  expect((await upload()).status).toBe(200);
  expect(await readFile(path.join(mediaDir, filename), "utf8")).toBe("existing file");
});

test("rejects WebP magic bytes with their high bits set", async () => {
  const bytes = Buffer.from("RIFF1234WEBP").map((byte) => byte | 0x80);
  expect((await upload(bytes, { "Content-Type": "image/webp" })).status).toBe(415);
  expect(await readdir(directory)).toEqual([]);
});

const limit = 10 * 1024 * 1024;

test("rejects oversized Content-Length without reading the body", async () => {
  const pull = vi.fn(() => { throw new Error("Body must not be read"); });
  const stream = new ReadableStream({ pull }, { highWaterMark: 0 });
  expect((await upload(stream, { "Content-Length": String(limit + 1) })).status).toBe(413);
  expect(pull).not.toHaveBeenCalled();
  expect(await readdir(directory)).toEqual([]);
});

test.each([undefined, "1"])("caps streamed bodies with Content-Length %s", async (length) => {
  let chunks = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (chunks++ === 0) controller.enqueue(png);
      else if (chunks <= 20) controller.enqueue(new Uint8Array(1024 * 1024));
      else controller.close();
    },
    cancel() { cancelled = true; },
  });
  const response = await upload(stream, length ? { "Content-Length": length } : {});
  expect(response.status).toBe(413);
  expect(cancelled).toBe(true);
  expect(chunks).toBeLessThan(20);
  expect(await readdir(directory)).toEqual([]);
});

test("accepts the exact 10 MiB boundary", async () => {
  const bytes = Buffer.alloc(limit);
  png.copy(bytes);
  const response = await upload(bytes);
  expect(response.status).toBe(200);
  const { url } = await response.json();
  expect((await readFile(path.join(publicDir, url))).equals(bytes)).toBe(true);
});

test.each(["-1", "nope", "1.5"])("rejects invalid Content-Length %s", async (length) => {
  expect((await upload(png, { "Content-Length": length })).status).toBe(400);
  expect(await readdir(directory)).toEqual([]);
});

test("returns 400 for a failed body stream without leaking errors", async () => {
  const stream = new ReadableStream({ start(controller) { controller.error(new Error(directory)); } });
  const response = await upload(stream);
  expect(response.status).toBe(400);
  expect(await response.text()).not.toContain(directory);
  expect(await readdir(directory)).toEqual([]);
});

test.each([
  ["image/jpeg", Buffer.from("ffd8ffe000104a464946000101", "hex"), "jpg"],
  ["image/webp", Buffer.from("RIFF\u0004\u0000\u0000\u0000WEBP"), "webp"],
] as const)("recognizes %s signatures", async (mime, bytes, extension) => {
  const response = await upload(bytes, { "Content-Type": mime, "Content-Disposition": 'attachment; filename="../../evil.svg"' });
  expect(response.status).toBe(200);
  const filename = `${createHash("sha256").update(bytes).digest("hex")}.${extension}`;
  expect(await response.json()).toEqual({ url: `/rigel-media/${filename}` });
  expect(await readFile(path.join(publicDir, "rigel-media", filename))).toEqual(bytes);
});

test.each([
  ["image/svg+xml", "<svg/>"],
  ["application/octet-stream", png],
  ["image/gif", "GIF89a"],
  ["", png],
  ["image/png", "<svg/>"],
  ["image/png", Buffer.from("89504e47", "hex")],
  ["image/jpeg", png],
  ["image/webp", png],
  ["image/webp", "RIFF1234WAVE"],
] as const)("rejects unsupported MIME or mismatched magic: %s %s", async (mime, bytes) => {
  const response = await upload(bytes, { "Content-Type": mime });
  expect(response.status).toBe(415);
  expect(await readdir(directory)).toEqual([]);
});

test.each([null, new Uint8Array()])("rejects empty bodies: %s", async (body) => {
  expect((await upload(body)).status).toBe(400);
  expect(await readdir(directory)).toEqual([]);
});

test.each([undefined, "", "null", "https://evil.example", "http://localhost:4322", `${origin}/path`, "not a URL"])("rejects Origin %s", async (value) => {
  const headers = new Headers({ "Content-Type": "image/png" });
  if (value !== undefined) headers.set("Origin", value);
  const response = await POST({ request: new Request(`${origin}/rigel/api/local/media`, {
    method: "POST", headers, body: png,
  }) } as APIContext);
  expect(response.status).toBe(403);
  expect(await readdir(directory)).toEqual([]);
});

test("rejects production requests", async () => {
  vi.stubEnv("PROD", true);
  expect((await upload()).status).toBe(404);
  expect(await readdir(directory)).toEqual([]);
});

test("uploads exact bytes to the configured public directory and reuses the hash URL", async () => {
  const filename = `${createHash("sha256").update(png).digest("hex")}.png`;
  const expected = { url: `/rigel-media/${filename}` };
  const first = await upload();
  expect(first.status).toBe(200);
  expect(first.headers.get("Content-Type")).toContain("application/json");
  expect(await first.json()).toEqual(expected);
  const file = path.join(publicDir, "rigel-media", filename);
  expect(await readFile(file)).toEqual(png);
  const before = await stat(file);
  const repeat = await upload();
  expect(repeat.status).toBe(200);
  expect(await repeat.json()).toEqual(expected);
  expect(await readFile(file)).toEqual(png);
  expect((await stat(file)).mtimeMs).toBe(before.mtimeMs);
  expect(await readdir(path.dirname(file))).toEqual([filename]);
});

test("video uploads are served inline so the player can stream them", async () => {
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41"),
    Buffer.alloc(64),
  ]);
  const response = await upload(mp4, { "Content-Type": "video/mp4", "X-Rigel-Filename": "clip.mp4" });
  expect(response.status).toBe(200);
  const { url } = await response.json();
  const result = await GET({ params: { filename: url.split("/").pop() } } as unknown as APIContext);
  expect(result.headers.get("Content-Type")).toBe("video/mp4");
  expect(result.headers.get("Content-Disposition")).toMatch(/^inline;/);
  expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await result.arrayBuffer())).toEqual(mp4);
});

test("videos allow a larger body than images while oversized uploads are still rejected", async () => {
  const header = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")]);
  const elevenMegabytes = Buffer.concat([header, Buffer.alloc(11 * 1024 * 1024)]);
  expect((await upload(elevenMegabytes, { "Content-Type": "video/mp4", "X-Rigel-Filename": "big.mp4" })).status).toBe(200);
  expect((await upload(Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]), { "Content-Type": "image/png", "X-Rigel-Filename": "big.png" })).status).toBe(413);
});
