import type { Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import { validateBody, type ArticleBody } from "../../article-body";
import { validateMenu } from "../../manifest/menu";
import { validateCollectionReferences } from "../../manifest/references";
import { documentIndex, isPlainObject, validateDocument, validateDocumentId, validateSchema } from "../../schema/validate";
import { applyValues, readValues } from "../../routes/serialize";

export interface GitContext { token: string; repo: string; branch: string }

type FileSnapshot = { sha: string; text: string };
type PendingWrite = { sha: string; text: string | null; creating: boolean };
type Snapshot = { target: string; files: Map<string, FileSnapshot>; paths: Set<string>; pending: Map<string, PendingWrite> };
const REMOTE_SNAPSHOT = Symbol("rigel-remote-snapshot");
const SHA = /^[a-f0-9]{40}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POST_SLUG = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_BYTES = 1024 * 1024;

class GitError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

function safePath(path: string, empty = false): string {
  if (typeof path !== "string" || (!path && !empty) || (path && !path.split("/").every(part => /^[A-Za-z0-9_-][A-Za-z0-9_. -]*$/.test(part)))) throw new Error("Unsafe GitHub content path");
  return path;
}

function branch(name: string): string {
  if (typeof name !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(name) || name.includes("..") || name.includes("//") || name.endsWith("/") || name.endsWith(".") || name.split("/").some(part => part.startsWith(".") || part.endsWith(".lock"))) throw new Error("Invalid GitHub branch");
  return name;
}

function config(ctx: GitContext, manifest: Manifest) {
  const cfg = manifest.github;
  if (!cfg || !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(ctx.repo) || ctx.repo !== cfg.repo || !ctx.token.trim()) throw new Error("Connect the configured GitHub repository first");
  branch(ctx.branch); branch(cfg.publishBranch);
  if (ctx.branch !== (cfg.branch || "drafts") || ctx.branch === cfg.publishBranch || ctx.branch === "main" || ctx.branch === "master") throw new Error("GitHub content changes require a dedicated drafts branch, never the publishing branch");
  safePath(cfg.repoRoot, true); safePath(cfg.copyDir);
  const folders = [cfg.copyDir, ...cfg.collections.map(c => c.folder), ...manifest.schema?.documents.map(d => d.folder) ?? [], ...(cfg.menus ? [cfg.menus.folder] : [])];
  folders.forEach(folder => safePath(folder));
  if (folders.some((folder, index) => folders.some((other, j) => j !== index && (folder === other || folder.startsWith(other + "/"))))) throw new Error("GitHub content directories must not overlap");
  if (manifest.schema) validateSchema(manifest.schema);
  return cfg;
}

function target(ctx: GitContext, manifest: Manifest) { return JSON.stringify([ctx.repo, ctx.branch, manifest.github, manifest.schema]); }
function filePath(ctx: GitContext, manifest: Manifest, folder: string, slug: string, extension = "json", pattern = SLUG) {
  const cfg = config(ctx, manifest);
  if (!pattern.test(slug)) throw new Error("Invalid content filename");
  return [cfg.repoRoot, safePath(folder), `${slug}.${extension}`].filter(Boolean).join("/");
}

async function gh(ctx: GitContext, path: string, init: RequestInit = {}): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${ctx.repo}${path}`, {
      ...init, headers: {Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28", "Content-Type":"application/json"}, redirect:"error", cache:"no-store", credentials:"omit", signal:AbortSignal.timeout(15000),
    });
  } catch { throw new Error("GitHub request failed; check your connection and reconnect"); }
  if (!response.ok) {
    const rateLimited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
    const action = rateLimited ? "GitHub rate limit reached; wait before retrying" : ({401:"GitHub session expired; reconnect",403:"GitHub access denied; check repository installation permissions",404:"GitHub repository, branch or file unavailable; check access and reload",409:"GitHub content conflict; reload before saving",422:"GitHub rejected this change; the path or branch may already exist; reload"} as Record<number,string>)[response.status] ?? "GitHub request failed; retry after checking repository access";
    throw new GitError(`${action} (${response.status})`, response.status);
  }
  try { return await response.json(); } catch { throw new Error("Malformed GitHub API response"); }
}

function sha(value: unknown): string {
  if (typeof value !== "string" || !SHA.test(value)) throw new Error("Malformed GitHub SHA");
  return value;
}

async function draftHead(ctx: GitContext, manifest: Manifest): Promise<string> {
  const cfg = config(ctx, manifest);
  const ref = `/git/ref/heads/${encodeURIComponent(ctx.branch)}`;
  try { return sha((await gh(ctx, ref))?.object?.sha); }
  catch (error) { if (!(error instanceof GitError) || error.status !== 404) throw error; }
  const base = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(cfg.publishBranch)}`))?.object?.sha);
  try { await gh(ctx, "/git/refs", {method:"POST", body:JSON.stringify({ref:`refs/heads/${ctx.branch}`,sha:base})}); }
  catch (error) { if (!(error instanceof GitError) || ![409,422].includes(error.status)) throw error; }
  return sha((await gh(ctx, ref))?.object?.sha);
}

