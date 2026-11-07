import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { cacheFile, cachedFile, clearFileCache, fileCacheScope, hasFileCache } from "./file-cache";

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
