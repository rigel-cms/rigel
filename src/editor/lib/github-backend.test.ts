import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { Manifest } from "../../manifest/types";
import { emptyBody } from "../../article-body";
import { validateDocumentSlugs } from "../../slugs";
import { readValues } from "../../routes/serialize";
import { loadManifestRemote, saveRemoteSelection, deleteRemotePost, deleteRemoteDocument, listRemoteMedia, uploadRemoteMedia, updateRemoteMedia, deleteRemoteMedia, readRemoteMedia, resetRemoteMediaCache } from "./github-backend";

import { serializeCollectionLedger } from "../../manifest/collection-ledger";
import { readRemoteSelection, indexRemoteDocuments, readRemotePost, indexRemoteCollections, reindexRemoteCollections, resetRemoteCollectionCache } from "./github-backend";

import { documentLedgerShape, documentMetadata } from "../../manifest/document-ledger";

function metadataFixture(indexed = true) {
  const s = server(), original = blueprint();
  original.schema!.documents[0].shared = true;
  original.preview = { documents: { "page-en": { url: "/en/{slug}/" }, "page-fr": { url: "/fr/{slug}/" } } };
  for (const name of ["page-en", "page-fr", "trainer", "room", "legal"]) {
    original.schema!.documents.push({ name, title: name, type: "document", folder: `src/content/${name}`, locale: name.endsWith("-fr") ? "fr" : name.endsWith("-en") ? "en" : undefined, shared: !name.startsWith("page-"), fields: [{ key: "name", label: "Name", type: "string", required: true }] });
    s.put(`playground/src/content/${name}/first.json`, JSON.stringify({ name, prose: "Never in metadata", related: name === "room" ? { _ref: "author:alex" } : undefined }));
  }
  for (let i = 0; i < 8; i++) s.put(`playground/src/content/page-en/page-${i}.json`, JSON.stringify({ name: `Page ${i}`, prose: "Private body" }));
  if (indexed) for (const type of original.schema!.documents) {
    const prefix = `playground/${type.folder}/`;
    const entries = [...s.files].filter(([path]) => path.startsWith(prefix)).map(([path, file]) => ({ slug: path.slice(prefix.length, -5), sha: file.sha, frontmatter: documentMetadata(type, JSON.parse(file.text)) }));
    s.put(prefix + ".rigel-collection.json", serializeCollectionLedger(documentLedgerShape(type, original.schema!), entries));
  }
  return { s, original };
}

function blobReads(s: ReturnType<typeof server>, since = 0) {
  return s.calls.slice(since).filter(call => call.method === "GET" && call.path.startsWith("/git/blobs/"));
}

