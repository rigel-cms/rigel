import { translate } from "../i18n";
import { DEFAULT_MAX_FILE_SIZE, mediaMetadata, safeMediaName, safeFileUrl } from "../../media-types";
import { validateMetaUpdate, META_KEYS, type MediaMeta } from "../../media-metadata";
import { validMediaBytes } from "../../routes/media-validation";
import type { MediaAsset } from "./media-library";
import extensions from "virtual:rigel-extensions";
import { resolveExtensions, validateExtensionBlocks } from "../../extensions";
import type { Manifest } from "../../manifest/types";
import { COLLECTION_LEDGER, readCollectionLedger, serializeCollectionLedger, type CollectionLedgerEntry } from "../../manifest/collection-ledger";
import { serializeContentJson } from "../../json-output";
import { documentLedgerShape, documentMetadata, documentReferences, validDocumentMetadata } from "../../manifest/document-ledger";
import { isProtectedDocument, assertDocumentUnreferenced } from "../../schema/deletion";
import type { Selection } from "../../manifest/navigation";
import { validateBody, type ArticleBody } from "../../article-body";
import { validateMenu } from "../../manifest/menu";
import { validateCollectionValues } from "../../manifest/collections";
import { documentIndex, isPlainObject, validateDocument, validateDocumentId, validateSchema } from "../../schema/validate";
import { applyValues, readValues } from "../../routes/serialize";
import { assertUniqueUrlSlugs, normalizeUrlSlug, validateDocumentSlugs } from "../../slugs";
import { readGitHubTextBatch } from "./github-text-batch";
import { cacheFile, cachedFile, fileCacheScope, fileCacheChanged, fileCacheRevision, fileBlobSha, binaryBlobSha, cachedThumbnail, cacheThumbnail, clearMediaFileCache, onFileCacheClear } from "./file-cache";

export interface GitContext { token: string; repo: string; branch: string; cacheAccount?: string; assertActive?: () => void; mediaSession?: object }

type FileSnapshot = { sha: string; text: string; mode: string };
type MediaChange = { path: string; text: string | null; sha?: string; mode?: string };
type PendingWrite = { sha: string; text: string | null; creating: boolean; head: string; mode: string; changes?: MediaChange[] };
type CollectionSnapshot = { ledger: string; ledgerRead?: boolean; files: Map<string, { path: string; sha: string; mode: string }>; metadata: Map<string, CollectionLedgerEntry>; task?: Promise<void> };
type Snapshot = { documents: Map<string, CollectionSnapshot>; menus: Set<string>; copies: Set<string>; authorize: (ctx: GitContext) => boolean; account: string; reset: () => void; target: string; head: string; writes: Promise<void>; files: Map<string, FileSnapshot>; paths: Set<string>; pending: Map<string, PendingWrite>; collections: Map<string, CollectionSnapshot>; read: (path: string) => Promise<string>; articles: Map<string, { sha: string; mode: string }>; cache: Map<string, number> };
const REMOTE_SNAPSHOT = Symbol("rigel-remote-snapshot");
const SHA = /^[a-f0-9]{40}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POST_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_BYTES = 1024 * 1024;
const MAX_LEDGER_BYTES = 16 * MAX_BYTES;

class GitError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export class PublishReviewChangedError extends Error {}

function safePath(path: string, empty = false): string {
  if (typeof path !== "string" || (!path && !empty) || (path && !path.split("/").every(part => /^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/.test(part)))) throw new Error(translate("connection.unsafePath"));
  return path;
}

function branch(name: string): string {
  if (typeof name !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(name) || name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".") || name.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) throw new Error(translate("connection.invalidBranch"));
  return name;
}

function config(ctx: GitContext, manifest: Manifest) {
  const cfg = manifest.github;
  if (!cfg || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(ctx.repo) || ctx.repo !== cfg.repo || !ctx.token.trim()) throw new Error(translate("connection.connectFirst"));
  branch(ctx.branch); branch(cfg.publishBranch);
  if (ctx.branch !== (cfg.branch || "drafts") || ctx.branch === cfg.publishBranch || ctx.branch === "main" || ctx.branch === "master") throw new Error(translate("connection.dedicatedDraftBranch"));
  safePath(cfg.repoRoot, true); safePath(cfg.copyDir);
  const folders = [cfg.copyDir, ...cfg.collections.map(c => c.folder), ...manifest.schema?.documents.map(d => d.folder) ?? [], ...(cfg.menus ? [cfg.menus.folder] : [])];
  folders.forEach(folder => safePath(folder));
  if (folders.some((folder, index) => folders.some((other, j) => j !== index && (folder === other || folder.startsWith(other + "/"))))) throw new Error(translate("connection.overlappingDirectories"));
  if (manifest.schema) validateSchema(manifest.schema);
  return cfg;
}

function target(ctx: GitContext, manifest: Manifest) { return JSON.stringify([ctx.repo, ctx.branch, manifest.github, manifest.schema]); }
function filePath(ctx: GitContext, manifest: Manifest, folder: string, slug: string, extension = "json", pattern = SLUG) {
  const cfg = config(ctx, manifest);
  if (!pattern.test(slug)) throw new Error(translate("connection.invalidFilename"));
  return [cfg.repoRoot, safePath(folder), `${slug}.${extension}`].filter(Boolean).join("/");
}

async function gh(ctx: GitContext, path: string, init: RequestInit = {}): Promise<any> {
  ctx.assertActive?.();
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${ctx.repo}${path}`, {
      ...init, headers: {Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28", "Content-Type":"application/json"}, redirect:"error", cache:"no-store", credentials:"omit", signal:AbortSignal.timeout(15000),
    });
  } catch { throw new Error(translate("connection.requestFailed")); }
  ctx.assertActive?.();
  if (!response.ok) {
    const rateLimited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    const key = rateLimited ? "connection.requestRateLimited" : ({401:"connection.requestSessionExpired",403:"connection.requestAccessDenied",404:"connection.requestUnavailable",409:"connection.requestConflict",422:"connection.requestRejected"} as Record<number,string>)[response.status] ?? "connection.requestError";
    throw new GitError(translate(key, { status: response.status }), response.status);
  }
  try { return await response.json(); } catch { throw new Error(translate("connection.malformedResponse")); }
}

function sha(value: unknown): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error(translate("connection.malformedSha"));
  return value;
}

async function draftHead(ctx: GitContext, manifest: Manifest, create = true): Promise<string> {
  const cfg = config(ctx, manifest);
  const ref = `/git/ref/heads/${encodeURIComponent(ctx.branch)}`;
  try { return sha((await gh(ctx, ref))?.object?.sha); }
  catch (error) { if (!create || !(error instanceof GitError) || error.status !== 404) throw error; }
  const base = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(cfg.publishBranch)}`))?.object?.sha);
  try { await gh(ctx, "/git/refs", {method:"POST", body:JSON.stringify({ref:`refs/heads/${ctx.branch}`,sha:base})}); }
  catch (error) { if (!(error instanceof GitError) || ![409,422].includes(error.status)) throw error; }
  return sha((await gh(ctx, ref))?.object?.sha);
}

function decode(payload: any, limit = MAX_BYTES): string {
  if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") throw new Error(translate("connection.malformedPayload"));
  const base64 = payload.content.replace(/[\r\n]/g, "");
  if (base64.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error(translate("connection.invalidPayload"));
  try {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    if (bytes.length > limit) throw new Error();
    return new TextDecoder("utf-8", {fatal:true}).decode(bytes);
  } catch { throw new Error(translate("connection.invalidUtf8")); }
}

function encode(text: string, limit = MAX_BYTES): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > limit) throw new Error(translate("connection.contentTooLarge"));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error(translate("connection.invalidRemoteJson")); }
}

