import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { APIContext } from "astro";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import config from "virtual:rigel-config";
import { GET, POST, DELETE } from "./local-media";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "local", publicDir: "" } }));
vi.mock("node:fs/promises", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return { ...fs, unlink: vi.fn(fs.unlink) };
});

const origin = "http://localhost:4321";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=", "base64");
let directory: string;
let publicDir: string;

beforeEach(async () => {
  config.maxFileSize = undefined;
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

function removeMedia(body: unknown, requestOrigin: string | null = origin) {
  return DELETE({ request: new Request(`${origin}/rigel/api/local/media`, {
    method: "DELETE", headers: { "Content-Type": "application/json", ...(requestOrigin === null ? {} : { Origin: requestOrigin }) }, body: JSON.stringify(body),
  }) } as APIContext);
}

test("deleting an uploaded file removes its bytes and ledger entry, not other assets", async () => {
  expect(DELETE).toBeTypeOf("function");
  const { url } = await (await upload()).json();
  const other = await (await upload(Buffer.concat([png, Buffer.from("other")]))).json();
  expect((await removeMedia({ url })).status).toBe(204);
  await expect(readFile(path.join(publicDir, url))).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(path.join(publicDir, other.url))).toEqual(Buffer.concat([png, Buffer.from("other")]));
  const ledger = JSON.parse(await readFile(path.join(publicDir, "rigel-media/.rigel-media.json"), "utf8"));
  expect(ledger[url]).toBeUndefined();
  expect(ledger[other.url]).toBeDefined();
  expect((await removeMedia({ url })).status).toBe(404);
});

test.each([null, [], {}, { url: 4 }, { url: "/rigel-media/a.png", extra: true }])("delete rejects malformed body %j", async body => {
  expect((await removeMedia(body)).status).toBe(400);
});

test.each(["/rigel-media/../private.txt", "/rigel-media/%2e%2e/private.txt", "/rigel-media/.rigel-media.json", "https://evil.test/a.png", "/outside/a.png"]) ("delete rejects unlisted URL %s", async url => {
  expect((await removeMedia({ url })).status).toBe(404);
  expect(await readdir(directory)).toEqual([]);
});

test("delete requires same origin and is unavailable in production", async () => {
  const { url } = await (await upload()).json();
  for (const otherOrigin of [null, "https://evil.test"]) expect((await removeMedia({ url }, otherOrigin)).status).toBe(403);
  vi.stubEnv("PROD", true);
  expect((await removeMedia({ url })).status).toBe(404);
  expect(await readFile(path.join(publicDir, url))).toEqual(png);
});

test("delete supports nested files but never follows file or directory symlinks", async () => {
  const { url } = await (await upload()).json();
  const media = path.join(publicDir, "rigel-media");
  await mkdir(path.join(media, "nested"));
  await writeFile(path.join(media, "nested/notes.txt"), "notes");
  await symlink(path.join(publicDir, url), path.join(media, "linked.png"));
  await symlink(path.join(media, "nested"), path.join(media, "linked-directory"));
  for (const url of ["/rigel-media/linked.png", "/rigel-media/linked-directory/notes.txt"]) expect((await removeMedia({ url })).status).toBe(404);
  expect((await removeMedia({ url: "/rigel-media/nested/notes.txt" })).status).toBe(204);
  expect(await readFile(path.join(publicDir, url))).toEqual(png);
  await expect(readFile(path.join(media, "nested/notes.txt"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("failed file removal restores metadata and allows retry", async () => {
  const { url } = await (await upload()).json();
  const ledger = path.join(publicDir, "rigel-media/.rigel-media.json");
  const before = await readFile(ledger, "utf8");
  vi.mocked(unlink).mockRejectedValueOnce(new Error("Removal failed"));
  expect((await removeMedia({ url })).status).toBe(500);
  expect(await readFile(path.join(publicDir, url))).toEqual(png);
  expect(await readFile(ledger, "utf8")).toBe(before);
  expect((await removeMedia({ url })).status).toBe(204);
});

test("delete rejects malformed JSON before touching files", async () => {
  const response = await DELETE({ request: new Request(`${origin}/rigel/api/local/media`, { method:"DELETE", headers:{ Origin:origin, "Content-Type":"application/json" }, body:"{" }) } as APIContext);
  expect(response.status).toBe(400);
  expect(await readdir(directory)).toEqual([]);
});

test("ledger failure leaves the file intact and does not poison subsequent deletes", async () => {
  const { url } = await (await upload()).json();
  const ledger = path.join(publicDir, "rigel-media/.rigel-media.json");
  await rm(ledger); await mkdir(ledger);
  const failed = await removeMedia({ url });
  expect(failed.status).toBe(500);
  expect(await failed.text()).not.toContain(publicDir);
  expect(await readFile(path.join(publicDir, url))).toEqual(png);
  await rm(ledger, { recursive:true });
  expect((await removeMedia({ url })).status).toBe(204);
});

test.each(['.private.pdf', '../file.pdf', 'folder/file.pdf', 'file\\evil.pdf', 'file.html', 'file.svg', 'file.js', 'file.exe', 'file.unknown'])('rejects unsafe explicit filename %s', async filename => {
  expect((await upload(Buffer.from('%PDF-1.4\n%%EOF'), { 'Content-Type': 'application/pdf', 'X-Rigel-Filename': filename })).status).toBe(415);
  expect(await readdir(directory)).toEqual([]);
});

test.each([
  ['file.pdf', 'application/pdf', '<html>unsafe</html>'],
  ['file.pdf', 'image/png', png],
  ['file.csv', 'text/csv', '<script>alert(1)</script>,x'],
  ['file.txt', 'text/plain', Buffer.from([0xff])],
  ['file.txt', 'text/plain', 'binary\u0000text'],
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
  const result = await GET({ params: { filename: url.split('/').pop() }, request: new Request(origin + url) } as unknown as APIContext);
  expect(result.headers.get('Content-Type')).toBe('application/pdf');
  expect(result.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(result.headers.get('Content-Disposition')).toMatch(/^attachment;/);
  expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
});

test.each([
  ['document.pdf', 'application/pdf', '%PDF-1.4\n%%EOF', 'inline'],
  ['notes.txt', 'text/plain', 'Café meeting notes\n<script>parent.documentPreviewExecuted = true</script>', 'inline'],
  ['sheet.csv', 'text/csv', 'name,value\nExample,1\n', 'attachment'],
])('preview opt-in preserves safe MIME and download behavior: %s', async (name, type, bytes, disposition) => {
  const uploaded = await upload(bytes, { 'Content-Type': type, 'X-Rigel-Filename': name });
  expect(uploaded.status).toBe(200);
  const { url } = await uploaded.json();
  for (const preview of ['', '?preview=1']) {
    const response = await GET({ params: { filename: url.split('/').pop() }, request: new Request(origin + url + preview) } as unknown as APIContext);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe(type === 'text/plain' ? 'text/plain; charset=utf-8' : type);
    expect(response.headers.get('Content-Disposition')).toMatch(new RegExp(`^${preview ? disposition : 'attachment'};`));
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(bytes));
  }
});

test.each([undefined, "Team portrait.png"])("every upload has a ledger entry without an author header: %s", async supplied => {
  const response = await upload(png, supplied ? { "X-Rigel-Filename": supplied } : {});
  expect(response.status).toBe(200);
  const { url } = await response.json();
  const ledger = JSON.parse(await readFile(path.join(publicDir, "rigel-media", ".rigel-media.json"), "utf8"));
  expect(ledger[url]).toEqual({ name: supplied ?? url.split("/").pop() });
});

test("reupload creates an independent asset and preserves the original metadata", async () => {
  const first = await upload(png, { "X-Rigel-Filename": "Team portrait.png" });
  const { url } = await first.json();
  const metadata = { name: "Custom display name", title: "Custom title", description: "Custom description", alt: "Custom alt", author: "Original uploader" };
  const ledger = path.join(publicDir, "rigel-media", ".rigel-media.json");
  await writeFile(ledger, JSON.stringify({ [url]: metadata }));
  const repeat = await upload(png, { "X-Rigel-Filename": "Different name.png" });
  expect(repeat.status).toBe(200);
  const repeated = await repeat.json();
  expect(repeated.url).not.toBe(url);
  const record = JSON.parse(await readFile(ledger, "utf8"));
  expect(record[url]).toEqual(metadata);
  expect(record[repeated.url]).toEqual({ name: "Different name.png" });
});

test("concurrent uploads retain every ledger entry", async () => {
  const responses = await Promise.all(Array.from({ length: 6 }, (_, index) => upload(Buffer.concat([png, Buffer.from(String(index))]), { "X-Rigel-Filename": `Team portrait ${index}.png` })));
  expect(responses.map(response => response.status)).toEqual(Array(6).fill(200));
  const urls = await Promise.all(responses.map(async response => (await response.json()).url));
  const ledger = JSON.parse(await readFile(path.join(publicDir, "rigel-media", ".rigel-media.json"), "utf8"));
  expect(Object.keys(ledger).sort()).toEqual([...urls].sort());
  for (const [index, url] of urls.entries()) expect(ledger[url].name).toBe(`Team portrait ${index}.png`);
});

test("new uploads can be read immediately without waiting for the public-file watcher", async () => {
  const { url } = await (await upload()).json();
  const response = await GET({ params: { filename: url.split("/").pop() }, request: new Request(origin + url) } as unknown as APIContext);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
});

test.each(["../private", "file.svg", "a.png", undefined])("media reads reject filename %s", async (filename) => {
  const response = await GET({ params: { filename }, request: new Request(origin) } as unknown as APIContext);
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

const limit = 2 * 1024 * 1024;

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

test("accepts the exact default 2 MB boundary", async () => {
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
  const { url } = await response.json();
  expect(url).toMatch(new RegExp(`^/rigel-media/[a-f0-9-]{36}\\.${extension}$`));
  expect(await readFile(path.join(publicDir, url))).toEqual(bytes);
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

test("each upload gets a fresh UUID filename, including identical bytes", async () => {
  const first = await upload(), second = await upload();
  expect(first.status).toBe(200); expect(second.status).toBe(200);
  const a = await first.json(), b = await second.json();
  const pattern = /^\/rigel-media\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.png$/;
  expect(a.url).toMatch(pattern); expect(b.url).toMatch(pattern);
  expect(a.url).not.toBe(b.url);
  expect(await readFile(path.join(publicDir, a.url))).toEqual(png);
  expect(await readFile(path.join(publicDir, b.url))).toEqual(png);
  const ledger = JSON.parse(await readFile(path.join(publicDir, "rigel-media/.rigel-media.json"), "utf8"));
  expect(Object.keys(ledger).sort()).toEqual([a.url, b.url].sort());
});

test("video uploads are served inline so the player can stream them", async () => {
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41"),
    Buffer.alloc(64),
  ]);
  const response = await upload(mp4, { "Content-Type": "video/mp4", "X-Rigel-Filename": "clip.mp4" });
  expect(response.status).toBe(200);
  const { url } = await response.json();
  const result = await GET({ params: { filename: url.split("/").pop() }, request: new Request(origin + url) } as unknown as APIContext);
  expect(result.headers.get("Content-Type")).toBe("video/mp4");
  expect(result.headers.get("Content-Disposition")).toMatch(/^inline;/);
  expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(Buffer.from(await result.arrayBuffer())).toEqual(mp4);
});

test("one configurable upload limit applies to videos and images", async () => {
  const header = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom"), Buffer.from([0, 0, 2, 0]), Buffer.from("isomiso2mp41")]);
  const elevenMegabytes = Buffer.concat([header, Buffer.alloc(11 * 1024 * 1024)]);
  expect((await upload(elevenMegabytes, { "Content-Type": "video/mp4", "X-Rigel-Filename": "big.mp4" })).status).toBe(413);
  expect((await upload(Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]), { "Content-Type": "image/png", "X-Rigel-Filename": "big.png" })).status).toBe(413);
  config.maxFileSize = 12 * 1024 * 1024;
  expect((await upload(elevenMegabytes, { "Content-Type": "video/mp4", "X-Rigel-Filename": "big.mp4" })).status).toBe(200);
  expect((await upload(Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]), { "Content-Type": "image/png", "X-Rigel-Filename": "big.png" })).status).toBe(200);
});

test("custom byte boundaries are enforced on headers and streamed bodies", async () => {
  config.maxFileSize = png.length - 1;
  expect((await upload(png, { "Content-Length": String(png.length) })).status).toBe(413);
  expect((await upload(png)).status).toBe(413);
  config.maxFileSize = png.length;
  expect((await upload(png)).status).toBe(200);
  config.maxFileSize = 100 * 1024 * 1024;
  expect((await upload(png, { "Content-Length": String(65 * 1024 * 1024) })).status).toBe(200);
});