test("scoped welcome, metadata group, one-file selection, own menu and dependency closure never load unrelated bodies", async () => {
  const { s, original } = metadataFixture();
  const m = await loadManifestRemote(ctx, original);
  expect(blobReads(s)).toEqual([]);
  const start = s.calls.length;
  await indexRemoteDocuments(ctx, m, ["page-en"]);
  expect(blobReads(s, start).map(call => call.path)).toEqual([`/git/blobs/${s.files.get("playground/src/content/page-en/.rigel-collection.json")!.sha}`]);
  expect(m.documents!.filter(doc => doc.type === "page-en").every(doc => doc.loaded === "metadata" && !Object.hasOwn(doc.data, "prose"))).toBe(true);
  expect(m.documents!.filter(doc => doc.type !== "page-en").every(doc => doc.loaded === "identity")).toBe(true);
  let before = s.calls.length;
  await readRemoteSelection(ctx, m, { kind: "document", type: "page-en", id: "page-en:first" });
  expect(blobReads(s, before)).toHaveLength(1);
  expect(m.documents!.find(doc => doc.id === "page-en:first")!.data.prose).toBe("Never in metadata");
  before = s.calls.length;
  await readRemoteSelection(ctx, m, { kind: "menu", slug: "main" });
  expect(blobReads(s, before).map(call => call.path)).toEqual([`/git/blobs/${s.files.get("playground/src/content/menus/main.json")!.sha}`]);
  before = s.calls.length;
  await readRemoteSelection(ctx, m, { kind: "document", type: "room", id: "room:first" });
  expect(blobReads(s, before).map(call => call.path)).toEqual(["playground/src/content/room/first.json", "playground/src/content/authors/alex.json"].map(path => `/git/blobs/${s.files.get(path)!.sha}`));
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test.each(["missing", "corrupt", "stale", "new", "deleted"])("%s document metadata reconciles only the requested group", async mode => {
  const { s, original } = metadataFixture(mode !== "missing");
  const prefix = "playground/src/content/page-en/";
  if (mode === "corrupt") s.put(prefix + ".rigel-collection.json", "{");
  if (mode === "stale") s.put(prefix + "first.json", JSON.stringify({ name: "Changed", prose: "Fresh" }));
  if (mode === "new") s.put(prefix + "new.json", JSON.stringify({ name: "New" }));
  if (mode === "deleted") { s.files.delete(prefix + "first.json"); s.put("marker", "refresh"); }
  const m = await loadManifestRemote(ctx, original);
  const before = s.calls.length;
  await indexRemoteDocuments(ctx, m, ["page-en"]);
  const allowed = [...s.files].filter(([path]) => path.startsWith(prefix)).map(([, file]) => `/git/blobs/${file.sha}`);
  expect(blobReads(s, before).every(call => allowed.includes(call.path))).toBe(true);
  expect(blobReads(s, before)).toHaveLength(mode === "missing" ? 9 : mode === "corrupt" ? 10 : mode === "deleted" ? 1 : 2);
  if (mode === "deleted") expect(m.documents!.some(doc => doc.id === "page-en:first")).toBe(false);
  if (mode === "stale") expect(m.documents!.find(doc => doc.id === "page-en:first")!.data.name).toBe("Changed");
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test("unindexed groups publish usable metadata progressively, abort at four requests, and never expose incomplete forms", async () => {
  const { s, original } = metadataFixture(false), m = await loadManifestRemote(ctx, original), originalFetch = fetch;
  const controller = new AbortController();
  let peak = 0, active = 0, published = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { active++; peak = Math.max(peak, active); try { await new Promise(resolve => setTimeout(resolve, 1)); return await originalFetch(url, init); } finally { active--; } });
  await expect(indexRemoteDocuments(ctx, m, ["page-en"], () => { published++; controller.abort(); }, controller.signal)).rejects.toThrow();
  expect(published).toBe(1); expect(peak).toBeLessThanOrEqual(4); expect(blobReads(s)).toHaveLength(4);
  expect(m.documents!.filter(doc => doc.type === "page-en").some(doc => doc.loaded === "identity")).toBe(true);
  expect(m.documents!.every(doc => doc.loaded !== "complete")).toBe(true);
  await indexRemoteDocuments(ctx, m, ["page-en"]);
  expect(m.documents!.filter(doc => doc.type === "page-en").every(doc => doc.loaded === "metadata")).toBe(true);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test("search and WebMCP catalogs discover tree identities without hydration and report missing metadata", async () => {
  const { s, original } = metadataFixture(false), m = await loadManifestRemote(ctx, original);
  const { contentCatalog } = await import("./webmcp");
  const { searchIndex } = await import("../../manifest/search");
  const before = s.calls.length, catalog = contentCatalog(m, undefined, "scope");
  expect(catalog.complete).toBe(false); expect(catalog.entries.some(entry => entry.selection.kind === "document")).toBe(true);
  expect(searchIndex(m, "all", undefined, key => key).length).toBeGreaterThan(0);
  expect(s.calls).toHaveLength(before);
  const app = readFileSync(new URL("../App.svelte", import.meta.url), "utf8");
  expect(app).not.toContain("hydrateRemoteContent");
  expect(app).not.toContain("onindex={() => indexCollections()}");
  expect(app).toContain("list: () => contentCatalog(");
});

test("document create, save, delete and all-content reindex use atomic exact-SHA ledgers without unrelated menu reads", async () => {
  const { s, original } = metadataFixture(), m = await loadManifestRemote(ctx, original);
  await saveRemoteSelection(ctx, m, { kind: "document", type: "page-en", id: "page-en:new" }, { name: "New", custom: "Preserve" }, "", true);
  const path = "playground/src/content/page-en/new.json", ledgerPath = "playground/src/content/page-en/.rigel-collection.json";
  expect(JSON.parse(s.files.get(ledgerPath)!.text).entries.find((entry: any) => entry.slug === "new").sha).toBe(s.files.get(path)!.sha);
  expect(s.calls.filter(call => call.path === "/git/trees" && call.method === "POST").at(-1)!.body.tree.map((entry: any) => entry.path)).toEqual([path, ledgerPath]);
  m.documents!.push({ id: "page-en:new", type: "page-en", slug: "new", data: { name: "New" } });
  await deleteRemoteDocument(ctx, m, "page-en:new");
  expect(s.files.has(path)).toBe(false);
  expect(JSON.parse(s.files.get(ledgerPath)!.text).entries.some((entry: any) => entry.slug === "new")).toBe(false);
  m.documents = m.documents!.filter(doc => doc.id !== "page-en:new");
  const before = s.calls.length;
  await reindexRemoteCollections(ctx, m);
  const writes = s.calls.slice(before).filter(call => call.method === "PATCH");
  expect(writes).toHaveLength(1);
  const tree = s.calls.slice(before).find(call => call.path === "/git/trees" && call.method === "POST")!;
  expect(tree.body.tree).toHaveLength(original.schema!.documents.length + original.collections!.length);
  expect(tree.body.tree.every((entry: any) => entry.path.endsWith("/.rigel-collection.json"))).toBe(true);
  expect(blobReads(s).some(call => call.path.endsWith(s.files.get("playground/src/content/menus/main.json")!.sha))).toBe(false);
});

async function loadEditingFixture(...args: Parameters<typeof loadManifestRemote>) {
  const m = await loadManifestRemote(...args);
  if (!args[3]?.deferContent) {
    for (const page of m.pages) await readRemoteSelection(args[0], m, { kind: "page", slug: page.slug });
    for (const doc of m.documents ?? []) await readRemoteSelection(args[0], m, { kind: "document", type: doc.type, id: doc.id });
    for (const menu of m.menus?.entries ?? []) await readRemoteSelection(args[0], m, { kind: "menu", slug: menu.slug });
  }
  if (!args[3]?.deferContent && m.schema) validateDocumentSlugs(m.schema, m.documents ?? [], m.preview);
  if (!args[3]?.deferCollections) await indexRemoteCollections(args[0], m);
  return m;
}

test("welcome defers document and menu bytes; hydration shares work and validates before exposing data", async () => {
  const s = server();
  const m = await loadEditingFixture(ctx, blueprint(), false, { deferCollections: true, deferContent: true });
  expect(m.contentIndex?.state).toBe("pending");
  expect(m.documents?.[0].data).toEqual({});
  const { contentCatalog } = await import("./webmcp");
  const { searchIndex } = await import("../../manifest/search");
  expect(contentCatalog(m, undefined, "pending").entries).toHaveLength(4);
  expect(searchIndex(m, "all", undefined, key => key).length).toBeGreaterThan(0);
  expect(s.calls.filter(c => c.path.includes("/git/blobs/"))).toHaveLength(0);
  await Promise.all([readRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }), readRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" })]);
  await readRemoteSelection(ctx, m, { kind: "menu", slug: "main" });
  expect(m.documents?.[0].loaded).toBe("complete");
  expect(m.documents?.[0].data.name).toBe("Álex 🌍");
  expect(m.menus?.entries[0].title).toBe("Main");
  expect(s.calls.filter(c => c.path.includes("/git/blobs/"))).toHaveLength(2);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("clearing all file bytes refetches copy and documents without losing save validation or identity", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  resetRemoteCollectionCache(m);
  const before = s.calls.length;
  await readRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" });
  await saveRemoteSelection(ctx, m, { kind: "page", slug: "contact" }, { contact: { title: "After clear" } }, "", false);
  expect(s.calls.slice(before).some(c => c.path.includes("/git/blobs/") && c.method === "GET")).toBe(true);
  expect(s.files.get("playground/src/content/copy/contact.ts")!.text).toContain("After clear");
});

test("verified same-account reauthorization keeps the original conflict snapshot and unsaved content", async () => {
  server(); let active = true;
  const old = { ...ctx, cacheAccount: "alice", assertActive: () => { if (!active) throw Error("expired"); } };
  const m = await loadEditingFixture(old, blueprint());
  active = false;
  const { reauthorizeRemoteContent } = await import("./github-backend");
  const next = { ...ctx, cacheAccount: "alice", token: "renewed" };
  expect(reauthorizeRemoteContent(next, m)).toBe(true);
  await expect(saveRemoteSelection(next, m, { kind: "document", type: "author", id: "author:alex" }, { name: "Retained draft" }, "", false)).resolves.toBeUndefined();
  expect(reauthorizeRemoteContent({ ...next, cacheAccount: "bob" }, m)).toBe(false);
});

test("article cache reset rejects late reads and changes of account cannot reuse cached bodies", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  const before = s.calls.length;
  await readRemotePost(ctx, m, "blog", "hello");
  expect(s.calls.length).toBe(before);
  await expect(readRemotePost({ ...ctx, token: "other-account" }, m, "blog", "hello")).rejects.toThrow(/reload/i);
  resetRemoteCollectionCache(m);
  await readRemotePost(ctx, m, "blog", "hello");
  expect(s.calls.length - before).toBe(2);
  resetRemoteCollectionCache(m);
  const original = fetch;
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(done => { release = done; }), fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { started(); await held; return original(url, init); });
  const pending = readRemotePost(ctx, m, "blog", "hello"), rejected = expect(pending).rejects.toThrow(/reload/i);
  await fetching; resetRemoteCollectionCache(m); release(); await rejected;
});

test("indexed login reads zero article blobs; concurrent selection and reopen read one", async () => {
  const s = server(), original = blueprint(), file = s.files.get("playground/src/content/blog/hello.json")!;
  s.put("playground/src/content/blog/.rigel-collection.json", serializeCollectionLedger(original.collections![0], [{ slug: "hello", sha: file.sha, frontmatter: JSON.parse(file.text).frontmatter }]));
  const m = await loadEditingFixture(ctx, original);
  expect(s.calls.filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(0);
  const posts = await Promise.all([readRemotePost(ctx, m, "blog", "hello"), readRemotePost(ctx, m, "blog", "hello")]);
  expect(posts[0].body).toEqual(emptyBody());
  await readRemotePost(ctx, m, "blog", "hello");
  expect(s.calls.filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(1);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("missing ledger returns before bodies and reconciles progressively without writing", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint(), true, { deferCollections: true });
  const file = s.files.get("playground/src/content/blog/hello.json")!;
  expect(s.calls.filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(0);
  expect(m.collections![0].index?.state).toBe("pending");
  await indexRemoteCollections(ctx, m);
  expect(m.collections![0].posts[0].frontmatter.title).toBe("Hello");
  expect(m.collections![0].index).toMatchObject({ state: "complete", loaded: 1, total: 1 });
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
  await reindexRemoteCollections(ctx, m);
  const tree = s.calls.filter(c => c.path === "/git/trees" && c.method === "POST").at(-1)!;
  expect(tree.body.tree.map((e: any) => e.path)).toEqual(["playground/src/content/authors/.rigel-collection.json", "playground/src/content/blog/.rigel-collection.json"]);
  const cold = s.calls.length;
  await loadEditingFixture(ctx, blueprint());
  expect(s.calls.slice(cold).filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(0);
});

test("article save and delete include an exact-SHA metadata ledger in the same commit", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Updated" }, emptyBody(), false);
  const article = s.files.get("playground/src/content/blog/hello.json")!;
  const ledgerPath = "playground/src/content/blog/.rigel-collection.json";
  expect(JSON.parse(s.files.get(ledgerPath)!.text).entries).toEqual([{ slug: "hello", sha: article.sha, frontmatter: { title: "Updated" } }]);
  expect(s.calls.filter(c => c.path === "/git/trees" && c.method === "POST").at(-1)!.body.tree).toHaveLength(2);
  await deleteRemotePost(ctx, m, "blog", "hello");
  expect(JSON.parse(s.files.get(ledgerPath)!.text).entries).toEqual([]);
  expect(s.files.has("playground/src/content/blog/hello.json")).toBe(false);
});

test.each(["missing", "malformed", "stale"])("%s ledger falls back only to source articles without automatic writes", async mode => {
  const s = server(), original = blueprint();
  if (mode !== "missing") s.put("playground/src/content/blog/.rigel-collection.json", mode === "malformed" ? "{" : serializeCollectionLedger({ ...original.collections![0], fields: [] }, []));
  const m = await loadEditingFixture(ctx, original, true, { deferCollections: true });
  expect(m.collections![0].index?.state).toBe("pending");
  await indexRemoteCollections(ctx, m);
  expect(m.collections![0].index?.state).toBe("complete");
  expect(m.collections![0].posts[0].frontmatter.title).toBe("Hello");
  expect(m.collections![0].posts[0]).not.toHaveProperty("body");
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("reindex cancellation and branch conflicts never persist a ledger or change articles", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint(), true, { deferCollections: true }), before = new Map(s.files);
  const controller = new AbortController(); controller.abort();
  await expect(reindexRemoteCollections(ctx, m, () => {}, controller.signal)).rejects.toThrow();
  expect(s.files).toEqual(before);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
  s.put("rival", "external commit");
  await expect(reindexRemoteCollections(ctx, m)).rejects.toThrow(/conflict/i);
  expect(s.files.has("playground/src/content/blog/.rigel-collection.json")).toBe(false);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("index workers settle before retry and never claim completion after an interrupted read", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint(), true, { deferCollections: true });
  const original = fetch; let fail = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { if (fail && url.includes("/git/blobs/")) { fail = false; throw Error("offline"); } return original(url, init); });
  await expect(indexRemoteCollections(ctx, m)).rejects.toThrow();
  expect(m.collections![0].index?.state).toBe("error");
  expect(m.collections![0].index?.loaded).toBe(0);
  await indexRemoteCollections(ctx, m);
  expect(m.collections![0].index?.state).toBe("complete");
  expect(m.collections![0].posts).toHaveLength(1);
});

test("parallel collection reconciliation shares a four-request article limit", async () => {
  const s = server(), original = blueprint();
  original.collections!.push({ name: "news", label: "News", fields: [], posts: [] });
  original.github!.collections.push({ name: "news", folder: "src/content/news" });
  for (const name of ["blog", "news"]) for (let i = 0; i < 7; i++) s.put(`playground/src/content/${name}/post-${i}.json`, JSON.stringify({ frontmatter: { title: String(i) }, body: emptyBody() }));
  const m = await loadEditingFixture(ctx, original, true, { deferCollections: true }), originalFetch = fetch;
  let active = 0, peak = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await originalFetch(url, init); }
    finally { active--; }
  });
  await Promise.all(["blog", "news"].map(name => indexRemoteCollections(ctx, m, name)));
  expect(peak).toBe(4);
  expect(m.collections!.map(c => c.index?.state)).toEqual(["complete", "complete"]);
});

test("large collection ledgers use blob readback beyond the Contents API inline limit", async () => {
  const s = server();
  for (let i = 0; i < 3; i++) s.put(`playground/src/content/blog/large-${i}.json`, JSON.stringify({ frontmatter: { title: String(i) + "x".repeat(400000) }, body: emptyBody() }));
  const m = await loadEditingFixture(ctx, blueprint());
  await reindexRemoteCollections(ctx, m);
  const ledger = s.files.get("playground/src/content/blog/.rigel-collection.json")!;
  expect(Buffer.byteLength(ledger.text)).toBeGreaterThan(1024 * 1024);
  const calls = s.calls.length;
  const reloaded = await loadEditingFixture(ctx, blueprint());
  expect(reloaded.collections![0].posts).toHaveLength(4);
  expect(s.calls.slice(calls).filter(c => c.path === `/git/blobs/${ledger.sha}`)).toHaveLength(1);
  expect(s.calls.some(c => c.path.startsWith("/contents/") && c.path.includes(".rigel-collection"))).toBe(false);
});

test("indexed collection references prevent document deletion without hydrating article bodies", async () => {
  const s = server(), original = blueprint(), file = s.files.get("playground/src/content/blog/hello.json")!;
  s.put("playground/src/content/blog/.rigel-collection.json", serializeCollectionLedger(original.collections![0], [{ slug: "hello", sha: file.sha, frontmatter: JSON.parse(file.text).frontmatter }]));
  const m = await loadEditingFixture(ctx, original);
  await expect(deleteRemoteDocument(ctx, m, "author:alex")).rejects.toThrow(/referenced/);
  expect(s.calls.filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(0);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("articles with an identical SHA share in-flight hydration across storage paths", async () => {
  const s = server(), file = s.files.get("playground/src/content/blog/hello.json")!;
  s.files.set("playground/src/content/blog/duplicate.json", file);
  s.put("marker", "refresh tree");
  const m = await loadEditingFixture(ctx, blueprint(), true, { deferCollections: true });
  await Promise.all([readRemotePost(ctx, m, "blog", "hello"), readRemotePost(ctx, m, "blog", "duplicate")]);
  expect(s.calls.filter(c => c.path === `/git/blobs/${file.sha}`)).toHaveLength(1);
});

test("reindex verifies an uncertain ledger commit before retrying without a duplicate commit", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint()), original = fetch;
  let committed = false, fail = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (committed && fail && url.includes("/git/blobs/")) { fail = false; throw Error("Lost verification"); }
    const response = await original(url, init);
    if (init?.method === "PATCH") committed = true;
    return response;
  });
  await expect(reindexRemoteCollections(ctx, m)).rejects.toThrow();
  await reindexRemoteCollections(ctx, m);
  expect(s.calls.filter(c => c.path === "/git/commits" && c.method === "POST")).toHaveLength(1);
  expect(s.calls.filter(c => c.method === "PATCH")).toHaveLength(1);
  expect(JSON.parse(s.files.get("playground/src/content/blog/.rigel-collection.json")!.text).entries).toHaveLength(1);
});

test("session invalidation during reindex rejects late metadata and cannot write a ledger", async () => {
  const s = server(); let active = true;
  const context = { ...ctx, assertActive: () => { if (!active) throw Error("Session inactive"); } };
  const m = await loadEditingFixture(context, blueprint(), true, { deferCollections: true }), original = fetch;
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(done => { release = done; }), fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { started(); await held; return original(url, init); });
  const task = reindexRemoteCollections(context, m), rejected = expect(task).rejects.toThrow(/inactive/);
  await fetching; active = false; release(); await rejected;
  expect(m.collections![0].index?.state).toBe("error");
  expect(m.collections![0].index?.loaded).toBe(0);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("media request benchmark shares listing, parallel blobs and reopened previews", async () => {
  const s = server();
  const urls = Array.from({ length: 12 }, (_, i) => `/rigel-media/image-${i}.txt`);
  for (const url of urls) s.put(`playground/public${url}`, `image ${url}`);
  s.put("playground/public/rigel-media/.rigel-media.json", "{}");
  const m = await loadEditingFixture(ctx, blueprint()), start = s.calls.length;
  await listRemoteMedia(ctx, m);
  await Promise.all(urls.flatMap(url => [readRemoteMedia(ctx, m, url), readRemoteMedia(ctx, m, url)]));
  const cold = s.calls.length - start;
  await listRemoteMedia(ctx, m);
  await Promise.all(urls.map(url => readRemoteMedia(ctx, m, url)));
  const reopened = s.calls.length - start - cold;
  const reads = s.calls.slice(start);
  console.log(JSON.stringify({ benchmark: "12 media, two parallel consumers, reopen", cold, reopened, heads: reads.filter(c => c.path.includes("/git/ref/")).length, trees: reads.filter(c => c.path.includes("/git/trees/")).length }));
  expect(cold).toBe(15);
  expect(reopened).toBe(0);
  expect(reads.filter(call => call.path.includes("/git/ref/"))).toHaveLength(1);
  expect(reads.filter(call => call.path.includes("/git/trees/"))).toHaveLength(1);
  expect(reads.filter(call => call.path.includes("/git/blobs/"))).toHaveLength(13);
});

test("media rejects source bytes that do not hash to the verified tree identity and retries cleanly", async () => {
  const s = server(), url = "/rigel-media/verified.txt";
  s.put(`playground/public${url}`, "original");
  const m = await loadEditingFixture(ctx, blueprint()), original = fetch;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const response = await original(url, init);
    if (!url.includes("/git/blobs/")) return response;
    const data = await response.json();
    return Response.json({ ...data, content: Buffer.from("tampered").toString("base64") });
  });
  await expect(readRemoteMedia(ctx, m, url)).rejects.toThrow(/SHA mismatch/);
  vi.stubGlobal("fetch", original);
  expect(await (await readRemoteMedia(ctx, m, url)).text()).toBe("original");
});

test("immutable blob reuse preserves each asset MIME and signature validation", async () => {
  const s = server();
  s.put("playground/public/rigel-media/a.txt", "plain,text");
  s.files.set("playground/public/rigel-media/b.csv", s.files.get("playground/public/rigel-media/a.txt")!);
  s.put("snapshot-marker", "refresh tree");
  const m = await loadEditingFixture(ctx, blueprint());
  expect((await readRemoteMedia(ctx, m, "/rigel-media/a.txt")).type).toBe("text/plain; charset=utf-8");
  expect((await readRemoteMedia(ctx, m, "/rigel-media/b.csv")).type).toBe("text/csv");
});

test("hard media refresh drops identical SHA blobs and cannot be refilled by old downloads", async () => {
  const s = server(), url = "/rigel-media/a.txt";
  s.put(`playground/public${url}`, "private");
  const m = await loadEditingFixture(ctx, blueprint());
  await readRemoteMedia(ctx, m, url);
  const before = s.calls.length;
  await listRemoteMedia(ctx, m, true);
  await readRemoteMedia(ctx, m, url);
  expect(s.calls.length - before).toBe(3);
  resetRemoteMediaCache();
  await listRemoteMedia(ctx, m);
  const original = fetch;
  let release!: () => void, started!: () => void, first = true;
  const held = new Promise<void>(done => { release = done; }), fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { if (first && url.includes("/git/blobs/")) { first = false; started(); await held; } return original(url, init); });
  const pending = readRemoteMedia(ctx, m, url), rejected = expect(pending).rejects.toThrow(/reload/i);
  await fetching;
  await listRemoteMedia(ctx, m, true);
  release(); await rejected;
  const after = s.calls.length;
  await readRemoteMedia(ctx, m, url);
  expect(s.calls.length - after).toBe(1);
});