async function remoteTree(ctx: GitContext, head: string) {
  const tree = await gh(ctx, `/git/trees/${head}?recursive=1`);
  if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error(translate("connection.incompleteTree"));
  const entries = new Map<string, any>();
  for (const entry of tree.tree) {
    if (!entry || typeof entry.path !== "string" || entry.path.split("/").some((part: string) => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(entry.path) || !["blob","tree","commit"].includes(entry.type) || !SHA.test(entry.sha) || !["100644","100755","120000","040000","160000"].includes(entry.mode)) throw new Error(translate("connection.malformedTreeEntry"));
    if (entries.has(entry.path)) throw new Error(translate("connection.duplicateTreePath"));
    entries.set(entry.path, entry);
  }
  return entries;
}

export async function loadManifestRemote(ctx: GitContext, blueprint: Manifest, createDraft = true, options: { deferCollections?: boolean; deferContent?: boolean } = {}): Promise<Manifest> {
  const cfg = config(ctx, blueprint);
  const head = await draftHead(ctx, blueprint, createDraft);
  const entries = await remoteTree(ctx, head);
  const manifest = structuredClone(blueprint);
  const persistent = ctx.cacheAccount ? await fileCacheScope(ctx.cacheAccount, target(ctx, manifest)) : undefined;
  const snapshot: Snapshot = {documents:new Map(),menus:new Set(),copies:new Set(),authorize:next => { if (!next.cacheAccount || next.cacheAccount !== ctx.cacheAccount) return false; snapshot.reset(); ctx = next; snapshot.account = next.token; return true; },account:ctx.token,reset:() => {},target:target(ctx,manifest),head,writes:Promise.resolve(),files:new Map(),paths:new Set(entries.keys()),pending:new Map(),collections:new Map(),read: path => read(path),articles:new Map(),cache:new Map()};
  const inflight = new Map<string, Promise<string>>();
  for (const [path, entry] of entries) if (entry.type === "blob") snapshot.articles.set(path, { sha: entry.sha, mode: entry.mode });
  let active = 0;
  const waiting: (() => void)[] = [];
  let revision = 0;
  const pending: { sha: string; path: string; size: number; revision: number; resolve: (text: string) => void; reject: (error: unknown) => void }[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | undefined;
  const limited = async <T>(operation: () => Promise<T>) => {
    if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve)); else active++;
    try { return await operation(); } finally { const next = waiting.shift(); if (next) next(); else active--; }
  };
  const flush = () => {
    batchTimer = undefined;
    while (pending.length) {
      const batch: typeof pending = [];
      let bytes = 0;
      while (pending.length && batch.length < 64 && (!batch.length || bytes + pending[0].size <= 2 * MAX_BYTES)) { const item = pending.shift()!; batch.push(item); bytes += item.size; }
      let fatal: unknown;
      const guard = () => { if (fatal) throw fatal; ctx.assertActive?.(); if (batch.some(item => item.revision !== revision)) throw new Error(translate("connection.reloadDraft")); };
      void limited(async () => {
        guard();
        const candidates = batch.filter(item => item.size <= 512 * 1024);
        return candidates.length ? readGitHubTextBatch(ctx, candidates.map(item => ({ sha: item.sha, limit: item.path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : MAX_BYTES }))) : new Map<string, string>();
      }).then(async texts => {
        await Promise.all(batch.map(async item => {
          try {
            guard();
            let text = texts.get(item.sha);
            if (text === undefined) text = await limited(async () => {
              guard();
              const blob = await gh(ctx, `/git/blobs/${item.sha}`);
              if (sha(blob?.sha) !== item.sha) throw new Error(translate("connection.blobShaMismatch"));
              const text = decode(blob, item.path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : MAX_BYTES);
              if (await fileBlobSha(text) !== item.sha) throw new Error(translate("connection.blobShaMismatch"));
              return text;
            });
            guard(); item.resolve(text);
          } catch (error) { if (error instanceof GitError && [401, 403, 429].includes(error.status)) fatal = error; item.reject(error); }
        }));
      }).catch(error => { for (const item of batch) item.reject(error); });
    }
  };
  const readText = (path: string, expected: string, size: number) => new Promise<string>((resolve, reject) => {
    pending.push({ sha: expected, path, size, revision, resolve, reject });
    batchTimer ??= setTimeout(flush, 10);
  });
  snapshot.reset = () => {
    revision++; inflight.clear(); snapshot.files.clear(); snapshot.cache.clear();
    if (batchTimer) clearTimeout(batchTimer); batchTimer = undefined;
    for (const item of pending.splice(0)) item.reject(new Error(translate("connection.reloadDraft")));
    if (manifest.contentIndex?.state === "complete") manifest.contentIndex = { state: "pending" };
    fileCacheChanged();
  };
  const folders = [cfg.copyDir, ...cfg.collections.map(c => c.folder), ...(manifest.schema?.documents.map(d => d.folder) ?? []), ...(cfg.menus ? [cfg.menus.folder] : [])];
  for (const folder of folders) {
    const parts = [cfg.repoRoot,folder].filter(Boolean).join("/").split("/");
    for (let count = 1; count <= parts.length; count++) {
      const entry = entries.get(parts.slice(0,count).join("/"));
      if (entry && (entry.type !== "tree" || entry.mode !== "040000")) throw new Error(translate("connection.invalidDirectory"));
    }
  }
  const read = async (path: string): Promise<string> => {
    const current = snapshot.articles.get(path);
    const entry = current ? { ...current, type: "blob" } : entries.get(path);
    if (!snapshot.paths.has(path) || !entry || entry.type !== "blob" || !["100644","100755"].includes(entry.mode)) throw new Error(translate("connection.invalidFile"));
    const expected = sha(entry.sha);
    ctx.assertActive?.();
    const remember = (text: string) => {
      const file = { sha: expected, text, mode: entry.mode };
      snapshot.files.set(path, file); cacheArticle(snapshot, path, file); fileCacheChanged(); return text;
    };
    const cached = snapshot.files.get(path) ?? [...snapshot.cache.keys()].map(key => snapshot.files.get(key)).find(file => file?.sha === expected);
    if (cached?.sha === expected) return remember(cached.text);
    const shared = inflight.get(expected);
    if (shared) { const started = revision, text = await shared; if (revision !== started) throw new Error(translate("connection.reloadDraft")); return remember(text); }
    const request = (async () => {
      const started = revision;
      const generation = fileCacheRevision();
      if (revision !== started) throw new Error(translate("connection.reloadDraft"));
      const saved = await cachedFile(persistent, expected);
      ctx.assertActive?.();
      if (revision !== started || generation !== fileCacheRevision()) throw new Error(translate("connection.reloadDraft"));
      if (saved !== undefined && new TextEncoder().encode(saved).byteLength <= (path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : MAX_BYTES)) return remember(saved);
      const text = await readText(path, expected, entries.get(path)?.sha === expected && typeof entries.get(path)?.size === "number" ? Math.max(1, entries.get(path)!.size) : MAX_BYTES);
      if (revision !== started || generation !== fileCacheRevision()) throw new Error(translate("connection.reloadDraft"));
      await cacheFile(persistent, expected, text);
      ctx.assertActive?.();
      if (revision !== started || generation !== fileCacheRevision()) throw new Error(translate("connection.reloadDraft"));
      return remember(text);
    })();
    inflight.set(expected, request);
    try { return await request; } finally { if (inflight.get(expected) === request) inflight.delete(expected); }
  };
  const list = (folder: string, pattern = SLUG) => {
    const prefix = [cfg.repoRoot,folder].filter(Boolean).join("/") + "/";
    return [...entries.keys()].filter(path => path.startsWith(prefix) && path.slice(prefix.length) !== COLLECTION_LEDGER && !path.slice(prefix.length).includes("/") && path.endsWith(".json")).sort().map(path => {
      const slug = path.slice(prefix.length,-5);
      if (!pattern.test(slug)) throw new Error(translate("connection.invalidRemoteFilename"));
      return {path,slug};
    });
  };
  for (const page of manifest.pages) page.values = {};
  const documents = (manifest.schema?.documents ?? []).flatMap(type => list(type.folder).map(file => ({ ...file, type: type.name })));
  const menus = cfg.menus ? list(cfg.menus.folder) : [];
  manifest.documents = documents.map(file => ({ id: `${file.type}:${file.slug}`, type: file.type, slug: file.slug, data: {}, loaded: "identity" }));
  for (const type of manifest.schema?.documents ?? []) {
    const files = new Map(documents.filter(file => file.type === type.name).map(file => [file.slug, { path: file.path, sha: entries.get(file.path).sha, mode: entries.get(file.path).mode }]));
    snapshot.documents.set(type.name, { ledger: [cfg.repoRoot, type.folder, COLLECTION_LEDGER].filter(Boolean).join("/"), files, metadata: new Map() });
  }
  documentIndex(manifest.documents, translate);
  if (cfg.menus) manifest.menus = { maxDepth: cfg.menus.maxDepth, entries: menus.map(file => ({ slug: file.slug, title: file.slug, items: [] })) };
  manifest.contentIndex = { state: "pending" };
  await Promise.all((manifest.collections ?? []).map(async collection => {
    const folder = cfg.collections.find(c => c.name === collection.name)?.folder;
    if (!folder) throw new Error(translate("connection.missingCollection"));
    collection.posts = [];
    const ledger = [cfg.repoRoot, folder, COLLECTION_LEDGER].filter(Boolean).join("/");
    const files = new Map(list(folder, POST_SLUG).map(file => {
      const entry = entries.get(file.path);
      if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error(translate("connection.invalidFile"));
      snapshot.articles.set(file.path, { sha: entry.sha, mode: entry.mode });
      return [file.slug, { path: file.path, sha: entry.sha, mode: entry.mode }] as const;
    }));
    const state: CollectionSnapshot = { ledger, files, metadata: new Map() };
    snapshot.collections.set(collection.name, state);
    collection.storageSlugs = [...files.keys()];
    let indexed: CollectionLedgerEntry[] | null = null;
    if (entries.has(ledger)) indexed = readCollectionLedger(await read(ledger), collection);
    for (const entry of indexed ?? []) if (files.get(entry.slug)?.sha === entry.sha) {
      try { validateCollectionValues(collection.fields, entry.frontmatter, manifest.documents, translate); }
      catch { continue; }
      state.metadata.set(entry.slug, entry);
      collection.posts.push({ slug: entry.slug, frontmatter: entry.frontmatter });
    }
    collection.index = { state: state.metadata.size === files.size ? "complete" : "pending", loaded: state.metadata.size, total: files.size };
    assertUniqueUrlSlugs(collection.posts.map(post => ({ slug: post.slug, values: post.frontmatter })), translate);
  }));

  Object.defineProperty(manifest,REMOTE_SNAPSHOT,{value:snapshot});
  if (options.deferCollections === false) await indexRemoteCollections(ctx, manifest);
  return manifest;
}