function decode(payload: any): string {
  if (!payload || payload.encoding !== "base64" || typeof payload.content !== "string") throw new Error("Malformed GitHub content payload");
  const base64 = payload.content.replace(/[\r\n]/g, "");
  if (base64.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error("Invalid or oversized GitHub content payload");
  try {
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    if (bytes.length > MAX_BYTES) throw new Error();
    return new TextDecoder("utf-8", {fatal:true}).decode(bytes);
  } catch { throw new Error("Invalid UTF-8 GitHub content payload"); }
}

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_BYTES) throw new Error("Content exceeds the 1 MiB limit");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error("Invalid remote content JSON"); }
}

export async function loadManifestRemote(ctx: GitContext, blueprint: Manifest): Promise<Manifest> {
  const cfg = config(ctx, blueprint);
  const head = await draftHead(ctx, blueprint);
  const tree = await gh(ctx, `/git/trees/${head}?recursive=1`);
  if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error("Incomplete GitHub tree; content cannot be loaded safely");
  const manifest = structuredClone(blueprint);
  const snapshot: Snapshot = {target:target(ctx,manifest),files:new Map(),paths:new Set(),pending:new Map()};
  const entries = new Map<string, any>();
  for (const entry of tree.tree) {
    if (!entry || typeof entry.path !== "string" || entry.path.split("/").some((part: string) => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(entry.path) || !["blob","tree","commit"].includes(entry.type) || !SHA.test(entry.sha) || !["100644","100755","120000","040000","160000"].includes(entry.mode)) throw new Error("Malformed GitHub tree entry");
    if (entries.has(entry.path)) throw new Error("Duplicate GitHub tree path");
    entries.set(entry.path, entry); snapshot.paths.add(entry.path);
  }
  const folders = [cfg.copyDir, ...cfg.collections.map(c => c.folder), ...(manifest.schema?.documents.map(d => d.folder) ?? []), ...(cfg.menus ? [cfg.menus.folder] : [])];
  for (const folder of folders) {
    const parts = [cfg.repoRoot,folder].filter(Boolean).join("/").split("/");
    for (let count = 1; count <= parts.length; count++) {
      const entry = entries.get(parts.slice(0,count).join("/"));
      if (entry && (entry.type !== "tree" || entry.mode !== "040000")) throw new Error("Content directory must be a real GitHub directory");
    }
  }
  const read = async (path: string): Promise<string> => {
    const entry = entries.get(path);
    if (!entry || entry.type !== "blob" || !["100644","100755"].includes(entry.mode)) throw new Error("Content must be an existing regular GitHub file");
    const expected = sha(entry.sha);
    const blob = await gh(ctx, `/git/blobs/${expected}`);
    if (sha(blob?.sha) !== expected) throw new Error("GitHub blob SHA mismatch");
    const text = decode(blob); snapshot.files.set(path,{sha:expected,text}); return text;
  };
  const list = (folder: string, pattern = SLUG) => {
    const prefix = [cfg.repoRoot,folder].filter(Boolean).join("/") + "/";
    return [...entries.keys()].filter(path => path.startsWith(prefix) && !path.slice(prefix.length).includes("/") && path.endsWith(".json")).sort().map(path => {
      const slug = path.slice(prefix.length,-5);
      if (!pattern.test(slug)) throw new Error("Invalid remote content filename");
      return {path,slug};
    });
  };
  for (const page of manifest.pages) {
    const path = filePath(ctx,manifest,cfg.copyDir,page.slug,"ts");
    const values = readValues(await read(path));
    if (!Object.values(values).every(isPlainObject)) throw new Error("Copy groups must contain value objects");
    page.values = values as typeof page.values;
  }
  manifest.documents = [];
  for (const type of manifest.schema?.documents ?? []) for (const file of list(type.folder)) {
    const data = parseJson(await read(file.path));
    if (!isPlainObject(data)) throw new Error("Remote document must be an object");
    manifest.documents.push({id:`${type.name}:${file.slug}`,type:type.name,slug:file.slug,data});
  }
  documentIndex(manifest.documents);
  for (const doc of manifest.documents) validateDocument(manifest.schema!,doc.type,doc.slug,doc.data,manifest.documents);
  for (const collection of manifest.collections ?? []) {
    const folder = cfg.collections.find(c => c.name === collection.name)?.folder;
    if (!folder) throw new Error("Missing configured GitHub collection");
    collection.posts = [];
    for (const file of list(folder,POST_SLUG)) {
      const post = parseJson(await read(file.path));
      if (!isPlainObject(post) || !isPlainObject(post.frontmatter)) throw new Error("Invalid remote article");
      validateBody(post.body); validateCollectionReferences(collection.fields,post.frontmatter,manifest.documents);
      collection.posts.push({slug:file.slug,frontmatter:post.frontmatter,body:post.body});
    }
  }
  if (cfg.menus) {
    manifest.menus = {maxDepth:cfg.menus.maxDepth,entries:[]};
    for (const file of list(cfg.menus.folder)) {
      const menu = validateMenu(parseJson(await read(file.path)),cfg.menus.maxDepth);
      if (menu.slug !== file.slug) throw new Error("Remote menu slug does not match filename");
      manifest.menus.entries.push(menu);
    }
  }
  Object.defineProperty(manifest,REMOTE_SNAPSHOT,{value:snapshot});
  return manifest;
}

function loaded(ctx: GitContext, manifest: Manifest): Snapshot {
  config(ctx,manifest);
  const snapshot = (manifest as Manifest & { [REMOTE_SNAPSHOT]?: Snapshot })[REMOTE_SNAPSHOT];
  if (!snapshot || snapshot.target !== target(ctx,manifest)) throw new Error("Reload draft content before saving to this repository");
  return snapshot;
}

async function mutate(ctx: GitContext, manifest: Manifest, path: string, text: string | null, creating: boolean) {
  const snapshot = loaded(ctx,manifest);
  const endpoint = `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const verify = async (pending: PendingWrite) => {
    let verified;
    try { verified = await gh(ctx,`${endpoint}?ref=${encodeURIComponent(ctx.branch)}`); }
    catch (error) {
      if (pending.text !== null || !(error instanceof GitError) || error.status !== 404) throw error;
    }
    if (pending.text === null) {
      if (verified !== undefined) throw new Error("GitHub deletion could not be verified; reload");
      snapshot.files.delete(path); snapshot.paths.delete(path);
    } else {
      if (verified?.type !== "file" || sha(verified.sha) !== pending.sha || decode(verified) !== pending.text) throw new Error("GitHub save changed before verification; reload");
      snapshot.files.set(path,{sha:pending.sha,text:pending.text}); snapshot.paths.add(path);
    }
    snapshot.pending.delete(path);
  };
  const uncertain = snapshot.pending.get(path);
  if (uncertain) {
    await verify(uncertain);
    if (uncertain.text === text && (!creating || uncertain.creating)) return;
    if (creating && uncertain.creating) creating = false;
  }
  const previous = snapshot.files.get(path);
  if (creating ? snapshot.paths.has(path) : !previous) throw new Error(creating ? "Content already exists; choose another slug" : "Reload this content before changing it");
  const payload = {message:`rigel: ${text === null ? "delete" : "save"} ${path}`,branch:ctx.branch,...(!creating ? {sha:previous!.sha} : {}),...(text === null ? {} : {content:encode(text)})};
  const result = await gh(ctx,endpoint,{method:text === null ? "DELETE" : "PUT",body:JSON.stringify(payload)});
  const pending = {sha:text === null ? previous!.sha : sha(result?.content?.sha),text,creating};
  snapshot.pending.set(path,pending);
  await verify(pending);
}

export async function saveRemoteSelection(ctx: GitContext, manifest: Manifest, selection: Selection, values: Record<string, unknown>, body: ArticleBody | "", creating: boolean): Promise<void> {
  const cfg = config(ctx,manifest);
  const snapshot = loaded(ctx,manifest);
  if (!isPlainObject(values)) throw new Error("Content values must be an object");
  let path: string;
  let data: unknown;
  if (selection.kind === "page") {
    if (creating || !manifest.pages.some(page => page.slug === selection.slug)) throw new Error("Unknown copy page");
    if (!Object.values(values).every(isPlainObject)) throw new Error("Copy groups must contain value objects");
    path = filePath(ctx,manifest,cfg.copyDir,selection.slug,"ts");
    const source = snapshot.files.get(path)?.text;
    if (!source) throw new Error("Reload the copy page before saving");
    await mutate(ctx,manifest,path,applyValues(source,values),false); return;
  } else if (selection.kind === "post") {
    const folder = cfg.collections.find(c => c.name === selection.collection)?.folder;
    const collection = manifest.collections?.find(c => c.name === selection.collection);
    if (!folder || !collection) throw new Error("Unknown collection");
    validateBody(body); validateCollectionReferences(collection.fields,values,manifest.documents ?? []);
    path = filePath(ctx,manifest,folder,selection.slug,"json",POST_SLUG);
    data = {frontmatter:{...values,slug:selection.slug},body};
  } else if (selection.kind === "document") {
    if (!manifest.schema) throw new Error("No document schema configured");
    const document = validateDocumentId(manifest.schema,selection.id);
    if (!document || document.type.name !== selection.type) throw new Error("Unknown document type or slug");
    if (creating && (document.type.creatable === false || document.type.singleton)) throw new Error("Creating entries is disabled for this document type");
    data = {...values,_id:selection.id,_type:selection.type,slug:document.slug};
    validateDocument(manifest.schema,selection.type,document.slug,data as Record<string,unknown>,manifest.documents ?? []);
    path = filePath(ctx,manifest,document.type.folder,document.slug);
  } else if (selection.kind === "menu") {
    if (!cfg.menus || creating) throw new Error("Menus must be configured by the site developer");
    data = validateMenu({...values,slug:selection.slug},cfg.menus.maxDepth);
    path = filePath(ctx,manifest,cfg.menus.folder,selection.slug);
  } else throw new Error("Select editable content before saving");
  await mutate(ctx,manifest,path,JSON.stringify(data,null,2) + "\n",creating);
}

export async function deleteRemotePost(ctx: GitContext, manifest: Manifest, collection: string, slug: string): Promise<void> {
  const cfg = config(ctx,manifest);
  const folder = cfg.collections.find(c => c.name === collection)?.folder;
  if (!folder || !manifest.collections?.some(c => c.name === collection)) throw new Error("Unknown collection");
  await mutate(ctx,manifest,filePath(ctx,manifest,folder,slug,"json",POST_SLUG),null,false);
}