test("media refresh revalidates metadata and SHA without permitting stale writes", async () => {
  const s = server(), url = "/rigel-media/a.txt", ledger = "playground/public/rigel-media/.rigel-media.json";
  s.put(`playground/public${url}`, "old"); s.put(ledger, JSON.stringify({ [url]: { title: "Old" } }));
  const m = await loadEditingFixture(ctx, blueprint());
  expect(await (await readRemoteMedia(ctx, m, url)).text()).toBe("old");
  s.put(`playground/public${url}`, "new"); s.put(ledger, JSON.stringify({ [url]: { title: "New" } }));
  expect((await listRemoteMedia(ctx, m))[0].title).toBe("Old");
  expect((await listRemoteMedia(ctx, m, true))[0].title).toBe("New");
  expect(await (await readRemoteMedia(ctx, m, url)).text()).toBe("new");
  await expect(updateRemoteMedia(ctx, m, { url, title: "Unsafe" })).rejects.toThrow(/conflict/);
  expect(s.calls.filter(c => c.method !== "GET")).toEqual([]);
});

test("media cache bounds concurrency, retries errors and evicts old blobs", async () => {
  const s = server(), urls = Array.from({ length: 66 }, (_, i) => `/rigel-media/${i}.txt`);
  for (const url of urls) s.put(`playground/public${url}`, url);
  const m = await loadEditingFixture(ctx, blueprint());
  await listRemoteMedia(ctx, m);
  const original = fetch;
  let active = 0, peak = 0, fail = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (!url.includes("/git/blobs/")) return original(url, init);
    active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setTimeout(resolve, 1)); if (fail) { fail = false; throw Error("retry"); } return await original(url, init); }
    finally { active--; }
  });
  await expect(readRemoteMedia(ctx, m, urls[0])).rejects.toThrow();
  await Promise.all(urls.map(url => readRemoteMedia(ctx, m, url)));
  expect(peak).toBe(4);
  const before = s.calls.length;
  await readRemoteMedia(ctx, m, urls[0]);
  expect(s.calls.length - before).toBe(1);
});