export function remoteSelectionReady(ctx: GitContext, manifest: Manifest, selection: Selection) {
  const snapshot = loaded(ctx, manifest);
  if (selection.kind === "document") {
    const visited = new Set<string>();
    const ready = (id: string): boolean => {
      if (visited.has(id)) return true;
      visited.add(id);
      const doc = manifest.documents?.find(doc => doc.id === id);
      return doc?.loaded === "complete" && documentReferences(doc.data).every(ready);
    };
    return ready(selection.id);
  }
  if (selection.kind === "menu") return snapshot.menus.has(selection.slug);
  if (selection.kind === "page") return snapshot.copies.has(selection.slug);
  return true;
}

export async function readRemoteSelection(ctx: GitContext, manifest: Manifest, selection: Selection) {
  const snapshot = loaded(ctx, manifest), cfg = config(ctx, manifest);
  if (selection.kind === "document") {
    const visited = new Set<string>();
    const visit = async (id: string): Promise<void> => {
      if (visited.has(id)) return;
      visited.add(id);
      const doc = manifest.documents?.find(doc => doc.id === id), type = manifest.schema?.documents.find(type => type.name === doc?.type);
      if (!doc || !type) throw new Error(translate("connection.unknownDocument"));
      if (doc.loaded !== "complete") {
        const data = parseJson(await snapshot.read(filePath(ctx, manifest, type.folder, doc.slug)));
        if (!isPlainObject(data)) throw new Error(translate("connection.invalidDocument"));
        validateDocument(manifest.schema!, doc.type, doc.slug, data, manifest.documents!, translate);
        ctx.assertActive?.();
        doc.data = data; doc.loaded = "complete";
        const state = snapshot.documents.get(doc.type)!;
        state.metadata.set(doc.slug, { slug: doc.slug, sha: state.files.get(doc.slug)!.sha, frontmatter: documentMetadata(type, data) });
      }
      await Promise.all(documentReferences(doc.data).map(visit));
    };
    await visit(selection.id);
  } else if (selection.kind === "menu") {
    if (!cfg.menus) throw new Error(translate("connection.menusNotConfigured"));
    const menu = validateMenu(parseJson(await snapshot.read(filePath(ctx, manifest, cfg.menus.folder, selection.slug))), cfg.menus.maxDepth, translate);
    if (menu.slug !== selection.slug) throw new Error(translate("connection.menuSlugMismatch"));
    const index = manifest.menus!.entries.findIndex(menu => menu.slug === selection.slug);
    if (index < 0) throw new Error(translate("connection.invalidFile"));
    manifest.menus!.entries[index] = menu; snapshot.menus.add(selection.slug);
  } else if (selection.kind === "page") {
    const page = manifest.pages.find(page => page.slug === selection.slug);
    if (!page) throw new Error(translate("connection.unknownCopyPage"));
    const values = readValues(await snapshot.read(filePath(ctx, manifest, cfg.copyDir, page.slug, "ts")));
    if (!Object.values(values).every(isPlainObject)) throw new Error(translate("connection.invalidCopyGroups"));
    page.values = values as typeof page.values; snapshot.copies.add(page.slug);
  }
}

export async function indexRemoteDocuments(ctx: GitContext, manifest: Manifest, names: string[], changed: () => void = () => {}, signal?: AbortSignal) {
  const snapshot = loaded(ctx, manifest);
  for (const name of names) {
    const type = manifest.schema?.documents.find(type => type.name === name), state = snapshot.documents.get(name);
    if (!type || !state) throw new Error(translate("connection.unknownDocument"));
    if (state.task) {
      try { await state.task; } catch (error) { if (!(error instanceof Error) || error.name !== "AbortError") throw error; }
      ctx.assertActive?.(); signal?.throwIfAborted();
    }
    const guard = () => { ctx.assertActive?.(); signal?.throwIfAborted(); };
    state.task = (async () => {
      guard();
      if (!state.ledgerRead) {
        const entries = snapshot.paths.has(state.ledger) ? readCollectionLedger(await snapshot.read(state.ledger), documentLedgerShape(type, manifest.schema!)) : null;
        guard();
        for (const entry of entries ?? []) if (state.files.get(entry.slug)?.sha === entry.sha && validDocumentMetadata(entry.frontmatter)) state.metadata.set(entry.slug, entry);
        state.ledgerRead = true;
      }
      const publish = (slug: string) => {
        const doc = manifest.documents!.find(doc => doc.id === `${name}:${slug}`)!;
        if (doc.loaded !== "complete") { doc.data = state.metadata.get(slug)!.frontmatter; doc.loaded = "metadata"; }
        changed();
      };
      for (const slug of state.metadata.keys()) publish(slug);
      const missing = [...state.files.keys()].filter(slug => !state.metadata.has(slug));
      let next = 0;
      const results = await Promise.allSettled(Array.from({ length: Math.min(4, missing.length) }, async () => {
        while (next < missing.length) {
          guard();
          const slug = missing[next++], file = state.files.get(slug)!;
          const data = parseJson(await snapshot.read(file.path));
          guard();
          if (!isPlainObject(data)) throw new Error(translate("connection.invalidDocument"));
          validateDocument(manifest.schema!, name, slug, data, manifest.documents!, translate);
          state.metadata.set(slug, { slug, sha: file.sha, frontmatter: documentMetadata(type, data) });
          publish(slug);
        }
      }));
      const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
      manifest.contentIndex = { state: manifest.documents!.every(doc => doc.loaded !== "identity") ? "complete" : "pending" };
    })();
    try { await state.task; } finally { state.task = undefined; }
  }
}

export function reauthorizeRemoteContent(ctx: GitContext, manifest: Manifest) {
  config(ctx, manifest); ctx.assertActive?.();
  const snapshot = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT];
  if (!snapshot || snapshot.target !== target(ctx, manifest)) throw new Error(translate("connection.reloadDraft"));
  const result = snapshot.authorize(ctx);
  if (result && manifest.contentIndex?.state === "complete") manifest.contentIndex = { state: "pending" };
  return result;
}

export async function readRemotePost(ctx: GitContext, manifest: Manifest, name: string, slug: string, dependencies = true) {
  const snapshot = loaded(ctx, manifest), collection = manifest.collections?.find(c => c.name === name), state = snapshot.collections.get(name), file = state?.files.get(slug);
  if (!collection || !file) throw new Error(translate("connection.unknownCollection"));
  if (snapshot.account !== ctx.token) throw new Error(translate("connection.reloadDraft"));
  const post = parseJson(await snapshot.read(file.path));
  ctx.assertActive?.();
  if (!isPlainObject(post) || !isPlainObject(post.frontmatter)) throw new Error(translate("connection.invalidArticle"));
  validateBody(post.body, translate);
  validateCollectionValues(collection.fields, post.frontmatter, manifest.documents, translate);
  const frontmatter = post.frontmatter;
  if (dependencies) await Promise.all(collection.fields.filter(field => field.type === "reference").flatMap(field => {
    const value = frontmatter[field.key];
    return (Array.isArray(value) ? value : value ? [value] : []).map(async ref => {
      const doc = manifest.documents!.find(doc => doc.id === ref)!;
      await readRemoteSelection(ctx, manifest, { kind: "document", type: doc.type, id: doc.id });
    });
  }));
  return { slug, frontmatter: post.frontmatter, body: post.body as ArticleBody };
}

export async function indexRemoteCollections(ctx: GitContext, manifest: Manifest, name?: string, changed: () => void = () => {}, signal?: AbortSignal): Promise<void> {
  const snapshot = loaded(ctx, manifest);
  for (const collection of manifest.collections ?? []) {
    if (name && collection.name !== name) continue;
    const state = snapshot.collections.get(collection.name)!;
    if (state.task) {
      try { await state.task; } catch (error) { if (!(error instanceof Error) || error.name !== "AbortError") throw error; }
      ctx.assertActive?.(); signal?.throwIfAborted();
    }
    if (collection.index?.state === "complete") continue;
    const guard = () => { ctx.assertActive?.(); signal?.throwIfAborted(); };
    state.task = (async () => {
      collection.index!.state = "indexing"; delete collection.index!.error; changed();
      const missing = [...state.files.keys()].filter(slug => !state.metadata.has(slug));
      let next = 0;
      try {
        let failed = false;
        const results = await Promise.allSettled(Array.from({ length: Math.min(4, missing.length) }, async () => {
          while (next < missing.length) {
            if (failed) return;
            guard();
            const slug = missing[next++];
            let post;
            try { post = await readRemotePost(ctx, manifest, collection.name, slug, false); }
            catch (error) { failed = true; throw error; }
            guard();
            state.metadata.set(slug, { slug, sha: state.files.get(slug)!.sha, frontmatter: post.frontmatter });
            const existing = collection.posts.find(post => post.slug === slug);
            if (existing) existing.frontmatter = post.frontmatter;
            else collection.posts.push({ slug, frontmatter: post.frontmatter });
            collection.index!.loaded = state.metadata.size; changed();
          }
        }));
        const failure = results.find(result => result.status === "rejected");
        if (failure?.status === "rejected") throw failure.reason;
        guard();
        assertUniqueUrlSlugs(collection.posts.map(post => ({ slug: post.slug, values: post.frontmatter })), translate);
        collection.index!.state = "complete";
      } catch (error) {
        collection.index!.state = "error";
        collection.index!.error = error instanceof Error ? error.message : translate("connection.requestFailed");
        throw error;
      } finally { changed(); }
    })();
    try { await state.task; } finally { state.task = undefined; }
  }
}

