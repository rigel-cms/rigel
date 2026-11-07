import { writable } from "svelte/store";

const DATABASE = "rigelcms-files";
const LEGACY_KEY = "rigelcms.cache.files";
const CLEAR_KEY = "rigelcms.cache.files.clear";
let pendingClear = false;
const MAX_ENTRIES = 128;
const MAX_BYTES = 16 * 1024 * 1024;
type Scope = { owner: string; target: string };
type Entry = { key: string; owner: string; sha: string; text: string; size: number; touched: number };
let revision = 0;
let currentOwner = "";
let persistedCount = 0;
let database: IDBDatabase | undefined;
let unavailable = false;
let opening: Promise<IDBDatabase | undefined> | undefined;
let operations: Promise<unknown> = Promise.resolve();
const memory = new Map<string, Entry>();
export const fileCacheChanges = writable(0);
export function fileCacheChanged() { fileCacheChanges.update(value => value + 1); }
export const fileCacheRevision = () => revision;

async function hash(text: string, algorithm = "SHA-256") {
  const bytes = await crypto.subtle.digest(algorithm, new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function fileBlobSha(text: string) { return hash(`blob ${new TextEncoder().encode(text).byteLength}\0${text}`, "SHA-1"); }
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
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "key" }); if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta"); };
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
async function usableDatabase() {
  const db = await open();
  try { pendingClear ||= localStorage.getItem(CLEAR_KEY) === "1"; } catch {}
  if (db && pendingClear) {
    await transaction(db, "files", "readwrite", store => store.clear());
    pendingClear = false;
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
export function hasFileCache() { return memory.size > 0 || persistedCount > 0; }
export function clearFileCache(): Promise<void> {
  revision++; memory.clear(); persistedCount = 0; pendingClear = true;
  try { localStorage.setItem(CLEAR_KEY, "1"); } catch {}
  forgetLegacy(); fileCacheChanged();
  unavailable = false;
  return queue(async () => {
    await usableDatabase(); persistedCount = 0; fileCacheChanged();
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
      if ((currentOwner && currentOwner !== owner) || (previous && previous !== owner)) {
        revision++; memory.clear(); persistedCount = 0;
        if (db) try { await transaction(db, "files", "readwrite", store => store.clear()); } catch { return; }
      }
      currentOwner = owner;
      if (db) try {
        await transaction(db, "meta", "readwrite", store => store.put(owner, "owner"));
        persistedCount = await transaction(db, "files", "readonly", store => store.count());
      } catch {}
      fileCacheChanged();
      return { owner, target: scope };
    });
  } catch { return; }
}
export async function cachedFile(scope: Scope | undefined, sha: string): Promise<string | undefined> {
  if (!scope || scope.owner !== currentOwner || !/^[a-f0-9]{40}$/.test(sha)) return;
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
  if (!scope || scope.owner !== currentOwner) return;
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
        const tx = db.transaction("files", "readwrite"), store = tx.objectStore("files"), records: { key: IDBValidKey; size: number; touched: number }[] = [];
        await new Promise<void>((resolve, reject) => {
          store.openCursor().onsuccess = event => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) { records.push({ key: cursor.primaryKey, size: Number.isFinite(cursor.value.size) && cursor.value.size >= 0 ? cursor.value.size : MAX_BYTES + 1, touched: Number.isFinite(cursor.value.touched) ? cursor.value.touched : 0 }); cursor.continue(); return; }
            records.sort((a, b) => a.touched - b.touched);
            let bytes = records.reduce((sum, record) => sum + record.size, 0);
            while (records.length > MAX_ENTRIES || bytes > MAX_BYTES) { const oldest = records.shift()!; bytes -= oldest.size; store.delete(oldest.key); }
          };
          tx.oncomplete = () => { if (started === revision) persistedCount = records.length; resolve(); };
          tx.onabort = tx.onerror = () => reject(tx.error);
        });
      } catch {}
      fileCacheChanged();
    });
  } catch {}
}