test("media reset and account changes discard cached bytes and reject late results", async () => {
  const s = server(), url = "/rigel-media/a.txt";
  s.put(`playground/public${url}`, "private");
  const m = await loadEditingFixture(ctx, blueprint());
  await listRemoteMedia(ctx, m);
  const original = fetch;
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(done => { release = done; }), fetching = new Promise<void>(done => { started = done; });
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => { if (url.includes("/git/blobs/")) { started(); await held; } return original(url, init); });
  const pending = readRemoteMedia(ctx, m, url);
  const rejected = expect(pending).rejects.toThrow(/reload/i);
  await fetching; resetRemoteMediaCache(); release(); await rejected;
  await readRemoteMedia(ctx, m, url);
  const before = s.calls.length;
  await readRemoteMedia({ ...ctx, token: "another-account" }, m, url);
  expect(s.calls.length - before).toBe(3);
});

test("media listing failures retry and simultaneous callers share the listing", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  s.status = 503;
  await expect(listRemoteMedia(ctx, m)).rejects.toThrow();
  s.status = 0;
  const before = s.calls.length;
  await Promise.all([listRemoteMedia(ctx, m), listRemoteMedia(ctx, m)]);
  expect(s.calls.length - before).toBe(2);
});

test("repository media initializes file and ledger atomically, previews bytes and preserves content Save", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  expect(await listRemoteMedia(ctx, m)).toEqual([]);
  const url = await uploadRemoteMedia(ctx, m, new File(["Draft attachment"], "notes.txt", { type: "text/plain" }), { author: "Alex" });
  expect(url).toMatch(/^\/rigel-media\/[a-f0-9-]+\.txt$/);
  const tree = s.calls.filter(call => call.path === "/git/trees" && call.method === "POST").at(-1)!;
  expect(tree.body.tree.map((entry: any) => entry.path).sort()).toEqual([`playground/public${url}`, "playground/public/rigel-media/.rigel-media.json"].sort());
  expect(await listRemoteMedia(ctx, m)).toEqual([{ url, name: "notes.txt", type: "text/plain", size: 16, author: "Alex" }]);
  expect(await (await readRemoteMedia(ctx, m, url)).text()).toBe("Draft attachment");
  await updateRemoteMedia(ctx, m, { url, name: "Renamed", title: "Draft file", description: "Description" });
  expect((await listRemoteMedia(ctx, m))[0]).toMatchObject({ name: "Renamed", title: "Draft file", description: "Description" });
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Unsaved article" }, emptyBody(), false);
  await deleteRemoteMedia(ctx, m, url);
  expect(await listRemoteMedia(ctx, m)).toEqual([]);
  await expect(readRemoteMedia(ctx, m, url)).rejects.toThrow(/unknown/i);
  expect(JSON.parse(s.files.get("playground/public/rigel-media/.rigel-media.json")!.text)).toEqual({});
  expect(s.files.has(`playground/public${url}`)).toBe(false);
});

test("media rejects invalid bytes, MIME, size, unsafe folders and symlinks without writes", async () => {
  const s = server(), original = blueprint(), m = await loadEditingFixture(ctx, original);
  const before = s.calls.filter(call => call.method !== "GET").length;
  for (const file of [new File(["not png"], "image.png", { type: "image/png" }), new File(["text"], "file.txt", { type: "text/html" }), new File(["text"], "../file.txt"), new File([new Uint8Array(2097153)], "big.txt"), new File([], "empty.txt")]) await expect(uploadRemoteMedia(ctx, m, file)).rejects.toThrow();
  expect(s.calls.filter(call => call.method !== "GET")).toHaveLength(before);
  for (const folder of ["../escape", "/escape", "media//files", "media\\files"]) {
    const malformed = blueprint(); malformed.github!.mediaDir = folder;
    const loaded = await loadEditingFixture(ctx, malformed);
    await expect(listRemoteMedia(ctx, loaded)).rejects.toThrow();
  }
  s.put("playground/public/rigel-media", "symlink");
  s.files.get("playground/public/rigel-media")!.mode = "120000";
  const linked = await loadEditingFixture(ctx, original);
  await expect(listRemoteMedia(ctx, linked)).rejects.toThrow(/directory/);
});

test("media listing reads current draft head without adopting rival writes or fabricated modified dates", async () => {
  const s = server(), original = blueprint();
  original.github!.publicDir = "static assets"; original.github!.mediaDir = "uploads/files";
  const m = await loadEditingFixture(ctx, original);
  s.put("playground/static assets/uploads/files/current.txt", "remote");
  const assets = await listRemoteMedia(ctx, m);
  expect(assets).toEqual([{ url: "/uploads/files/current.txt", name: "current.txt", type: "text/plain", size: 6 }]);
  expect(assets[0]).not.toHaveProperty("modified");
  await expect(uploadRemoteMedia(ctx, m, new File(["local"], "file.txt"))).rejects.toThrow(/conflict/);
  await expect(updateRemoteMedia(ctx, m, { url: assets[0].url, title: "local" })).rejects.toThrow(/conflict/);
  expect(s.calls.filter(call => call.method !== "GET")).toEqual([]);
});

test("media and content writes share the draft queue and preserve both assets", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  const urls = await Promise.all([uploadRemoteMedia(ctx, m, new File(["first"], "first.txt")), uploadRemoteMedia(ctx, m, new File(["second"], "second.txt")), saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Saved together" }, emptyBody(), false)]);
  expect((await listRemoteMedia(ctx, m)).map(asset => asset.url).sort()).toEqual(urls.slice(0, 2).sort());
  expect(JSON.parse(s.files.get("playground/src/content/blog/hello.json")!.text).frontmatter.title).toBe("Saved together");
});

test("media retries verify the complete atomic commit after lost upload or deletion readback", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint()), original = fetch;
  const file = new File(["Retry file"], "retry.txt");
  let fail = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (fail && url.includes("/contents/")) { fail = false; throw new Error("Lost readback"); }
    return original(url, init);
  });
  await expect(uploadRemoteMedia(ctx, m, file)).rejects.toThrow();
  const url = await uploadRemoteMedia(ctx, m, file);
  expect((await listRemoteMedia(ctx, m)).map(asset => asset.url)).toEqual([url]);
  expect(s.calls.filter(call => call.path === "/git/commits" && call.method === "POST")).toHaveLength(1);
  fail = true;
  await expect(deleteRemoteMedia(ctx, m, url)).rejects.toThrow();
  await deleteRemoteMedia(ctx, m, url);
  expect(await listRemoteMedia(ctx, m)).toEqual([]);
  expect(s.calls.filter(call => call.path === "/git/commits" && call.method === "POST")).toHaveLength(2);
});