export function reindexRemoteCollections(ctx: GitContext, manifest: Manifest, changed: () => void = () => {}, signal?: AbortSignal): Promise<void> {
  return queueRemoteWrite(ctx, manifest, async () => {
    const guarded = { ...ctx, assertActive: () => { ctx.assertActive?.(); signal?.throwIfAborted(); } };
    const snapshot = loaded(ctx, manifest), ledgers: { path: string; text: string }[] = [];
    for (const type of manifest.schema?.documents ?? []) {
      const state = snapshot.documents.get(type.name)!;
      if (state.task) await state.task;
      guarded.assertActive(); state.metadata.clear(); state.ledgerRead = true;
      await indexRemoteDocuments(guarded, manifest, [type.name], changed, signal);
      ledgers.push({ path: state.ledger, text: serializeCollectionLedger(documentLedgerShape(type, manifest.schema!), [...state.metadata.values()]) });
    }
    validateDocumentSlugs(manifest.schema ?? { documents: [], objects: [] }, manifest.documents ?? [], manifest.preview, translate);
    for (const collection of manifest.collections ?? []) {
      const state = snapshot.collections.get(collection.name)!;
      guarded.assertActive();
      if (state.task) await state.task;
      state.metadata.clear(); collection.posts = [];
      collection.index = { state: "pending", loaded: 0, total: state.files.size };
      await indexRemoteCollections(guarded, manifest, collection.name, changed, signal);
      ledgers.push({ path: state.ledger, text: serializeCollectionLedger(collection, [...state.metadata.values()]) });
    }
    guarded.assertActive();
    const [first, ...rest] = ledgers;
    if (first) await mutate(guarded, manifest, first.path, first.text, !snapshot.paths.has(first.path), rest.map(ledger => ({ path: ledger.path, text: encode(ledger.text, MAX_LEDGER_BYTES) })));
    changed();
  });
}

export function resetRemoteCollectionCache(manifest: Manifest) {
  if (manifest.documents) for (const doc of manifest.documents) {
    const entry = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT]?.documents.get(doc.type)?.metadata.get(doc.slug);
    if (doc.loaded !== "complete") doc.data = entry?.frontmatter ?? {};
    doc.loaded = entry ? "metadata" : "identity";
  }
  const snapshot = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT];
  snapshot?.menus.clear(); snapshot?.copies.clear(); snapshot?.reset();
  if (manifest.contentIndex?.state === "complete") manifest.contentIndex = { state: "pending" };
}

export function hasRemoteFileCache(manifest: Manifest) {
  const snapshot = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT];
  return !!snapshot?.files.size || !!mediaCaches.get(manifest)?.blobs.size;
}

function cacheArticle(snapshot: Snapshot, path: string, file: FileSnapshot) {
  if (!snapshot.articles.has(path)) return;
  snapshot.cache.delete(path);
  snapshot.cache.set(path, new TextEncoder().encode(file.text).byteLength);
  let bytes = [...snapshot.cache.values()].reduce((sum, size) => sum + size, 0);
  while (snapshot.cache.size > 64 || bytes > 16 * 1024 * 1024) {
    const oldest = snapshot.cache.keys().next().value!;
    bytes -= snapshot.cache.get(oldest)!; snapshot.cache.delete(oldest); snapshot.files.delete(oldest);
  }
}

function loaded(ctx: GitContext, manifest: Manifest, sameAccount = true): Snapshot {
  config(ctx,manifest);
  const snapshot = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT];
  ctx.assertActive?.();
  if (!snapshot || snapshot.target !== target(ctx,manifest) || (sameAccount && snapshot.account !== ctx.token)) throw new Error(translate("connection.reloadDraft"));
  return snapshot;
}

async function mutate(ctx: GitContext, manifest: Manifest, path: string, text: string | null, creating: boolean, additions: MediaChange[] | ((blob: string | null) => MediaChange[]) = []) {
  const snapshot = loaded(ctx,manifest);
  const head = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha);
  const uncertain = snapshot.pending.get(path);
  if (head !== snapshot.head && head !== uncertain?.head) throw new Error(translate("connection.draftConflictUnsaved"));
  const endpoint = `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const verify = async (pending: PendingWrite) => {
    const current = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha);
    if (current !== pending.head) {
      if (current !== snapshot.head) throw new Error(translate("connection.draftConflict"));
      const result = await gh(ctx, `/git/refs/heads/${encodeURIComponent(ctx.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: pending.head, force: false }) });
      if (sha(result?.object?.sha) !== pending.head) throw new Error(translate("connection.branchUpdateUnverified"));
    }
    let verified;
    const collectionLedger = path.endsWith("/" + COLLECTION_LEDGER);
    try {
      if (collectionLedger && pending.text !== null) {
        const entry = (await remoteTree(ctx, pending.head)).get(path);
        if (entry?.type !== "blob" || entry.sha !== pending.sha || entry.mode !== pending.mode) throw new Error(translate("connection.saveChanged"));
        verified = { ...await gh(ctx, `/git/blobs/${pending.sha}`), type: "file" };
      } else verified = await gh(ctx,`${endpoint}?ref=${encodeURIComponent(ctx.branch)}`);
    }
    catch (error) {
      if (pending.text !== null || !(error instanceof GitError) || error.status !== 404) throw error;
    }
    if (pending.text === null) {
      if (verified !== undefined) throw new Error(translate("connection.deletionUnverified"));
      snapshot.files.delete(path); snapshot.paths.delete(path);
      snapshot.articles.delete(path); snapshot.cache.delete(path);
    } else {
      if (verified?.type !== "file" || sha(verified.sha) !== pending.sha || decode(verified, path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : MAX_BYTES) !== pending.text) throw new Error(translate("connection.saveChanged"));
      snapshot.files.set(path,{sha:pending.sha,text:pending.text,mode:pending.mode}); snapshot.paths.add(path);
      snapshot.articles.set(path, { sha: pending.sha, mode: pending.mode });
      cacheArticle(snapshot, path, snapshot.files.get(path)!);
    }
    const entries = pending.changes?.length ? await remoteTree(ctx, pending.head) : undefined;
    for (const change of pending.changes ?? []) {
      const entry = entries!.get(change.path);
      if (change.text === null) {
        if (entry) throw new Error(translate("connection.deletionUnverified"));
        snapshot.files.delete(change.path); snapshot.paths.delete(change.path);
        snapshot.articles.delete(change.path); snapshot.cache.delete(change.path);
      } else {
        if (entry?.type !== "blob" || entry.mode !== change.mode || entry.sha !== change.sha) throw new Error(translate("connection.saveChanged"));
        const payload = await gh(ctx, `/git/blobs/${change.sha}`);
        if (sha(payload?.sha) !== change.sha || bytesBase64(decodeMedia(payload, change.path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : manifest.github?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE)) !== change.text) throw new Error(translate("connection.saveChanged"));
        if (change.path.endsWith("/" + COLLECTION_LEDGER)) {
          snapshot.files.set(change.path, { sha: change.sha!, text: decode({ encoding: "base64", content: change.text }, MAX_LEDGER_BYTES), mode: change.mode! });
        } else snapshot.files.delete(change.path);
        snapshot.paths.add(change.path);
        snapshot.articles.set(change.path, { sha: change.sha!, mode: change.mode! });
        const cached = snapshot.files.get(change.path);
        if (cached) cacheArticle(snapshot, change.path, cached);
      }
    }
    if ((pending.changes?.length || collectionLedger) && sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha) !== pending.head) throw new Error(translate("connection.draftConflict"));
    snapshot.head = pending.head;
    snapshot.pending.delete(path);
    fileCacheChanged();
    for (const [name, state] of snapshot.documents) {
      if (!path.startsWith(state.ledger.slice(0, -COLLECTION_LEDGER.length)) || path === state.ledger) continue;
      const slug = path.split("/").at(-1)!.slice(0, -5), type = manifest.schema!.documents.find(type => type.name === name)!;
      if (pending.text === null) { state.files.delete(slug); state.metadata.delete(slug); }
      else {
        state.files.set(slug, { path, sha: pending.sha, mode: pending.mode });
        state.metadata.set(slug, { slug, sha: pending.sha, frontmatter: documentMetadata(type, parseJson(pending.text) as Record<string, unknown>) });
      }
    }
    for (const [name, state] of snapshot.collections) {
      if (!path.startsWith(state.ledger.slice(0, -COLLECTION_LEDGER.length)) || path === state.ledger) continue;
      const slug = path.split("/").at(-1)!.slice(0, -5);
      if (pending.text === null) { state.files.delete(slug); state.metadata.delete(slug); }
      else {
        state.files.set(slug, { path, sha: pending.sha, mode: pending.mode });
        state.metadata.set(slug, { slug, sha: pending.sha, frontmatter: (parseJson(pending.text) as { frontmatter: Record<string, unknown> }).frontmatter });
      }
      if (pending.text === null) { snapshot.articles.delete(path); snapshot.cache.delete(path); }
      else snapshot.articles.set(path, { sha: pending.sha, mode: pending.mode });
      manifest.collections!.find(c => c.name === name)!.index = { state: "complete", loaded: state.metadata.size, total: state.files.size };
      manifest.collections!.find(c => c.name === name)!.storageSlugs = [...state.files.keys()];
    }
  };
  if (uncertain) {
    await verify(uncertain);
    if (uncertain.text === text && (!creating || uncertain.creating) && (typeof additions === "function" || JSON.stringify((uncertain.changes ?? []).map(({ path, text }) => [path, text])) === JSON.stringify(additions.map(({ path, text }) => [path, text])))) return;
    if (creating && uncertain.creating) creating = false;
  }
  const article = snapshot.articles.get(path);
  const previous = snapshot.files.get(path) ?? (article ? { ...article, text: "" } : undefined);
  if (creating ? snapshot.paths.has(path) : !previous) throw new Error(creating ? translate("connection.contentExists") : translate("connection.reloadContent"));
  const blob = text === null ? null : sha((await gh(ctx, "/git/blobs", { method: "POST", body: JSON.stringify({ content: encode(text, path.endsWith("/" + COLLECTION_LEDGER) ? MAX_LEDGER_BYTES : MAX_BYTES), encoding: "base64" }) }))?.sha);
  const mode = previous?.mode ?? "100644";
  const additional = typeof additions === "function" ? additions(blob) : additions;
  for (const change of additional) {
    change.mode = snapshot.files.get(change.path)?.mode ?? snapshot.articles.get(change.path)?.mode ?? "100644";
    change.sha = change.text === null ? undefined : sha((await gh(ctx, "/git/blobs", { method: "POST", body: JSON.stringify({ content: change.text, encoding: "base64" }) }))?.sha);
  }
  const base = sha((await gh(ctx, `/git/commits/${snapshot.head}`))?.tree?.sha);
  const tree = sha((await gh(ctx, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base, tree: [{ path, mode, type: "blob", sha: blob }, ...additional.map(change => ({ path: change.path, mode: change.mode, type: "blob", sha: change.sha ?? null }))] }) }))?.sha);
  const commit = sha((await gh(ctx, "/git/commits", { method: "POST", body: JSON.stringify({ message: `rigel: ${text === null ? "delete" : "save"} ${path}`, tree, parents: [snapshot.head] }) }))?.sha);
  const pending = {sha:blob ?? previous!.sha,text,creating,head:commit,mode,changes:additional};
  snapshot.pending.set(path,pending);
  await verify(pending);
}

