import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { cacheFile, cachedFile, clearFileCache, clearMediaFileCache, fileCacheScope, hasFileCache, cacheThumbnail, cachedThumbnail, fileCacheRevision, binaryBlobSha } from "./file-cache";

const blob = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
function storage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) });
  return data;
}
afterEach(async () => { await clearFileCache(); vi.unstubAllGlobals(); });

test("bounded immutable cache scopes accounts and targets, checks Git bytes and only clears file data", async () => {
  const data = storage(), scope = await fileCacheScope("alice", "repo/drafts/schema"), text = "private é";
  data.set("rigelcms.settings", "keep"); data.set("rigelcms.session", "keep"); data.set("rigelcms.keys", "keep");
  await cacheFile(scope, blob(text), text);
  expect(hasFileCache()).toBe(true);
  expect(await cachedFile(scope, blob(text))).toBe(text);
  expect(await cachedFile(await fileCacheScope("alice", "repo/other/schema"), blob(text))).toBeUndefined();
  expect([...data.values()].join()).not.toContain("credentials");
  const key = "rigelcms.cache.files";
  expect(data.get(key)).toBeUndefined();
  expect(await cachedFile(scope, blob(text))).toBeUndefined();
  await fileCacheScope("alice", "repo/drafts/schema");
  await cacheFile(scope, blob(text), text);
  await cacheFile(scope, blob(text), "tampered");
  expect(await cachedFile(scope, blob(text))).toBe(text);
  await cacheFile(scope, blob(text), text);
  const other = await fileCacheScope("bob", "repo/drafts/schema");
  expect(await cachedFile(other, blob(text))).toBeUndefined();
  expect(data.get(key)).toBeUndefined();
  await cacheFile(other, blob(text), text);
  clearFileCache();
  expect(hasFileCache()).toBe(false);
  expect([...data.keys()].filter(key => key !== "rigelcms.cache.files.clear").sort()).toEqual(["rigelcms.keys", "rigelcms.session", "rigelcms.settings"]);
});

test("quota and denied storage fall back without breaking reads and clearing rejects late cache writes", async () => {
  storage();
  const scope = await fileCacheScope("alice", "repo"), text = "content";
  const pending = cacheFile(scope, blob(text), text);
  clearFileCache(); await pending;
  expect(await cachedFile(scope, blob(text))).toBeUndefined();
  vi.stubGlobal("localStorage", { getItem() { throw Error("denied"); }, setItem() { throw Error("quota"); }, removeItem() { throw Error("denied"); } });
  await expect(cacheFile(scope, blob(text), text)).resolves.toBeUndefined();
  await expect(cachedFile(scope, blob(text))).resolves.toBe(text);
  await expect(clearFileCache()).resolves.toBeUndefined();
  vi.unstubAllGlobals();
});

test("binary Git identities preserve bytes rather than decoded text", async () => {
  const bytes = Buffer.from([0, 137, 255, 13, 10]);
  expect(await binaryBlobSha(new Blob([bytes]))).toBe(createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"));
});

test("thumbnails isolate verified source SHA, account, target and transform without storing originals", async () => {
  storage();
  const scope = await fileCacheScope("alice", "repo/drafts"), sha = blob("original"), thumbnail = new Blob(["derived"], { type: "image/webp" });
  await cacheThumbnail(scope, sha, "v1:320:webp", thumbnail, fileCacheRevision());
  expect(await (await cachedThumbnail(scope, sha, "v1:320:webp"))?.text()).toBe("derived");
  expect(await cachedThumbnail(scope, sha, "v2:320:webp")).toBeUndefined();
  expect(await cachedThumbnail(scope, blob("changed"), "v1:320:webp")).toBeUndefined();
  expect(await cachedFile(scope, sha)).toBeUndefined();
  const old = fileCacheRevision();
  await clearMediaFileCache();
  await cacheThumbnail(scope, sha, "v1:320:webp", thumbnail, old);
  expect(await cachedThumbnail(scope, sha, "v1:320:webp")).toBeUndefined();
  await cacheFile(scope, blob("text"), "text");
  await cacheThumbnail(scope, sha, "v1:320:webp", thumbnail, fileCacheRevision());
  await clearMediaFileCache();
  expect(await cachedFile(scope, blob("text"))).toBe("text");
  await cacheThumbnail(scope, sha, "v1:320:webp", thumbnail, fileCacheRevision());
  const branch = await fileCacheScope("alice", "repo/other-branch");
  expect(await cachedThumbnail(branch, sha, "v1:320:webp")).toBeUndefined();
  expect(await cachedThumbnail(scope, sha, "v1:320:webp")).toBeUndefined();
  await cacheThumbnail(branch, sha, "v1:320:webp", thumbnail, fileCacheRevision());
  const repository = await fileCacheScope("alice", "other-repo/other-branch");
  expect(await cachedThumbnail(repository, sha, "v1:320:webp")).toBeUndefined();
  await cacheThumbnail(repository, sha, "v1:320:webp", thumbnail, fileCacheRevision());
  const other = await fileCacheScope("bob", "other-repo/other-branch");
  expect(await cachedThumbnail(other, sha, "v1:320:webp")).toBeUndefined();
  expect(await cachedThumbnail(scope, sha, "v1:320:webp")).toBeUndefined();
});

test("thumbnail memory fallback is bounded and storage denial cannot break display", async () => {
  storage();
  vi.stubGlobal("indexedDB", { open() { throw Error("blocked"); } });
  const scope = await fileCacheScope("alice", "repo/drafts"), thumbnail = new Blob(["small"], { type: "image/webp" });
  for (let i = 0; i < 128; i++) await cacheThumbnail(scope, blob(String(i)), "v1", thumbnail, fileCacheRevision());
  expect(await cachedThumbnail(scope, blob("0"), "v1")).toBe(thumbnail);
  for (const i of [128, 129]) await cacheThumbnail(scope, blob(String(i)), "v1", thumbnail, fileCacheRevision());
  expect(await cachedThumbnail(scope, blob("1"), "v1")).toBeUndefined();
  expect(await cachedThumbnail(scope, blob("0"), "v1")).toBe(thumbnail);
  expect(await cachedThumbnail(scope, blob("129"), "v1")).toBe(thumbnail);
  await cacheThumbnail(scope, blob("huge"), "v1", new Blob([new Uint8Array(17 * 1024 * 1024)], { type: "image/webp" }), fileCacheRevision());
  expect(await cachedThumbnail(scope, blob("huge"), "v1")).toBeUndefined();
  await clearFileCache();
  expect(hasFileCache()).toBe(false);
});

test("cache evicts oldest entries and skips oversized or mismatched content", async () => {
  storage(); const scope = await fileCacheScope("alice", "repo");
  for (let i = 0; i < 130; i++) await cacheFile(scope, blob(String(i)), String(i));
  expect(await cachedFile(scope, blob("0"))).toBeUndefined();
  expect(await cachedFile(scope, blob("129"))).toBe("129");
  await cacheFile(scope, blob("wrong"), "not wrong");
  expect(await cachedFile(scope, blob("wrong"))).toBeUndefined();
  const huge = "x".repeat(17 * 1024 * 1024); await cacheFile(scope, blob(huge), huge);
  expect(await cachedFile(scope, blob(huge))).toBeUndefined();
});