test("post deletion waits for an in-flight media commit on the shared draft queue", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint()), original = fetch;
  let release!: () => void, started!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (first && url.endsWith("/git/blobs") && init?.method === "POST") { first = false; started(); await held; }
    return original(url, init);
  });
  const upload = uploadRemoteMedia(ctx, m, new File(["queued"], "queue.txt"));
  await writing;
  const deletion = deleteRemotePost(ctx, m, "blog", "hello");
  await new Promise(resolve => setTimeout(resolve, 10));
  const writesWhileBlocked = s.calls.filter(call => call.method === "PATCH").length;
  release();
  await Promise.all([upload, deletion]);
  expect(writesWhileBlocked).toBe(0);
  expect(await listRemoteMedia(ctx, m)).toHaveLength(1);
  expect(s.files.has("playground/src/content/blog/hello.json")).toBe(false);
});

test("reconciling an uncertain legacy deletion does not acknowledge a different file deletion", async () => {
  const s = server();
  s.put("playground/public/rigel-media/first.txt", "first");
  s.put("playground/public/rigel-media/second.txt", "second");
  const m = await loadEditingFixture(ctx, blueprint()), original = fetch;
  let fail = true;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (fail && url.includes("/contents/")) { fail = false; throw new Error("Lost readback"); }
    return original(url, init);
  });
  await expect(deleteRemoteMedia(ctx, m, "/rigel-media/first.txt")).rejects.toThrow();
  await deleteRemoteMedia(ctx, m, "/rigel-media/second.txt");
  expect(await listRemoteMedia(ctx, m)).toEqual([]);
  expect(s.files.has("playground/public/rigel-media/second.txt")).toBe(false);
});

test("media larger than the content decoder limit uses Git blobs for binary readback", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  const bytes = "x".repeat(1024 * 1024 + 32);
  const url = await uploadRemoteMedia(ctx, m, new File([bytes], "large.txt", { type: "text/plain" }));
  expect(await (await readRemoteMedia(ctx, m, url)).text()).toBe(bytes);
  expect(s.calls.some(call => call.path.startsWith("/contents/") && call.path.endsWith(url))).toBe(false);
  expect((await listRemoteMedia(ctx, m))[0].size).toBe(bytes.length);
});

vi.mock("./github-text-batch", () => ({ readGitHubTextBatch: async () => new Map() }));
vi.mock("virtual:rigel-extensions", () => ({ default: [{ name: "notes", blocks: [{ name: "note", label: "Note", editor() {}, render() {}, validate(data: Record<string, unknown>) { if (typeof data.text !== "string") throw new Error("Note requires text"); } }] }] }));
const ctx = { token: "secret-token", repo: "owner/site", branch: "drafts" };

test("GitHub saves apply registered validation before requests and preserve unknown blocks", async () => {
  const s = server(), m = await loadEditingFixture(ctx, blueprint());
  const body = { root: { ...emptyBody().root, children: [{ type: "extension", version: 1, name: "note", data: { text: "Safe" } }, { type: "extension", version: 1, name: "uninstalled", data: { unknown: true } }] } };
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Extensions" }, body, false);
  const path = "playground/src/content/blog/hello.json", before = s.files.get(path)!.text, calls = s.calls.length;
  expect(JSON.parse(before).body).toEqual(body);
  body.root.children[0].data = {} as typeof body.root.children[0]["data"];
  await expect(saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Invalid" }, body, false)).rejects.toThrow("Note requires text");
  expect(s.calls).toHaveLength(calls);
  expect(s.files.get(path)!.text).toBe(before);
});
const blueprint = (): Manifest => ({
  github: {repo:ctx.repo, branch:"drafts", publishBranch:"main", repoRoot:"playground", authOrigin:"https://auth.example", appSlug:"rigel", copyDir:"src/content/copy", collections:[{name:"blog",folder:"src/content/blog"}], menus:{folder:"src/content/menus",maxDepth:3}},
  pages:[{slug:"contact",label:"Contact",groups:[],values:{}}],
  collections:[{name:"blog",label:"Blog",fields:[{key:"author",label:"Author",type:"reference",to:"author"}],posts:[]}],
  menus:{maxDepth:3,entries:[]},
  schema:{objects:[],documents:[{name:"author",title:"Authors",type:"document",folder:"src/content/authors",fields:[{key:"name",label:"Name",type:"string",required:true}]}]},documents:[],
});

function server() {
  let seq = 0;
  type File = { sha: string; text: string; mode?: string };
  const id = () => (++seq).toString(16).padStart(40, "0");
  const files = new Map<string, File>();
  const blobs = new Map<string, string>();
  const trees = new Map<string, Map<string, File>>();
  const commits = new Map<string, { tree: string; parents: string[] }>();
  const put = (path: string, text: string) => { const sha = createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"); blobs.set(sha, text); files.set(path, { sha, text }); };
  put("playground/src/content/copy/contact.ts", readFileSync("tests/fixtures/site/src/content/copy/contact.ts", "utf8"));
  put("playground/src/content/authors/alex.json", JSON.stringify({ name: "Álex 🌍" }));
  put("playground/src/content/blog/hello.json", JSON.stringify({ frontmatter: { title: "Hello", author: "author:alex" }, body: emptyBody() }));
  put("playground/src/content/menus/main.json", JSON.stringify({ slug: "main", title: "Main", items: [] }));
  put("unrelated/unsafe.ts", "throw Error('do not fetch')");
  const remember = (head: string, parents: string[] = []) => { const tree = id(); trees.set(tree, new Map(files)); commits.set(head, { tree, parents }); };
  remember("a".repeat(40)); remember("b".repeat(40));
  const calls: { path: string; method: string; body: any }[] = [];
  const state = { exists: true, race: false, truncated: false, status: 0, malformed: false, head: "a".repeat(40), files, calls,
    put(path: string, text: string) { const parent = state.head; put(path, text); state.head = id(); remember(state.head, [parent]); },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input), path = decodeURIComponent(url.pathname.replace("/repos/owner/site", ""));
    const method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    const json = (data: any, status = 200) => Response.json(data, { status });
    if (state.status) return json({ message: "secret-token raw body" }, state.status);
    if (path === "/git/ref/heads/drafts") return state.exists ? json({ object: { sha: state.head } }) : json({}, 404);
    if (path === "/git/ref/heads/main") return json({ object: { sha: "b".repeat(40) } });
    if (path === "/git/refs" && method === "POST") { state.exists = true; state.head = body.sha; return state.race ? json({}, 422) : json({ ref: body.ref, object: { sha: body.sha } }, 201); }
    if (path.startsWith("/git/trees/")) {
      const key = path.slice(11), tree = trees.get(commits.get(key)?.tree ?? key);
      return tree ? json({ truncated: state.truncated, tree: [...tree].map(([path, file]) => ({ path, sha: file.sha, type: "blob", mode: file.mode ?? "100644", size: Buffer.byteLength(file.text) })) }) : json({}, 404);
    }
    if (path.startsWith("/git/blobs/")) { const sha = path.slice(11), text = blobs.get(sha); return text !== undefined ? json({ sha, encoding: "base64", content: state.malformed ? "%%%" : Buffer.from(text).toString("base64") }) : json({}, 404); }
    if (path.startsWith("/git/commits/")) { const commit = commits.get(path.slice(13)); return commit ? json({ tree: { sha: commit.tree }, parents: commit.parents.map(sha => ({ sha })) }) : json({}, 404); }
    if (path === "/git/blobs" && method === "POST") { const text = Buffer.from(body.content, "base64").toString("utf8"), sha = createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex"); blobs.set(sha, text); return json({ sha }, 201); }
    if (path === "/git/trees" && method === "POST") {
      const base = trees.get(body.base_tree); if (!base) return json({}, 422);
      const next = new Map(base);
      for (const entry of body.tree) { if (entry.sha === null) next.delete(entry.path); else { const text = blobs.get(entry.sha); if (text === undefined) return json({}, 422); next.set(entry.path, { sha: entry.sha, text, mode: entry.mode }); } }
      const sha = id(); trees.set(sha, next); return json({ sha }, 201);
    }
    if (path === "/git/commits" && method === "POST") { if (!trees.has(body.tree) || body.parents.some((sha: string) => !commits.has(sha))) return json({}, 422); const sha = id(); commits.set(sha, { tree: body.tree, parents: body.parents }); return json({ sha }, 201); }
    if (path === "/git/refs/heads/drafts" && method === "PATCH") {
      const commit = commits.get(body.sha);
      if (body.force !== false) throw new Error("Forced branch update!");
      if (!commit || commit.parents[0] !== state.head) return json({}, 422);
      state.head = body.sha; files.clear(); for (const [path, file] of trees.get(commit.tree)!) files.set(path, file);
      return json({ object: { sha: state.head } });
    }
    if (path.startsWith("/contents/") && method === "GET") { const file = files.get(path.slice(10)); return file ? json({ type: "file", sha: file.sha, encoding: "base64", content: Buffer.from(file.text).toString("base64") }) : json({}, 404); }
    throw new Error(`Unexpected ${method} ${path}`);
  }));
  return state;
}
afterEach(()=>vi.unstubAllGlobals());