export async function saveRemoteSelection(...args: Parameters<typeof saveSelection>): Promise<void> {
  const key = writeKey(args[0]);
  if (publishing.has(key)) throw new Error(translate("connection.waitBeforeSaving"));
  const snapshot = loaded(args[0], args[1]);
  saving.set(key, (saving.get(key) ?? 0) + 1);
  const result = snapshot.writes.then(() => saveSelection(...args));
  snapshot.writes = result.catch(() => {});
  try { await result; } finally { saving.set(key, (saving.get(key) ?? 1) - 1); }
}

async function saveSelection(ctx: GitContext, manifest: Manifest, selection: Selection, values: Record<string, unknown>, body: ArticleBody | "", creating: boolean): Promise<void> {
  const cfg = config(ctx,manifest);
  const snapshot = loaded(ctx,manifest);
  if (!isPlainObject(values)) throw new Error(translate("connection.invalidValues"));
  let path: string;
  let data: unknown;
  if (selection.kind === "page") {
    if (creating || !manifest.pages.some(page => page.slug === selection.slug)) throw new Error(translate("connection.unknownCopyPage"));
    if (!Object.values(values).every(isPlainObject)) throw new Error(translate("connection.invalidCopyGroups"));
    path = filePath(ctx,manifest,cfg.copyDir,selection.slug,"ts");
    const source = await snapshot.read(path);
    if (!source) throw new Error(translate("connection.reloadCopyPage"));
    await mutate(ctx,manifest,path,applyValues(source,values),false); return;
  } else if (selection.kind === "post") {
    const folder = cfg.collections.find(c => c.name === selection.collection)?.folder;
    const collection = manifest.collections?.find(c => c.name === selection.collection);
    if (!folder || !collection) throw new Error(translate("connection.unknownCollection"));
    validateBody(body,translate); validateExtensionBlocks(body, resolveExtensions(extensions).blocks); validateCollectionValues(collection.fields,values,manifest.documents ?? [],translate);
    path = filePath(ctx,manifest,folder,selection.slug,"json",POST_SLUG);
    const frontmatter = { ...values };
    if (Object.hasOwn(frontmatter, "slug")) frontmatter.slug = normalizeUrlSlug(frontmatter.slug, translate);
    const prefix = filePath(ctx,manifest,folder,"placeholder","json",POST_SLUG).replace(/placeholder\.json$/, "");
    await indexRemoteCollections(ctx, manifest, collection.name);
    const state = snapshot.collections.get(collection.name)!;
    const others = [...state.metadata.values()].filter(entry => entry.slug !== selection.slug).map(entry => ({ slug: entry.slug, values: entry.frontmatter }));
    assertUniqueUrlSlugs([...others, { slug: selection.slug, values: frontmatter }], translate);
    data = {frontmatter,body};
  } else if (selection.kind === "document") {
    if (!manifest.schema) throw new Error(translate("connection.missingSchema"));
    const document = validateDocumentId(manifest.schema,selection.id);
    if (!document || document.type.name !== selection.type) throw new Error(translate("connection.unknownDocument"));
    if (creating && (document.type.creatable === false || document.type.singleton)) throw new Error(translate("connection.creationDisabled"));
    const next = {...values,_id:selection.id,_type:selection.type} as Record<string, unknown>;
    if (!document.type.shared && Object.hasOwn(next, "slug")) next.slug = normalizeUrlSlug(next.slug, translate);
    data = next;
    validateDocument(manifest.schema,selection.type,document.slug,data as Record<string,unknown>,manifest.documents ?? [],translate);
    path = filePath(ctx,manifest,document.type.folder,document.slug);
    await indexRemoteDocuments(ctx, manifest, manifest.schema.documents.filter(type => !type.shared || type.name === selection.type).map(type => type.name));
    const documents = manifest.documents!.filter(doc => doc.id !== selection.id);
    validateDocumentSlugs(manifest.schema, [...documents, { id: selection.id, type: selection.type, slug: document.slug, data: next }], manifest.preview, translate);
  } else if (selection.kind === "menu") {
    if (!cfg.menus || creating) throw new Error(translate("connection.menusNotConfigured"));
    data = validateMenu({...values,slug:selection.slug},cfg.menus.maxDepth,translate);
    path = filePath(ctx,manifest,cfg.menus.folder,selection.slug);
  } else throw new Error(translate("connection.selectContent"));
  const additional = selection.kind === "post" ? (blob: string | null) => {
    const state = snapshot.collections.get(selection.collection)!, collection = manifest.collections!.find(c => c.name === selection.collection)!;
    return [{ path: state.ledger, text: encode(serializeCollectionLedger(collection, [...state.metadata.values()].filter(e => e.slug !== selection.slug).concat({ slug: selection.slug, sha: blob!, frontmatter: (data as { frontmatter: Record<string, unknown> }).frontmatter })), MAX_LEDGER_BYTES) }];
  } : selection.kind === "document" ? (blob: string | null) => {
    const state = snapshot.documents.get(selection.type)!, type = manifest.schema!.documents.find(type => type.name === selection.type)!;
    return [{ path: state.ledger, text: encode(serializeCollectionLedger(documentLedgerShape(type, manifest.schema!), [...state.metadata.values()].filter(entry => entry.slug !== selection.id.slice(selection.type.length + 1)).concat({ slug: selection.id.slice(selection.type.length + 1), sha: blob!, frontmatter: documentMetadata(type, data as Record<string, unknown>) })), MAX_LEDGER_BYTES) }];
  } : [];
  await mutate(ctx,manifest,path,serializeContentJson(data,cfg.jsonOutput),creating,additional);
}

