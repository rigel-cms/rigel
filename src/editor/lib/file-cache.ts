import { writable } from "svelte/store";

const DATABASE = "rigelcms-files";
const LEGACY_KEY = "rigelcms.cache.files";
const CLEAR_KEY = "rigelcms.cache.files.clear";
let pendingClear: "1" | "media" | undefined;
const MAX_ENTRIES = 128;
const MAX_BYTES = 16 * 1024 * 1024;
type Scope = { owner: string; target: string };
type Entry = { key: string; owner: string; sha: string; text: string; size: number; touched: number };
let revision = 0;
let currentOwner = "";
let currentTarget = "";
const invalidations = new Set<() => void>();
export function onFileCacheClear(callback: () => void) { invalidations.add(callback); return () => { invalidations.delete(callback); }; }
const channel = (() => { try { if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") return new BroadcastChannel("rigelcms-files"); } catch {} })();
if (channel) channel.onmessage = event => { void clear(false, event.data === "media").catch(() => {}); };
let persistedCount = 0;
let database: IDBDatabase | undefined;
let unavailable = false;
let opening: Promise<IDBDatabase | undefined> | undefined;
let operations: Promise<unknown> = Promise.resolve();
const memory = new Map<string, Entry>();
type Thumbnail = { key: string; blob: Blob; digest: string; size: number; touched: number };
const thumbnails = new Map<string, Thumbnail>();
let thumbnailCount = 0;
export const fileCacheChanges = writable(0);
export function fileCacheChanged() { fileCacheChanges.update(value => value + 1); }
export const fileCacheRevision = () => revision;

async function hash(text: string, algorithm = "SHA-256") {
  const bytes = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function fileBlobSha(text: string) { return hash(`blob ${new TextEncoder().encode(text).byteLength}\0${text}`, "SHA-1"); }
export async function binaryBlobSha(blob: Blob) {
  const bytes = await crypto.subtle.digest("SHA-1", await new Blob([`blob ${blob.size}\0`, blob]).arrayBuffer());
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
function queue<T>(operation: () => Promise<T>): Promise<T> {
  const task = operations.then(operation); operations = task.catch(() => {}); return task;
}
function open(): Promise<IDBDatabase | undefined> {
  if (database) return Promise.resolve(database);
  if (unavailable) return Promise.resolve(undefined);
  if (opening) return opening;
  opening = new Promise<IDBDatabase | undefined>(resolve => {
    let settled = false;
    const finish = (value?: IDBDatabase) => { if (settled) { value?.close(); return; } settled = true; clearTimeout(timer); if (!value) unavailable = true; resolve(value); };
    const timer = setTimeout(() => finish(), 1000);
    try {
      const request = indexedDB.open(DATABASE, 2);
      request.onupgradeneeded = () => { const db = request.result; for (const name of ["files", "thumbnails"]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: "key" }); if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta"); };
      request.onerror = () => finish(); request.onblocked = () => finish();
      request.onsuccess = () => {
        const db = request.result;
        if (!settled) { database = db; db.onversionchange = () => { db.close(); if (database === db) database = undefined; }; db.onclose = () => { if (database === db) database = undefined; }; }
        finish(db);
      };
    } catch { finish(); }
  }).finally(() => { opening = undefined; });
  return opening;
}
function transaction<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode), request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("File cache unavailable"));
  });
}
async function prune(db: IDBDatabase, name: string): Promise<number> {
  const tx = db.transaction(name, "readwrite"), store = tx.objectStore(name), records: { key: IDBValidKey; size: number; touched: number }[] = [];
  return new Promise((resolve, reject) => {
    store.openCursor().onsuccess = event => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (cursor) { records.push({ key: cursor.primaryKey, size: Number.isFinite(cursor.value.size) && cursor.value.size >= 0 ? cursor.value.size : MAX_BYTES + 1, touched: Number.isFinite(cursor.value.touched) ? cursor.value.touched : 0 }); cursor.continue(); return; }
      records.sort((a, b) => a.touched - b.touched);
      let bytes = records.reduce((sum, record) => sum + record.size, 0);
      while (records.length > MAX_ENTRIES || bytes > MAX_BYTES) { const oldest = records.shift()!; bytes -= oldest.size; store.delete(oldest.key); }
    };
    tx.oncomplete = () => resolve(records.length);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}
async function usableDatabase() {
  const db = await open();
  try { const saved = localStorage.getItem(CLEAR_KEY); if (saved === "1" || saved === "media") pendingClear = pendingClear === "1" ? "1" : saved; } catch {}
  if (db && pendingClear) {
    if (pendingClear === "1") await transaction(db, "files", "readwrite", store => store.clear());
    await transaction(db, "thumbnails", "readwrite", store => store.clear());
    pendingClear = undefined;
    try { localStorage.removeItem(CLEAR_KEY); } catch {}
  }
  return db;
}
function forgetLegacy() { try { localStorage.removeItem(LEGACY_KEY); } catch {} }
function remember(entry: Entry) {
  memory.delete(entry.key); memory.set(entry.key, entry);
  let size = [...memory.values()].reduce((sum, item) => sum + item.size, 0);
  while (memory.size > MAX_ENTRIES || size > MAX_BYTES) { const key = memory.keys().next().value!; size -= memory.get(key)!.size; memory.delete(key); }
  fileCacheChanged();
}
export function hasFileCache() { return memory.size > 0 || thumbnails.size > 0 || persistedCount > 0 || thumbnailCount > 0; }
function invalidate(mediaOnly = false) {
  revision++; thumbnails.clear(); thumbnailCount = 0;
  if (!mediaOnly) { memory.clear(); persistedCount = 0; }
  pendingClear = pendingClear === "1" || !mediaOnly ? "1" : "media";
  try { localStorage.setItem(CLEAR_KEY, pendingClear); } catch {}
  for (const callback of invalidations) callback();
}
export function clearFileCache(): Promise<void> { return clear(true); }
export function clearMediaFileCache(): Promise<void> { return clear(true, true); }
function clear(broadcast: boolean, mediaOnly = false): Promise<void> {
  invalidate(mediaOnly);
  if (broadcast) channel?.postMessage(mediaOnly ? "media" : "clear");
  forgetLegacy(); fileCacheChanged();
  unavailable = false;
  return queue(async () => {
    await usableDatabase(); if (!mediaOnly) persistedCount = 0; thumbnailCount = 0; fileCacheChanged();
  });
}
export async function fileCacheScope(account: string, target: string): Promise<Scope | undefined> {
  try {
    const owner = await hash(account), scope = await hash(target);
    return await queue(async () => {
      forgetLegacy(); unavailable = false;
      const db = await usableDatabase();
      let previous: unknown;
      if (db) try { previous = await transaction(db, "meta", "readonly", store => store.get("owner")); } catch {}
      const identity = `${owner}:${scope}`;
      if ((currentOwner && (currentOwner !== owner || currentTarget !== scope)) || (previous && previous !== identity)) {
        invalidate(); channel?.postMessage("clear");
        try { await usableDatabase(); } catch { return; }
      }
      currentOwner = owner; currentTarget = scope;
      if (db) try {
        await transaction(db, "meta", "readwrite", store => store.put(identity, "owner"));
        persistedCount = await transaction(db, "files", "readonly", store => store.count());
        thumbnailCount = await transaction(db, "thumbnails", "readonly", store => store.count());
      } catch {}
      fileCacheChanged();
      return { owner, target: scope };
    });
  } catch { return; }
}
function thumbnailKey(scope: Scope | undefined, sha: string, transform: string) {
  if (scope && scope.owner === currentOwner && scope.target === currentTarget && /^[a-f0-9]{40}$/.test(sha) && transform.length < 128) return `${scope.owner}:${scope.target}:${sha}:${transform}`;
}
function rememberThumbnail(entry: Thumbnail) {
  thumbnails.delete(entry.key); thumbnails.set(entry.key, entry);
  let size = [...thumbnails.values()].reduce((sum, item) => sum + item.size, 0);
  while (thumbnails.size > MAX_ENTRIES || size > MAX_BYTES) { const key = thumbnails.keys().next().value!; size -= thumbnails.get(key)!.size; thumbnails.delete(key); }
  fileCacheChanged();
}
export async function cachedThumbnail(scope: Scope | undefined, sha: string, transform: string): Promise<Blob | undefined> {
  const key = thumbnailKey(scope, sha, transform), started = revision;
  if (!key) return;
  let entry = thumbnails.get(key);
  if (!entry) entry = await queue(async () => {
    if (started !== revision) return;
    const db = await usableDatabase();
    if (db) try { return await transaction<Thumbnail | undefined>(db, "thumbnails", "readonly", store => store.get(key)); } catch {}
  }).catch(() => undefined);
  if (!entry || started !== revision || !thumbnailKey(scope, sha, transform)) return;
  try {
    if (entry.key === key && entry.blob instanceof Blob && entry.blob.type === "image/webp" && entry.blob.size > 0 && entry.blob.size <= MAX_BYTES && entry.digest === await binaryBlobSha(entry.blob) && started === revision && thumbnailKey(scope, sha, transform)) {
      rememberThumbnail({ ...entry, size: entry.blob.size, touched: Date.now() });
      return entry.blob;
    }
  } catch {}
  thumbnails.delete(key);
  await queue(async () => { const db = await usableDatabase(); if (db) try { await transaction(db, "thumbnails", "readwrite", store => store.delete(key)); const count = await transaction(db, "thumbnails", "readonly", store => store.count()); if (started === revision) thumbnailCount = count; } catch {} }).catch(() => {});
  fileCacheChanged();
}
export async function cacheThumbnail(scope: Scope | undefined, sha: string, transform: string, blob: Blob, started: number): Promise<void> {
  const key = thumbnailKey(scope, sha, transform);
  if (!key || started !== revision || !blob.size || blob.size > MAX_BYTES || blob.type !== "image/webp") return;
  const entry: Thumbnail = { key, blob, size: blob.size, digest: await binaryBlobSha(blob), touched: Date.now() };
  if (started !== revision || !thumbnailKey(scope, sha, transform)) return;
  rememberThumbnail(entry);
  await queue(async () => {
    if (started !== revision || !thumbnailKey(scope, sha, transform)) return;
    const db = await usableDatabase();
    if (!db || started !== revision) return;
    try {
      await transaction(db, "thumbnails", "readwrite", store => store.put(entry));
      const count = await prune(db, "thumbnails");
      if (started === revision) thumbnailCount = count;
    } catch {}
    fileCacheChanged();
  }).catch(() => {});
}
export async function cachedFile(scope: Scope | undefined, sha: string): Promise<string | undefined> {
  if (!scope || scope.owner !== currentOwner || scope.target !== currentTarget || !/^[a-f0-9]{40}$/.test(sha)) return;
  const started = revision, key = `${scope.owner}:${scope.target}:${sha}`;
  let entry = memory.get(key);
  if (!entry) entry = await queue(async () => {
    if (started !== revision) return;
    const db = await usableDatabase();
    if (db) try { return await transaction<Entry | undefined>(db, "files", "readonly", store => store.get(key)); } catch {}
  }).catch(() => undefined);
  if (!entry || entry.key !== key || entry.owner !== scope.owner || entry.sha !== sha || typeof entry.text !== "string" || new TextEncoder().encode(entry.text).byteLength > MAX_BYTES) return;
  try {
    if (await fileBlobSha(entry.text) === sha && started === revision && scope.owner === currentOwner) { remember({ ...entry, size: new TextEncoder().encode(entry.text).byteLength, touched: Date.now() }); return entry.text; }
  } catch {}
  memory.delete(key);
  await queue(async () => { const db = await usableDatabase(); if (db) try { await transaction(db, "files", "readwrite", store => store.delete(key)); persistedCount = await transaction(db, "files", "readonly", store => store.count()); } catch {} }).catch(() => {});
}
export async function cacheFile(scope: Scope | undefined, sha: string, text: string): Promise<void> {
  if (!scope || scope.owner !== currentOwner || scope.target !== currentTarget) return;
  const started = revision, size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_BYTES) return;
  try {
    if (await fileBlobSha(text) !== sha || started !== revision || scope.owner !== currentOwner) return;
    const entry: Entry = { key: `${scope.owner}:${scope.target}:${sha}`, owner: scope.owner, sha, text, size, touched: Date.now() };
    remember(entry);
    await queue(async () => {
      if (started !== revision || scope.owner !== currentOwner) return;
      const db = await usableDatabase();
      if (!db || started !== revision) return;
      try {
        await transaction(db, "files", "readwrite", store => store.put(entry));
        const count = await prune(db, "files");
        if (started === revision) persistedCount = count;
      } catch {}
      fileCacheChanged();
    });
  } catch {}
}