test("GitHub hydration preserves locale metadata across reloads without automatic writes", async () => {
  const s = server(), original = blueprint();
  original.contentLocales = { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] };
  original.pages[0].locale = "fr";
  original.collections![0].locale = "fr";
  original.schema!.documents[0].locale = "en";
  const before = new Map(s.files);
  for (let i = 0; i < 2; i++) {
    const loaded = await loadEditingFixture(ctx, original);
    expect(loaded.contentLocales).toEqual(original.contentLocales);
    expect(loaded.pages[0].locale).toBe("fr");
    expect(loaded.collections![0].locale).toBe("fr");
    expect(loaded.schema!.documents[0].locale).toBe("en");
    expect(loaded.pages[0].values).not.toEqual({});
    expect(loaded.collections![0].posts).toHaveLength(1);
    expect(loaded.documents![0].type).toBe("author");
  }
  expect(s.files).toEqual(before);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test.each([undefined, "pretty", "minified"] as const)("GitHub saves use %s JSON for posts, documents and menus only", async (jsonOutput) => {
  const s = server(), original = blueprint();
  original.github!.jsonOutput = jsonOutput;
  const before = new Map(s.files);
  const m = await loadEditingFixture(ctx, original);
  expect(s.files).toEqual(before);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
  const frontmatter = { title: "Árbol 🌍", author: "author:alex", custom: { keep: [false, "line\nbreak"] } };
  const body = emptyBody();
  const data = { name: "Zoë 🌍", custom: { keep: true }, _id: "author:alex", _type: "author" };
  const menu = { slug: "main", title: "Menú 🌍", items: [{ id: "home", label: "Home", url: "/", newTab: false, children: [] }] };
  const expected = (value: unknown) => JSON.stringify(value, null, jsonOutput === "minified" ? undefined : 2) + "\n";
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, frontmatter, body, false);
  expect(s.files.get("playground/src/content/blog/hello.json")!.text).toBe(expected({ frontmatter, body }));
  expect(s.files.get("playground/src/content/authors/alex.json")).toEqual(before.get("playground/src/content/authors/alex.json"));
  await saveRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }, data, "", false);
  expect(s.files.get("playground/src/content/authors/alex.json")!.text).toBe(expected(data));
  await saveRemoteSelection(ctx, m, { kind: "menu", slug: "main" }, menu, "", false);
  expect(s.files.get("playground/src/content/menus/main.json")!.text).toBe(expected(menu));
  expect(s.files.get("playground/src/content/copy/contact.ts")).toEqual(before.get("playground/src/content/copy/contact.ts"));
  expect(s.files.get("unrelated/unsafe.ts")).toEqual(before.get("unrelated/unsafe.ts"));
  const reloaded = await loadEditingFixture(ctx, original);
  expect(reloaded.collections![0].posts[0]).toEqual({ slug: "hello", frontmatter });
  expect(await readRemotePost(ctx, reloaded, "blog", "hello")).toEqual({ slug: "hello", frontmatter, body });
  expect(reloaded.documents![0].data).toEqual(data);
  expect(reloaded.menus!.entries).toEqual([menu]);
});

test("invalid collection saves never mutate GitHub or discard existing properties", async () => {
  const s = server();
  const original = blueprint();
  original.collections![0].fields.push(
    { key: "title", label: "Title", type: "string", required: true },
    { key: "description", label: "Description", type: "text" },
    { key: "tags", label: "Tags", type: "tags" },
    { key: "date", label: "Date", type: "date" },
  );
  const m = await loadEditingFixture(ctx, original);
  const before = new Map(s.files);
  const calls = s.calls.length;
  for (const invalid of [{ title: "" }, { description: false }, { tags: "tag" }, { date: "2026-02-30" }, { author: "missing" }]) {
    const values = { title: "Unsaved", description: "", custom: { keep: true }, ...invalid };
    const copy = structuredClone(values);
    await expect(saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, values, emptyBody(), false)).rejects.toThrow();
    expect(values).toEqual(copy);
  }
  expect(s.calls).toHaveLength(calls);
  expect(s.files).toEqual(before);
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Saved", description: "", custom: { keep: true } }, emptyBody(), false);
  expect(JSON.parse(s.files.get("playground/src/content/blog/hello.json")!.text).frontmatter).toMatchObject({ description: "", custom: { keep: true } });
});

test("remote URL edits preserve paths, ids, references, omissions and reject duplicate fallbacks", async () => {
  const s = server();
  const original = blueprint();
  const m = await loadEditingFixture(ctx, original);
  const post = { title: "Spanish", slug: "Árbol y NIÑO!", author: "author:alex", custom: { keep: true } };
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, post, emptyBody(), false);
  const reloaded = await loadEditingFixture(ctx, original);
  expect(reloaded.collections![0].posts[0]).toMatchObject({ slug: "hello", frontmatter: { ...post, slug: "arbol-y-nino" } });
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "arbol-y-nino" }, emptyBody(), true)).rejects.toThrow(/already used/);
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "!!!" }, emptyBody(), true)).rejects.toThrow(/slug/);
  await saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "legacy" }, { title: "Legacy" }, emptyBody(), true);
  expect(JSON.parse(s.files.get("playground/src/content/blog/legacy.json")!.text).frontmatter).not.toHaveProperty("slug");
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "legacy" }, emptyBody(), true)).rejects.toThrow(/already used/);
  const doc = { name: "Álex", slug: "Página española", custom: { keep: true } };
  await saveRemoteSelection(ctx, reloaded, { kind: "document", type: "author", id: "author:alex" }, doc, "", false);
  const after = await loadEditingFixture(ctx, original);
  expect(after.documents![0]).toMatchObject({ id: "author:alex", slug: "alex", data: { ...doc, slug: "pagina-espanola", _id: "author:alex" } });
  expect([...s.files.keys()].filter(path => path.includes("authors/") && !path.endsWith(".rigel-collection.json"))).toEqual(["playground/src/content/authors/alex.json"]);
});

test("remote read and save boundaries reject explicit-versus-legacy URL collisions", async () => {
  const s = server();
  const postPath = "playground/src/content/blog/other.json";
  s.put(postPath, JSON.stringify({ frontmatter: { title: "Other", slug: "hello" }, body: emptyBody() }));
  await expect(loadEditingFixture(ctx, blueprint())).rejects.toThrow(/already used/);
  s.files.delete(postPath);
  const docPath = "playground/src/content/authors/other.json";
  s.put(docPath, JSON.stringify({ name: "Other", slug: "alex" }));
  await expect(loadEditingFixture(ctx, blueprint())).rejects.toThrow(/already used/);
  s.put(docPath, JSON.stringify({ name: "Other" }));
  const m = await loadEditingFixture(ctx, blueprint());
  await expect(saveRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }, { name: "Spanish", slug: "other" }, "", false)).rejects.toThrow(/already used/);
  for (const slug of ["", "!!!", null]) await expect(saveRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }, { name: "Spanish", slug }, "", false)).rejects.toThrow(/slug/);
  s.put(postPath, JSON.stringify({ frontmatter: { slug: "BAD URL" }, body: emptyBody() }));
  await expect(loadEditingFixture(ctx, blueprint())).rejects.toThrow(/slug/);
});

test("remote saves reject URL claims added to another file since loading", async () => {
  const s = server();
  const m = await loadEditingFixture(ctx, blueprint());
  s.put("playground/src/content/blog/other.json", JSON.stringify({ frontmatter: { title: "Other", slug: "claimed" }, body: emptyBody() }));
  s.head = "b".repeat(40);
  await expect(saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Draft", slug: "claimed" }, emptyBody(), false)).rejects.toThrow(/reload/);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test("concurrent remote drafts cannot claim the same effective URL slug", async () => {
  const s = server();
  const m = await loadEditingFixture(ctx, blueprint());
  const results = await Promise.allSettled(["one", "two"].map(slug => saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug }, { title: "Race", slug: "shared-url" }, emptyBody(), true)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(s.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});

test("independent remote editors atomically compete for a URL slug on different filenames", async () => {
  const s = server();
  const one = await loadEditingFixture(ctx, blueprint());
  const two = await loadEditingFixture(ctx, blueprint());
  const original = fetch;
  let arrivals = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (init?.method === "PATCH") { if (++arrivals === 2) release(); await gate; }
    return original(input, init);
  });
  const results = await Promise.allSettled([one, two].map((m, index) => saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: `editor-${index}` }, { title: "Race", slug: "shared-url" }, emptyBody(), true)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const reloaded = await loadEditingFixture(ctx, blueprint());
  expect(reloaded.collections![0].posts.filter(post => post.frontmatter.slug === "shared-url")).toHaveLength(1);
  expect(s.calls.filter(call => call.method === "PATCH")).toHaveLength(2);
  expect(s.calls.filter(call => call.method === "PATCH").every(call => call.body.force === false)).toBe(true);
});