function bytesBase64(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function decodeMedia(payload: any, limit: number): Uint8Array<ArrayBuffer> {
  const content = typeof payload?.content === "string" ? payload.content.replace(/[\r\n]/g, "") : "";
  if (payload?.encoding !== "base64" || content.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Error(translate("connection.invalidPayload"));
  const bytes = Uint8Array.from(atob(content), char => char.charCodeAt(0));
  if (bytes.length > limit) throw new Error(translate("connection.contentTooLarge"));
  return bytes;
}

function mediaPaths(ctx: GitContext, manifest: Manifest) {
  const cfg = config(ctx, manifest), folder = safePath(cfg.mediaDir ?? "rigel-media");
  const directory = [cfg.repoRoot, safePath(cfg.publicDir ?? "public"), folder].filter(Boolean).join("/");
  return { folder, directory, ledger: directory + "/.rigel-media.json", prefix: "/" + folder.split("/").map(encodeURIComponent).join("/") + "/" };
}

async function remoteMedia(ctx: GitContext, manifest: Manifest) {
  const snapshot = loaded(ctx, manifest, false), paths = mediaPaths(ctx, manifest);
  const head = await draftHead(ctx, manifest, false), entries = await remoteTree(ctx, head);
  for (const path of entries.keys()) if (path === paths.directory || paths.directory.startsWith(path + "/")) {
    const entry = entries.get(path);
    if (entry.type !== "tree" || entry.mode !== "040000") throw new Error(translate("connection.invalidDirectory"));
  }
  const read = async (path: string, limit = MAX_BYTES) => {
    const entry = entries.get(path);
    if (!entry || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) throw new Error(translate("connection.invalidFile"));
    const blob = await gh(ctx, `/git/blobs/${entry.sha}`);
    if (sha(blob?.sha) !== entry.sha) throw new Error(translate("connection.blobShaMismatch"));
    const bytes = decodeMedia(blob, limit);
    if (await binaryBlobSha(new Blob([bytes])) !== entry.sha) throw new Error(translate("connection.blobShaMismatch"));
    return bytes;
  };
  let record: Record<string, MediaMeta> = {};
  const ledger = entries.get(paths.ledger);
  if (ledger) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await read(paths.ledger));
    const data = parseJson(text);
    if (!isPlainObject(data) || Object.values(data).some(meta => !isPlainObject(meta) || Object.entries(meta).some(([key, value]) => !Object.hasOwn(META_KEYS, key) || typeof value !== "string" || value.length > META_KEYS[key] || /[\u0000-\u001f\u007f]/.test(value)))) throw new Error(translate("connection.invalidRemoteJson"));
    record = data as Record<string, MediaMeta>;
    if (head === snapshot.head) snapshot.files.set(paths.ledger, { sha: ledger.sha, text, mode: ledger.mode });
  }
  const assets: MediaAsset[] = [];
  for (const [path, entry] of entries) {
    if (!path.startsWith(paths.directory + "/") || entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) continue;
    const relative = path.slice(paths.directory.length + 1);
    if (relative.split("/").some(part => part.startsWith(".") || !safePath(part)) || !safeMediaName(relative.split("/").at(-1)!)) continue;
    const parents = path.split("/");
    if (parents.slice(0, -1).some((_, index) => { const parent = entries.get(parents.slice(0, index + 1).join("/")); return parent && (parent.type !== "tree" || parent.mode !== "040000"); })) continue;
    const url = paths.prefix + relative.split("/").map(encodeURIComponent).join("/");
    assets.push({ ...record[url], url, name: record[url]?.name ?? relative, type: mediaMetadata(relative)!.type, ...(Number.isSafeInteger(entry.size) && entry.size >= 0 ? { size: entry.size } : {}) });
  }
  return { ...paths, snapshot, head, entries, record, assets: assets.sort((a, b) => a.name.localeCompare(b.name)), read };
}

type MediaListing = Awaited<ReturnType<typeof remoteMedia>>;
type MediaCache = { session: object; scope: string; persistent?: ReturnType<typeof fileCacheScope>; listing?: Promise<MediaListing>; thumbnails: Map<string, Promise<Blob>>; transforming: number; transformsWaiting: (() => void)[]; blobs: Map<string, Blob>; pending: Map<string, Promise<Blob>>; bytes: number; active: number; waiting: (() => void)[] };
let mediaCaches = new WeakMap<Manifest, MediaCache>();
export function resetRemoteMediaCache() { mediaCaches = new WeakMap(); fileCacheChanged(); }
onFileCacheClear(resetRemoteMediaCache);
function mediaCache(ctx: GitContext, manifest: Manifest) {
  ctx.assertActive?.(); loaded(ctx, manifest, false);
  const session = ctx.mediaSession ?? ctx, scope = JSON.stringify([ctx.token, target(ctx, manifest)]);
  let cache = mediaCaches.get(manifest);
  if (!cache || cache.session !== session || cache.scope !== scope) {
    cache = { session, scope, thumbnails: new Map(), transforming: 0, transformsWaiting: [], blobs: new Map(), pending: new Map(), bytes: 0, active: 0, waiting: [] };
    mediaCaches.set(manifest, cache);
  }
  return cache;
}
function assertMediaCache(ctx: GitContext, manifest: Manifest, cache: MediaCache) {
  ctx.assertActive?.();
  if (mediaCaches.get(manifest) !== cache) throw new Error(translate("connection.reloadDraft"));
}
function mediaListing(ctx: GitContext, manifest: Manifest, cache: MediaCache) {
  if (!cache.listing) {
    const listing = remoteMedia(ctx, manifest).then(media => {
      assertMediaCache(ctx, manifest, cache);
      if (cache.listing !== listing) throw new Error(translate("connection.reloadDraft"));
      return media;
    });
    cache.listing = listing;
    void listing.catch(() => { if (cache.listing === listing) cache.listing = undefined; });
  }
  return cache.listing;
}
export async function listRemoteMedia(ctx: GitContext, manifest: Manifest, refresh = false): Promise<MediaAsset[]> {
  if (refresh) {
    ctx.assertActive?.();
    await clearMediaFileCache();
    const previous = mediaCaches.get(manifest);
    previous?.blobs.clear(); previous?.pending.clear();
    mediaCaches.delete(manifest);
  }
  return (await mediaListing(ctx, manifest, mediaCache(ctx, manifest))).assets;
}

export async function readRemoteMedia(ctx: GitContext, manifest: Manifest, url: string): Promise<Blob> {
  const cache = mediaCache(ctx, manifest), listing = mediaListing(ctx, manifest, cache), media = await listing;
  assertMediaCache(ctx, manifest, cache);
  if (cache.listing !== listing) throw new Error(translate("connection.reloadDraft"));
  if (!safeFileUrl(url) || !media.assets.some(asset => asset.url === url)) throw new Error(translate("local.unknownAsset"));
  const metadata = mediaMetadata(url)!, path = media.directory + "/" + url.slice(media.prefix.length).split("/").map(decodeURIComponent).join("/"), key = media.entries.get(path).sha + ":" + metadata.extension;
  const cached = cache.blobs.get(key);
  if (cached) { cache.blobs.delete(key); cache.blobs.set(key, cached); return cached; }
  const pending = cache.pending.get(key);
  if (pending) return pending;
  const request = (async () => {
    if (cache.active >= 4) await new Promise<void>(resolve => cache.waiting.push(resolve));
    else cache.active++;
    try {
      assertMediaCache(ctx, manifest, cache);
      if (cache.listing !== listing) throw new Error(translate("connection.reloadDraft"));
      const bytes = await media.read(path, manifest.github?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE);
      assertMediaCache(ctx, manifest, cache);
      if (cache.listing !== listing) throw new Error(translate("connection.reloadDraft"));
      if (!bytes.length || !validMediaBytes(bytes, metadata.extension)) throw new Error(translate("local.mediaBytesMismatch"));
      const blob = new Blob([bytes], { type: metadata.type === "text/plain" ? "text/plain; charset=utf-8" : metadata.type });
      if (blob.size <= 32 * 1024 * 1024) {
        while (cache.blobs.size >= 64 || cache.bytes + blob.size > 32 * 1024 * 1024) {
          const oldest = cache.blobs.keys().next().value!;
          cache.bytes -= cache.blobs.get(oldest)!.size; cache.blobs.delete(oldest);
        }
        cache.blobs.set(key, blob); cache.bytes += blob.size; fileCacheChanged();
      }
      return blob;
    } finally { const next = cache.waiting.shift(); if (next) next(); else cache.active--; }
  })();
  cache.pending.set(key, request);
  try { return await request; } finally { if (cache.pending.get(key) === request) cache.pending.delete(key); }
}

export const MEDIA_THUMBNAIL_TRANSFORM = "v1:320x320:contain:webp:0.8";

export async function readRemoteThumbnail(ctx: GitContext, manifest: Manifest, url: string): Promise<Blob> {
  const cache = mediaCache(ctx, manifest), listing = mediaListing(ctx, manifest, cache), media = await listing;
  assertMediaCache(ctx, manifest, cache);
  if (cache.listing !== listing) throw new Error(translate("connection.reloadDraft"));
  if (!safeFileUrl(url) || !media.assets.some(asset => asset.url === url)) throw new Error(translate("local.unknownAsset"));
  if (mediaMetadata(url)?.category !== "Images") return readRemoteMedia(ctx, manifest, url);
  const path = media.directory + "/" + url.slice(media.prefix.length).split("/").map(decodeURIComponent).join("/"), sha = media.entries.get(path).sha;
  const existing = cache.thumbnails.get(sha);
  if (existing) return existing;
  const started = fileCacheRevision();
  const guard = () => { assertMediaCache(ctx, manifest, cache); if (started !== fileCacheRevision() || cache.listing !== listing) throw new Error(translate("connection.reloadDraft")); };
  const request = (async () => {
    const scope = ctx.cacheAccount ? await (cache.persistent ??= fileCacheScope(ctx.cacheAccount, target(ctx, manifest))) : undefined;
    guard();
    const cached = await cachedThumbnail(scope, sha, MEDIA_THUMBNAIL_TRANSFORM);
    guard();
    if (cached) return cached;
    if (cache.transforming >= 4) await new Promise<void>(resolve => cache.transformsWaiting.push(resolve)); else cache.transforming++;
    try {
      guard();
      const original = await readRemoteMedia(ctx, manifest, url);
      guard();
      if (typeof createImageBitmap === "undefined" || typeof document === "undefined") return original;
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(original); } catch { guard(); return original; }
      let thumbnail: Blob | null;
      try {
        const scale = Math.min(1, 320 / bitmap.width, 320 / bitmap.height), canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return original;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        thumbnail = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/webp", 0.8));
      } finally { bitmap.close(); }
      guard();
      if (!thumbnail || thumbnail.type !== "image/webp") return original;
      await cacheThumbnail(scope, sha, MEDIA_THUMBNAIL_TRANSFORM, thumbnail, started);
      guard();
      return thumbnail;
    } finally { const next = cache.transformsWaiting.shift(); if (next) next(); else cache.transforming--; }
  })();
  cache.thumbnails.set(sha, request);
  try { return await request; } finally { if (cache.thumbnails.get(sha) === request) cache.thumbnails.delete(sha); }
}