test("remote collection loads validate present types without filling optional omissions", async () => {
  const s = server();
  const original = blueprint();
  original.collections![0].fields.push({ key: "description", label: "Description", type: "text" });
  const manifest = await loadEditingFixture(ctx, original);
  expect(Object.hasOwn(manifest.collections![0].posts[0].frontmatter, "description")).toBe(false);
  s.put("playground/src/content/blog/hello.json", JSON.stringify({ frontmatter: { description: false }, body: emptyBody() }));
  await expect(loadEditingFixture(ctx, original)).rejects.toThrow(/Description/);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

async function pageFixture() {
  const s = server(), original = blueprint();
  original.schema!.documents.push({ name: "page", title: "Pages", type: "document", folder: "src/content/pages", protectedSlugs: ["home"], fields: [{ key: "title", label: "Title", type: "string" }, { key: "related", label: "Related", type: "reference", to: ["page"] }] });
  for (const slug of ["home", "extra", "other"]) s.put(`playground/src/content/pages/${slug}.json`, JSON.stringify({ title: slug, ...(slug === "home" ? { slug: "renamed-home" } : {}) }));
  return { s, original };
}

test("GitHub page deletion protects developer slugs even when their public slug changes", async () => {
  const { s, original } = await pageFixture(), m = await loadEditingFixture(ctx, original);
  const before = s.calls.length, files = new Map(s.files);
  await expect(deleteRemoteDocument(ctx, m, "page:home")).rejects.toThrow(/part of the website/);
  expect(s.calls).toHaveLength(before);
  expect(s.files).toEqual(files);
});

test("GitHub deletes only the selected unprotected page and verifies its absence", async () => {
  const { s, original } = await pageFixture(), m = await loadEditingFixture(ctx, original);
  const before = new Map(s.files);
  await deleteRemoteDocument(ctx, m, "page:extra");
  before.delete("playground/src/content/pages/extra.json");
  before.set("playground/src/content/pages/.rigel-collection.json", s.files.get("playground/src/content/pages/.rigel-collection.json")!);
  expect(s.files).toEqual(before);
  expect((await loadEditingFixture(ctx, original)).documents!.some(doc => doc.id === "page:extra")).toBe(false);
  expect(s.calls.filter(call => call.method === "PATCH").every(call => call.path === "/git/refs/heads/drafts" && call.body.force === false)).toBe(true);
});

test.each(["document", "collection"])("GitHub refuses page deletion referenced by a %s", async source => {
  const { s, original } = await pageFixture();
  if (source === "document") s.put("playground/src/content/pages/other.json", JSON.stringify({ title: "Related", related: { _ref: "page:extra" } }));
  else {
    original.collections![0].fields.push({ key: "related", label: "Related", type: "reference", to: "page" });
    s.put("playground/src/content/blog/hello.json", JSON.stringify({ frontmatter: { title: "Related", related: "page:extra" }, body: emptyBody() }));
  }
  const m = await loadEditingFixture(ctx, original), before = new Map(s.files), calls = s.calls.length;
  await expect(deleteRemoteDocument(ctx, m, "page:extra")).rejects.toThrow(/referenc/i);
  expect(s.files).toEqual(before);
  expect(s.calls).toHaveLength(calls);
});

test("GitHub page deletion shares the save queue and refuses a changed remote head", async () => {
  const { s, original } = await pageFixture(), m = await loadEditingFixture(ctx, original);
  await Promise.all([
    saveRemoteSelection(ctx, m, { kind: "document", type: "page", id: "page:extra" }, { title: "Saved first" }, "", false),
    deleteRemoteDocument(ctx, m, "page:extra"),
  ]);
  expect(s.files.has("playground/src/content/pages/extra.json")).toBe(false);
  s.put("playground/src/content/pages/other.json", JSON.stringify({ title: "Concurrent edit" }));
  const before = new Map(s.files);
  await expect(deleteRemoteDocument(ctx, m, "page:other")).rejects.toThrow(/conflict/i);
  expect(s.files).toEqual(before);
});

test("loads real draft content and CAS saves all kinds with Unicode without touching main",async()=>{
  const s=server();const original=blueprint();const m=await loadEditingFixture(ctx,original);
  expect(m.pages[0].values.intro.heading).toBe("Start with a hello.");
  expect(m.documents?.[0].id).toBe("author:alex");
  expect(m.collections?.[0].posts[0].frontmatter.author).toBe("author:alex");
  expect(original.pages[0].values).toEqual({});
  expect(s.calls.filter(c=>c.path.startsWith("/git/blobs/")).length).toBe(4);
  await saveRemoteSelection(ctx,m,{kind:"page",slug:"contact"},{intro:{heading:"東京 🌍 $&",lead:"Hi"}},"",false);
  expect(readValues(s.files.get("playground/src/content/copy/contact.ts")!.text).intro).toEqual({heading:"東京 🌍 $&",lead:"Hi"});
  await saveRemoteSelection(ctx,m,{kind:"document",type:"author",id:"author:alex"},{name:"Zoë"},"",false);
  await saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{title:"世界",author:"author:alex"},emptyBody(),false);
  await saveRemoteSelection(ctx,m,{kind:"menu",slug:"main"},{title:"Menu",items:[]},"",false);
  await saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"new"},{title:"New"},emptyBody(),true);
  await deleteRemotePost(ctx,m,"blog","new");
  const reloaded=await loadEditingFixture(ctx,original);
  expect(reloaded.documents?.[0].data.name).toBe("Zoë");
  expect(reloaded.collections?.[0].posts[0].frontmatter.title).toBe("世界");
  expect(s.calls.filter(c=>c.method==="PATCH").every(c=>c.path === "/git/refs/heads/drafts" && c.body.force === false)).toBe(true);
  expect(s.calls.some(c=>c.method === "PUT" || c.method === "DELETE")).toBe(false);
});

test.each([false,true])("creates absent drafts from publish head without forcing, including race=%s",async race=>{
  const s=server();s.exists=false;s.race=race;
  await loadEditingFixture(ctx,blueprint());
  expect(s.calls.filter(c=>c.method!=="GET")).toEqual([{path:"/git/refs",method:"POST",body:{ref:"refs/heads/drafts",sha:"b".repeat(40)}}]);
  expect(s.calls.filter(c=>c.path==="/git/ref/heads/drafts").length).toBe(2);
});

test("existing branch is never reset or recreated",async()=>{
  const s=server();await loadEditingFixture(ctx,blueprint());
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
  expect(s.calls.some(c=>c.path==="/git/ref/heads/main")).toBe(false);
});

test("content requests bypass persistent caches and time out without forwarding cookies",async()=>{
  server();
  await loadEditingFixture(ctx,blueprint());
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error", signal: expect.any(AbortSignal) });
});

test("loaded CAS state survives a reactive manifest proxy without leaking into JSON",async()=>{
  server();const m=await loadEditingFixture(ctx,blueprint());
  const proxy=new Proxy(m,{});
  await saveRemoteSelection(ctx,proxy,{kind:"document",type:"author",id:"author:alex"},{name:"Proxy"},"",false);
  expect(JSON.stringify(m)).not.toMatch(/secret-token|\"files\"|\"paths\"/);
});

test("CAS keeps loaded SHA and refuses collisions for updates, deletes and creates",async()=>{
  const s=server();const m=await loadEditingFixture(ctx,blueprint());
  const path="playground/src/content/blog/hello.json";const original=s.files.get(path)!;
  s.put(path,original.text+"\n");
  const before=s.calls.length;
  await expect(saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{title:"Changed"},emptyBody(),false)).rejects.toThrow(/conflict.*reload/i);
  expect(s.calls.slice(before).map(c=>c.method)).toEqual(["GET"]);
  await expect(deleteRemotePost(ctx,m,"blog","hello")).rejects.toThrow(/conflict/i);
  await expect(saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{},emptyBody(),true)).rejects.toThrow(/conflict/);
  s.put("playground/src/content/blog/new.json",original.text);
  await expect(saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"new"},{},emptyBody(),true)).rejects.toThrow(/conflict/);
  expect(s.files.get(path)?.text).toBe(original.text+"\n");
});

test.each(["update", "create", "delete"])("retry reconciles a completed %s after transient readback failure without repeating the mutation",async action=>{
  const s=server(); const m=await loadEditingFixture(ctx,blueprint());
  const slug=action === "create" ? "new" : "hello";
  const original=fetch; let fail=true;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    if(input.includes(`/contents/playground/src/content/blog/${slug}.json`) && (!init?.method || init.method === "GET") && fail) { fail=false; throw new Error("Transient verification outage"); }
    return original(input,init);
  });
  const save=()=>action === "delete" ? deleteRemotePost(ctx,m,"blog",slug) : saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug},{title:"Confirmed retry"},emptyBody(),action === "create");
  await expect(save()).rejects.toThrow(/request failed/);
  await expect(save()).resolves.toBeUndefined();
  expect(s.calls.filter(call=>call.method === "PATCH")).toHaveLength(1);
  if(action === "delete") expect(s.files.has(`playground/src/content/blog/${slug}.json`)).toBe(false);
  else expect(JSON.parse(s.files.get(`playground/src/content/blog/${slug}.json`)!.text).frontmatter.title).toBe("Confirmed retry");
});