function queueRemoteWrite<T>(ctx: GitContext, manifest: Manifest, operation: () => Promise<T>): Promise<T> {
  const key = writeKey(ctx);
  if (publishing.has(key)) return Promise.reject(new Error(translate("connection.waitBeforeSaving")));
  const snapshot = loaded(ctx, manifest);
  saving.set(key, (saving.get(key) ?? 0) + 1);
  const result = snapshot.writes.then(async () => {
    const invalidate = () => { const cache = mediaCaches.get(manifest); if (cache) { cache.listing = undefined; cache.pending.clear(); } };
    invalidate();
    try { return await operation(); } finally { invalidate(); }
  });
  snapshot.writes = result.then(() => {}, () => {});
  return result.finally(() => saving.set(key, (saving.get(key) ?? 1) - 1));
}

const mediaUploads = new WeakMap<Blob, string>();
export async function uploadRemoteMedia(ctx: GitContext, manifest: Manifest, file: File, metadata: MediaMeta = {}): Promise<string> {
  const info = mediaMetadata(file.name), limit = manifest.github?.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (!safeMediaName(file.name) || !info || (file.type && file.type !== info.type) || !file.size || file.size > limit) throw new Error(translate("media.chooseSupportedFile", { limit: limit / 1024 / 1024 }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validMediaBytes(bytes, info.extension)) throw new Error(translate("local.mediaBytesMismatch"));
  const filename = mediaUploads.get(file) ?? `${crypto.randomUUID()}.${info.extension === "jpeg" ? "jpg" : info.extension}`;
  mediaUploads.set(file, filename);
  return queueRemoteWrite(ctx, manifest, async () => {
    const media = await remoteMedia(ctx, manifest), url = media.prefix + filename, path = media.directory + "/" + filename;
    if (media.head !== media.snapshot.head && media.head !== media.snapshot.pending.get(media.ledger)?.head) throw new Error(translate("connection.draftConflictUnsaved"));
    const valid = validateMetaUpdate({ url, ...Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "author")) }, new Set([url]), translate);
    if (!valid.ok) throw new Error(valid.error);
    const { url: _, ...patch } = valid.value;
    const author = metadata.author?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
    const record = { ...media.record, [url]: { name: file.name.slice(0, 120), ...patch, ...(author ? { author } : {}) } };
    if (media.entries.has(path) && !media.snapshot.pending.has(media.ledger)) throw new Error(translate("connection.contentExists"));
    await mutate(ctx, manifest, media.ledger, JSON.stringify(record, null, 2), !media.entries.has(media.ledger), [{ path, text: bytesBase64(bytes) }]);
    return url;
  });
}

export function updateRemoteMedia(ctx: GitContext, manifest: Manifest, body: unknown): Promise<void> {
  return queueRemoteWrite(ctx, manifest, async () => {
    const media = await remoteMedia(ctx, manifest);
    const valid = validateMetaUpdate(body, new Set(media.assets.map(asset => asset.url)), translate);
    if (!valid.ok) throw new Error(valid.error);
    const { url, ...patch } = valid.value;
    await mutate(ctx, manifest, media.ledger, JSON.stringify({ ...media.record, [url]: { ...media.record[url], ...patch } }, null, 2), !media.entries.has(media.ledger));
  });
}

export function deleteRemoteMedia(ctx: GitContext, manifest: Manifest, url: string): Promise<void> {
  return queueRemoteWrite(ctx, manifest, async () => {
    const paths = mediaPaths(ctx, manifest), pending = loaded(ctx, manifest).pending.get(paths.ledger);
    if (safeFileUrl(url) && url.startsWith(paths.prefix) && pending?.changes?.some(change => change.text === null && change.path === paths.directory + "/" + url.slice(paths.prefix.length).split("/").map(decodeURIComponent).join("/"))) {
      await mutate(ctx, manifest, paths.ledger, pending.text, pending.creating, pending.changes);
      return;
    }
    const media = await remoteMedia(ctx, manifest);
    if (!safeFileUrl(url) || !media.assets.some(asset => asset.url === url)) throw new Error(translate("local.unknownAsset"));
    const record = { ...media.record }; delete record[url];
    await mutate(ctx, manifest, media.ledger, JSON.stringify(record, null, 2), !media.entries.has(media.ledger), [{ path: media.directory + "/" + url.slice(media.prefix.length).split("/").map(decodeURIComponent).join("/"), text: null }]);
  });
}

export interface PublishFile { filename: string; status: "added" | "modified" | "removed" | "renamed"; previous_filename?: string }
export interface PublishReview {
  repo: string; branch: string; publishBranch: string; head: string; base: string;
  files: PublishFile[]; needsSync: boolean; prNumber?: number; creationUncertain?: boolean;
}