test.each([false, true].flatMap(applied => ([undefined, "minified"] as const).map(jsonOutput => ({ applied, jsonOutput }))))("retry reconciles a lost ref-update response, applied=$applied format=$jsonOutput", async ({ applied, jsonOutput }) => {
  const s = server(), originalManifest = blueprint();
  originalManifest.github!.jsonOutput = jsonOutput;
  const m = await loadEditingFixture(ctx, originalManifest);
  const original = fetch;
  let fail = true;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (init?.method === "PATCH" && fail) {
      fail = false;
      if (applied) await original(input, init);
      throw new Error("Lost branch update response");
    }
    return original(input, init);
  });
  const save = () => saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "new" }, { title: "Retained draft", slug: "spanish-url" }, emptyBody(), true);
  await expect(save()).rejects.toThrow(/request failed/);
  await expect(save()).resolves.toBeUndefined();
  expect(s.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
  expect(s.calls.filter(call => call.path === "/git/commits" && call.method === "POST")).toHaveLength(1);
  expect(JSON.parse(s.files.get("playground/src/content/blog/new.json")!.text).frontmatter.slug).toBe("spanish-url");
  expect(s.files.get("playground/src/content/blog/new.json")!.text).toBe(JSON.stringify({ frontmatter: { title: "Retained draft", slug: "spanish-url" }, body: emptyBody() }, null, jsonOutput === "minified" ? undefined : 2) + "\n");
});

test("uncertain write reconciliation rejects another editor's changes without adopting their SHA",async()=>{
  const s=server(); const m=await loadEditingFixture(ctx,blueprint());
  const original=fetch; let fail=true;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    if(input.includes("/contents/") && (!init?.method || init.method === "GET") && fail) { fail=false; throw new Error("Transient verification outage"); }
    return original(input,init);
  });
  const save=()=>saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{title:"My draft"},emptyBody(),false);
  await expect(save()).rejects.toThrow();
  const path="playground/src/content/blog/hello.json";
  s.put(path,JSON.stringify({frontmatter:{title:"Another editor"},body:emptyBody()}));
  await expect(save()).rejects.toThrow(/changed|conflict/);
  expect(s.calls.filter(call=>call.method === "PATCH")).toHaveLength(1);
  expect(JSON.parse(s.files.get(path)!.text).frontmatter.title).toBe("Another editor");
});

test("new edits after an unconfirmed create reconcile before a SHA-protected update",async()=>{
  const s=server(); const m=await loadEditingFixture(ctx,blueprint());
  const original=fetch; let fail=true;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    if(input.includes("/contents/") && (!init?.method || init.method === "GET") && fail) { fail=false; throw new Error("Transient verification outage"); }
    return original(input,init);
  });
  const save=(title:string)=>saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"new"},{title},emptyBody(),true);
  await expect(save("First draft")).rejects.toThrow();
  const firstHead=s.head;
  await save("Newer unsaved draft");
  const mutations=s.calls.filter(call=>call.method === "PATCH");
  expect(mutations).toHaveLength(2);
  expect(s.calls.filter(call=>call.path === "/git/commits" && call.method === "POST")[1].body.parents).toEqual([firstHead]);
  expect(JSON.parse(s.files.get("playground/src/content/blog/new.json")!.text).frontmatter.title).toBe("Newer unsaved draft");
});

test.each([401,403,404,409,429,500])("API %s is actionable and never exposes bodies or tokens",async status=>{
  const s=server();s.status=status;
  const error=await loadEditingFixture(ctx,blueprint()).catch(e=>e);
  expect(error).toBeInstanceOf(Error);expect(error.message).toContain(String(status));
  expect(error.message).not.toMatch(/secret-token|raw body/);
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
});

test("truncated trees and malformed blobs fail closed",async()=>{
  const s=server();s.truncated=true;
  await expect(loadEditingFixture(ctx,blueprint())).rejects.toThrow(/Incomplete/);
  expect(s.calls.some(c=>c.path.startsWith("/git/blobs/"))).toBe(false);
  s.truncated=false;s.malformed=true;
  await expect(loadEditingFixture(ctx,blueprint())).rejects.toThrow(/payload/);
});

test.each(["../outside.json","playground/src/content/blog/../outside.json","a//b"])("rejects malformed traversal tree entry %s",async path=>{
  server();const original=fetch;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    const response=await original(input,init);
    if(input.includes("/git/trees/")) {
      const data=await response.json();data.tree.push({path,type:"blob",mode:"100644",sha:"c".repeat(40)});return Response.json(data);
    }
    return response;
  });
  await expect(loadEditingFixture(ctx,blueprint())).rejects.toThrow(/tree/);
});

test.each(["../outside","/absolute","src//copy","src/./copy","src/%2e%2e/copy","src\\copy"])("rejects unsafe configured path %s without HTTP",async folder=>{
  const s=server();const m=blueprint();m.github!.copyDir=folder;
  await expect(loadEditingFixture(ctx,m)).rejects.toThrow(/path/);
  expect(s.calls).toEqual([]);
});

test("mutations reject publish branch, retargeted manifests, unknown selections and unsafe filenames",async()=>{
  const s=server();const m=await loadEditingFixture(ctx,blueprint());const before=s.calls.length;
  for(const slug of ["../oops","/oops","nested/path","x%2fy"]) await expect(deleteRemotePost(ctx,m,"blog",slug)).rejects.toThrow(/filename/);
  await expect(saveRemoteSelection({...ctx,branch:"main"},m,{kind:"page",slug:"contact"},{},"",false)).rejects.toThrow(/drafts/);
  await expect(saveRemoteSelection(ctx,m,{kind:"collection",name:"blog"},{},"",false)).rejects.toThrow(/editable/);
  await expect(deleteRemotePost(ctx,blueprint(),"blog","hello")).rejects.toThrow(/Reload/);
  m.github!.repoRoot="other";
  await expect(deleteRemotePost(ctx,m,"blog","hello")).rejects.toThrow(/Reload/);
  expect(s.calls.length).toBe(before);
});

test("validation parity rejects broken references, bodies, menus and documents",async()=>{
  const s=server();const m=await loadEditingFixture(ctx,blueprint());const before=s.calls.length;
  await expect(saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{author:"author:missing"},emptyBody(),false)).rejects.toThrow(/existing/);
  await expect(saveRemoteSelection(ctx,m,{kind:"post",collection:"blog",slug:"hello"},{},"",false)).rejects.toThrow();
  await expect(saveRemoteSelection(ctx,m,{kind:"document",type:"author",id:"author:alex"},{},"",false)).rejects.toThrow(/required/);
  await expect(saveRemoteSelection(ctx,m,{kind:"menu",slug:"main"},{title:"Main",items:[{id:"x",label:"X",url:"javascript:alert(1)",children:[]}]},"",false)).rejects.toThrow(/Unsafe/);
  expect(s.calls.length).toBe(before);
  await saveRemoteSelection(ctx,m,{kind:"document",type:"author",id:"author:zoe"},{name:"Zoë"},"",true);
  expect(JSON.parse(s.files.get("playground/src/content/authors/zoe.json")!.text)).toEqual({_id:"author:zoe",_type:"author",name:"Zoë"});
});

test("rejects malformed remote JSON without exposing its content",async()=>{
  const s=server();s.put("playground/src/content/authors/alex.json",'{"secret-token raw body": invalid}');
  const error=await loadEditingFixture(ctx,blueprint()).catch(e=>e);
  expect(error.message).not.toMatch(/secret-token|raw body/);
  expect(error.message).toBe("Invalid remote content JSON");
});

test("loads valid large UTF-8 documents below the local 1 MiB limit",async()=>{
  const s=server();const name="é".repeat(100000);
  s.put("playground/src/content/authors/alex.json",JSON.stringify({name}));
  const m=await loadEditingFixture(ctx,blueprint());
  expect(m.documents?.[0].data.name).toBe(name);
});

test("rejects unsafe tree ancestor before creating content beneath it",async()=>{
  const s=server();const original=fetch;
  vi.stubGlobal("fetch",async(input:string,init?:RequestInit)=>{
    const response=await original(input,init);
    if(input.includes("/git/trees/")) {
      const payload=await response.json();payload.tree.push({path:"playground/src/content/authors",type:"blob",mode:"120000",sha:"c".repeat(40)});
      return Response.json(payload);
    }
    return response;
  });
  await expect(loadEditingFixture(ctx,blueprint())).rejects.toThrow(/directory/);
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
});