async function publishHeads(ctx: GitContext, publishBranch: string, request: typeof gh) {
  const head = sha((await request(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha);
  const base = sha((await request(ctx, `/git/ref/heads/${encodeURIComponent(publishBranch)}`))?.object?.sha);
  return { head, base };
}

async function publishTree(ctx: GitContext, head: string, request: typeof gh) {
  const data = await request(ctx, `/git/trees/${head}?recursive=1`);
  if (data?.truncated !== false || !Array.isArray(data.tree)) throw new Error(translate("connection.incompletePublishTree"));
  const files = new Map<string, string>();
  const paths = new Set<string>();
  for (const entry of data.tree) {
    if (!entry || typeof entry.path !== "string" || !entry.path || /[\u0000-\u001f\u007f\\\\]/.test(entry.path) || entry.path.split("/").some((p: string) => !p || p === "." || p === "..") || paths.has(entry.path) || !["blob", "tree", "commit"].includes(entry.type) || !["100644", "100755", "120000", "040000", "160000"].includes(entry.mode)) throw new Error(translate("connection.malformedPublishTree"));
    if (!({ blob: ["100644", "100755", "120000"], tree: ["040000"], commit: ["160000"] } as Record<string, string[]>)[entry.type]?.includes(entry.mode)) throw new Error(translate("connection.malformedPublishTreeMode"));
    paths.add(entry.path);
    const id = sha(entry.sha);
    if (entry.type !== "tree") files.set(entry.path, `${entry.mode}:${entry.type}:${id}`);
  }
  return files;
}

export async function reviewRemotePublish(ctx: GitContext, manifest: Manifest, assertActive: () => void = () => {}): Promise<PublishReview> {
  const cfg = config(ctx, manifest);
  const request: typeof gh = (context, path, init) => { assertActive(); return gh(context, path, init); };
  const repository = await request(ctx, "");
  if (repository?.permissions?.push !== true) throw new Error(translate("connection.publishWriteRequired"));
  if (repository.allow_squash_merge !== true) throw new Error(translate("connection.squashDisabled"));
  if (repository.delete_branch_on_merge !== false) throw new Error(translate("connection.automaticDeletionEnabled"));
  const { head, base } = await publishHeads(ctx, cfg.publishBranch, request);
  const [source, destination] = await Promise.all([publishTree(ctx, head, request), publishTree(ctx, base, request)]);
  const changed = new Set([...source.keys(), ...destination.keys()].filter(path => source.get(path) !== destination.get(path)));
  const review: PublishReview = { repo: ctx.repo, branch: ctx.branch, publishBranch: cfg.publishBranch, head, base, files: [], needsSync: false };
  if (changed.size) {
    const comparison = await request(ctx, `/compare/${base}...${head}?per_page=1&page=1`);
    if (sha(comparison?.base_commit?.sha) !== base) throw new Error(translate("connection.comparisonTargetMismatch"));
    review.needsSync = sha(comparison?.merge_base_commit?.sha) !== base;
    if (review.needsSync) {
      review.files = [...changed].sort().map(filename => ({ filename, status: !source.has(filename) ? "removed" : !destination.has(filename) ? "added" : "modified" }));
    } else {
      if (!Array.isArray(comparison.files) || comparison.files.length >= 300) throw new Error(translate("connection.comparisonLimit"));
      const covered = new Set<string>();
      for (const file of comparison.files) {
        if (!file || typeof file.filename !== "string" || covered.has(file.filename) || !changed.has(file.filename) || !["added", "removed", "modified", "renamed"].includes(file.status)) throw new Error(translate("connection.unsupportedComparison"));
        covered.add(file.filename);
        if (file.status === "renamed") {
          if (typeof file.previous_filename !== "string" || !changed.has(file.previous_filename) || covered.has(file.previous_filename)) throw new Error(translate("connection.incompleteRename"));
          covered.add(file.previous_filename);
        }
        review.files.push({ filename: file.filename, status: file.status, ...(file.status === "renamed" ? { previous_filename: file.previous_filename } : {}) });
      }
      if (covered.size !== changed.size) throw new Error(translate("connection.incompleteComparison"));
    }
    if (review.files.length >= 300) throw new Error(translate("connection.publishFileLimit"));
  }
  const current = await publishHeads(ctx, cfg.publishBranch, request);
  if (current.head !== head || current.base !== base) throw new PublishReviewChangedError(translate("connection.branchesChangedDuringReview"));
  assertActive();
  return review;
}

const publishing = new Set<string>();
const saving = new Map<string, number>();
const writeKey = (ctx: GitContext) => `${ctx.repo}:${ctx.branch}`;

export async function confirmRemotePublish(ctx: GitContext, manifest: Manifest, review: PublishReview, assertActive: () => void = () => {}): Promise<"published" | "synced"> {
  const cfg = config(ctx, manifest), key = writeKey(ctx);
  if (publishing.has(key) || saving.get(key)) throw new Error(translate("connection.waitForWrite"));
  if (review.repo !== ctx.repo || review.branch !== ctx.branch || review.publishBranch !== cfg.publishBranch || !review.files.length) throw new Error(translate("connection.reviewFirst"));
  sha(review.head); sha(review.base);
  publishing.add(key);
  const request: typeof gh = (context, path, init) => { assertActive(); return gh(context, path, init); };
  const unchanged = async () => {
    const current = await publishHeads(ctx, cfg.publishBranch, request);
    if (current.head !== review.head || current.base !== review.base) throw new PublishReviewChangedError(translate("connection.branchesChanged"));
  };
  const matches = (pr: any) => pr?.head?.repo?.full_name?.toLowerCase() === ctx.repo.toLowerCase() && pr?.base?.repo?.full_name?.toLowerCase() === ctx.repo.toLowerCase() && pr.head.ref === ctx.branch && pr.base.ref === cfg.publishBranch;
  const validate = (pr: any) => {
    if (!matches(pr) || !Number.isSafeInteger(pr.number) || pr.number <= 0 || pr.head.sha !== review.head) throw new PublishReviewChangedError(translate("connection.pullRequestMismatch"));
    return pr;
  };
  const merged = (pr: any) => {
    validate(pr);
    if (pr.merged === true && pr.state === "closed") { sha(pr.merge_commit_sha); return true; }
    return false;
  };
  const find = async () => {
    const found: any[] = [];
    for (let page = 1; page <= 100; page++) {
      const query = new URLSearchParams({ state: "open", head: `${ctx.repo.split("/")[0]}:${ctx.branch}`, base: cfg.publishBranch, per_page: "100", page: String(page) });
      const list = await request(ctx, `/pulls?${query}`);
      if (!Array.isArray(list)) throw new Error(translate("connection.incompletePullRequests"));
      found.push(...list.filter(matches));
      if (found.length > 1) throw new Error(translate("connection.multiplePullRequests"));
      if (list.length < 100) return found[0];
    }
    throw new Error(translate("connection.pullRequestListingStopped"));
  };
  try {
    if (review.prNumber) {
      const previous = await request(ctx, `/pulls/${review.prNumber}`);
      if (merged(previous)) return "published";
    }
    await unchanged();
    const repository = await request(ctx, "");
    if (repository?.permissions?.push !== true || repository.allow_squash_merge !== true || repository.delete_branch_on_merge !== false) throw new PublishReviewChangedError(translate("connection.publishSettingsChanged"));
    let pr = review.prNumber ? await request(ctx, `/pulls/${review.prNumber}`) : await find();
    if (!pr) {
      if (review.creationUncertain) throw new Error(translate("connection.pullRequestCreationUnconfirmed"));
      await unchanged();
      review.creationUncertain = true;
      try {
        pr = await request(ctx, "/pulls", { method: "POST", body: JSON.stringify({ title: `Publish ${ctx.branch} to ${cfg.publishBranch}`, head: ctx.branch, base: cfg.publishBranch, draft: false, maintainer_can_modify: false }) });
      } catch (error) {
        pr = await find();
        if (!pr) throw error;
      }
    }
    validate(pr);
    review.prNumber = pr.number;
    pr = validate(await request(ctx, `/pulls/${pr.number}`));
    if (merged(pr)) return "published";
    if (pr.state !== "open" || pr.draft || pr.base.sha !== review.base) throw new PublishReviewChangedError(translate("connection.pullRequestTargetChanged"));
    if (review.needsSync) {
      await unchanged();
      await request(ctx, `/pulls/${pr.number}/update-branch`, { method: "PUT", body: JSON.stringify({ expected_head_sha: review.head }) });
      const updated = await request(ctx, `/pulls/${pr.number}`);
      if (!matches(updated) || updated.state !== "open" || sha(updated.head.sha) === review.head) throw new Error(translate("connection.syncUnverified"));
      return "synced";
    }
    if (pr.mergeable !== true || pr.mergeable_state !== "clean") throw new Error(translate("connection.mergeBlocked"));
    await unchanged();
    let failure: unknown;
    try {
      const result = await request(ctx, `/pulls/${pr.number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: review.head }) });
      if (result?.merged !== true) failure = new Error(translate("connection.mergeFailed"));
    } catch (error) { failure = error; }
    let verified;
    try { verified = await request(ctx, `/pulls/${pr.number}`); }
    catch (error) {
      if (error instanceof GitError && error.status === 401) throw error;
      throw new Error(translate("connection.publishOutcomeUnconfirmed", { number: pr.number }));
    }
    if (merged(verified)) return "published";
    if (failure) throw failure;
    throw new Error(translate("connection.publishUnverified"));
  } catch (error) {
    if (error instanceof GitError && [403, 404].includes(error.status)) throw new GitError(translate("connection.publishPermissions"), error.status);
    if (error instanceof GitError && [405, 409, 422].includes(error.status)) throw new GitError(translate("connection.publishRejected"), error.status);
    throw error;
  } finally { publishing.delete(key); }
}

export async function deleteRemoteDocument(ctx: GitContext, manifest: Manifest, id: string): Promise<void> {
  const key = writeKey(ctx);
  if (publishing.has(key)) throw new Error(translate("connection.waitBeforeDeleting"));
  const snapshot = loaded(ctx, manifest);
  const result = snapshot.writes.then(async () => {
    if (!manifest.schema) throw new Error(translate("connection.missingSchema"));
    const target = validateDocumentId(manifest.schema, id);
    if (!target) throw new Error(translate("connection.unknownDocument"));
    if (isProtectedDocument(target.type, target.slug)) throw new Error(translate("local.pageProtected"));
    await indexRemoteDocuments(ctx, manifest, manifest.schema.documents.map(type => type.name));
    const documents = manifest.documents!;
    assertDocumentUnreferenced(manifest.schema, documents, id, translate);
    const remaining = documents.filter(doc => doc.id !== id);
    await indexRemoteCollections(ctx, manifest);
    for (const collection of manifest.collections ?? []) {
      for (const entry of snapshot.collections.get(collection.name)!.metadata.values()) {
        const values = entry.frontmatter;
        validateCollectionValues(collection.fields, values, documents, translate);
        try { validateCollectionValues(collection.fields, values, remaining, translate); }
        catch { throw new Error(translate("local.documentReferenced")); }
      }
    }
    const state = snapshot.documents.get(target.type.name)!;
    await mutate(ctx, manifest, filePath(ctx, manifest, target.type.folder, target.slug), null, false, () => [{ path: state.ledger, text: encode(serializeCollectionLedger(documentLedgerShape(target.type, manifest.schema!), [...state.metadata.values()].filter(entry => entry.slug !== target.slug)), MAX_LEDGER_BYTES) }]);
  });
  snapshot.writes = result.catch(() => {});
  saving.set(key, (saving.get(key) ?? 0) + 1);
  try { await result; } finally { saving.set(key, (saving.get(key) ?? 1) - 1); }
}

export async function deleteRemotePost(ctx: GitContext, manifest: Manifest, collection: string, slug: string): Promise<void> {
  return queueRemoteWrite(ctx, manifest, async () => {
    const cfg = config(ctx,manifest);
    const folder = cfg.collections.find(c => c.name === collection)?.folder;
    if (!folder || !manifest.collections?.some(c => c.name === collection)) throw new Error(translate("connection.unknownCollection"));
    const path = filePath(ctx,manifest,folder,slug,"json",POST_SLUG);
    await indexRemoteCollections(ctx, manifest, collection);
    const state = loaded(ctx, manifest).collections.get(collection)!, definition = manifest.collections!.find(c => c.name === collection)!;
    await mutate(ctx,manifest,path,null,false, () => [{ path: state.ledger, text: encode(serializeCollectionLedger(definition, [...state.metadata.values()].filter(e => e.slug !== slug)), MAX_LEDGER_BYTES) }]);
  });
}
