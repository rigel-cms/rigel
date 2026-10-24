import type { Manifest } from "../../manifest/types";
import { serializeContentJson } from "../../json-output";
import type { Selection } from "../../manifest/navigation";
import { validateBody, type ArticleBody } from "../../article-body";
import { validateMenu } from "../../manifest/menu";
import { validateCollectionValues } from "../../manifest/collections";
import { documentIndex, isPlainObject, validateDocument, validateDocumentId, validateSchema } from "../../schema/validate";
import { applyValues, readValues } from "../../routes/serialize";
import { assertUniqueUrlSlugs, normalizeUrlSlug, validateDocumentSlugs } from "../../slugs";

export interface GitContext { token: string; repo: string; branch: string }

type FileSnapshot = { sha: string; text: string; mode: string };
type PendingWrite = { sha: string; text: string | null; creating: boolean; head: string; mode: string };
type Snapshot = { target: string; head: string; writes: Promise<void>; files: Map<string, FileSnapshot>; paths: Set<string>; pending: Map<string, PendingWrite> };
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

export async function loadManifestRemote(ctx: GitContext, blueprint: Manifest, createDraft = true): Promise<Manifest> {
  const cfg = config(ctx, blueprint);
  const head = await draftHead(ctx, blueprint, createDraft);
  const tree = await gh(ctx, `/git/trees/${head}?recursive=1`);
  if (!tree || tree.truncated !== false || !Array.isArray(tree.tree)) throw new Error("Incomplete GitHub tree; content cannot be loaded safely");
  const manifest = structuredClone(blueprint);
  const snapshot: Snapshot = {target:target(ctx,manifest),head,writes:Promise.resolve(),files:new Map(),paths:new Set(),pending:new Map()};
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
    const text = decode(blob); snapshot.files.set(path,{sha:expected,text,mode:entry.mode}); return text;
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
  if (manifest.schema) validateDocumentSlugs(manifest.schema, manifest.documents, manifest.preview);
  for (const collection of manifest.collections ?? []) {
    const folder = cfg.collections.find(c => c.name === collection.name)?.folder;
    if (!folder) throw new Error("Missing configured GitHub collection");
    collection.posts = [];
    for (const file of list(folder,POST_SLUG)) {
      const post = parseJson(await read(file.path));
      if (!isPlainObject(post) || !isPlainObject(post.frontmatter)) throw new Error("Invalid remote article");
      validateBody(post.body); validateCollectionValues(collection.fields,post.frontmatter,manifest.documents);
      collection.posts.push({slug:file.slug,frontmatter:post.frontmatter,body:post.body});
    }
    assertUniqueUrlSlugs(collection.posts.map(post => ({ slug: post.slug, values: post.frontmatter })));
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
  const head = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha);
  const uncertain = snapshot.pending.get(path);
  if (head !== snapshot.head && head !== uncertain?.head) throw new Error("GitHub draft branch conflict; reload before saving. Your unsaved edits are still here.");
  const endpoint = `/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  const verify = async (pending: PendingWrite) => {
    const current = sha((await gh(ctx, `/git/ref/heads/${encodeURIComponent(ctx.branch)}`))?.object?.sha);
    if (current !== pending.head) {
      if (current !== snapshot.head) throw new Error("GitHub draft branch conflict; reload before saving.");
      const result = await gh(ctx, `/git/refs/heads/${encodeURIComponent(ctx.branch)}`, { method: "PATCH", body: JSON.stringify({ sha: pending.head, force: false }) });
      if (sha(result?.object?.sha) !== pending.head) throw new Error("GitHub branch update could not be verified; retry or reload.");
    }
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
      snapshot.files.set(path,{sha:pending.sha,text:pending.text,mode:pending.mode}); snapshot.paths.add(path);
    }
    snapshot.head = pending.head;
    snapshot.pending.delete(path);
  };
  if (uncertain) {
    await verify(uncertain);
    if (uncertain.text === text && (!creating || uncertain.creating)) return;
    if (creating && uncertain.creating) creating = false;
  }
  const previous = snapshot.files.get(path);
  if (creating ? snapshot.paths.has(path) : !previous) throw new Error(creating ? "Content already exists; choose another slug" : "Reload this content before changing it");
  const blob = text === null ? null : sha((await gh(ctx, "/git/blobs", { method: "POST", body: JSON.stringify({ content: encode(text), encoding: "base64" }) }))?.sha);
  const mode = previous?.mode ?? "100644";
  const base = sha((await gh(ctx, `/git/commits/${snapshot.head}`))?.tree?.sha);
  const tree = sha((await gh(ctx, "/git/trees", { method: "POST", body: JSON.stringify({ base_tree: base, tree: [{ path, mode, type: "blob", sha: blob }] }) }))?.sha);
  const commit = sha((await gh(ctx, "/git/commits", { method: "POST", body: JSON.stringify({ message: `rigel: ${text === null ? "delete" : "save"} ${path}`, tree, parents: [snapshot.head] }) }))?.sha);
  const pending = {sha:blob ?? previous!.sha,text,creating,head:commit,mode};
  snapshot.pending.set(path,pending);
  await verify(pending);
}

export async function saveRemoteSelection(...args: Parameters<typeof saveSelection>): Promise<void> {
  const key = writeKey(args[0]);
  if (publishing.has(key)) throw new Error("Wait for publishing to finish before saving.");
  const snapshot = loaded(args[0], args[1]);
  saving.set(key, (saving.get(key) ?? 0) + 1);
  const result = snapshot.writes.then(() => saveSelection(...args));
  snapshot.writes = result.catch(() => {});
  try { await result; } finally { saving.set(key, (saving.get(key) ?? 1) - 1); }
}

async function saveSelection(ctx: GitContext, manifest: Manifest, selection: Selection, values: Record<string, unknown>, body: ArticleBody | "", creating: boolean): Promise<void> {
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
    validateBody(body); validateCollectionValues(collection.fields,values,manifest.documents ?? []);
    path = filePath(ctx,manifest,folder,selection.slug,"json",POST_SLUG);
    const frontmatter = { ...values };
    if (Object.hasOwn(frontmatter, "slug")) frontmatter.slug = normalizeUrlSlug(frontmatter.slug);
    const prefix = filePath(ctx,manifest,folder,"placeholder","json",POST_SLUG).replace(/placeholder\.json$/, "");
    const others = [...snapshot.files].filter(([file]) => file.startsWith(prefix) && file !== path && file.endsWith(".json")).map(([file, value]) => ({ slug: file.slice(prefix.length, -5), values: (parseJson(value.text) as { frontmatter: Record<string, unknown> }).frontmatter }));
    assertUniqueUrlSlugs([...others, { slug: selection.slug, values: frontmatter }]);
    data = {frontmatter,body};
  } else if (selection.kind === "document") {
    if (!manifest.schema) throw new Error("No document schema configured");
    const document = validateDocumentId(manifest.schema,selection.id);
    if (!document || document.type.name !== selection.type) throw new Error("Unknown document type or slug");
    if (creating && (document.type.creatable === false || document.type.singleton)) throw new Error("Creating entries is disabled for this document type");
    const next = {...values,_id:selection.id,_type:selection.type} as Record<string, unknown>;
    if (!document.type.shared && Object.hasOwn(next, "slug")) next.slug = normalizeUrlSlug(next.slug);
    data = next;
    validateDocument(manifest.schema,selection.type,document.slug,data as Record<string,unknown>,manifest.documents ?? []);
    path = filePath(ctx,manifest,document.type.folder,document.slug);
    const documents = manifest.schema.documents.flatMap(type => {
      const prefix = filePath(ctx,manifest,type.folder,"placeholder").replace(/placeholder\.json$/, "");
      return [...snapshot.files].filter(([file]) => file.startsWith(prefix) && file !== path && file.endsWith(".json")).map(([file, value]) => ({ id: `${type.name}:${file.slice(prefix.length,-5)}`, type: type.name, slug: file.slice(prefix.length,-5), data: parseJson(value.text) as Record<string, unknown> }));
    });
    validateDocumentSlugs(manifest.schema, [...documents, { id: selection.id, type: selection.type, slug: document.slug, data: next }], manifest.preview);
  } else if (selection.kind === "menu") {
    if (!cfg.menus || creating) throw new Error("Menus must be configured by the site developer");
    data = validateMenu({...values,slug:selection.slug},cfg.menus.maxDepth);
    path = filePath(ctx,manifest,cfg.menus.folder,selection.slug);
  } else throw new Error("Select editable content before saving");
  await mutate(ctx,manifest,path,serializeContentJson(data,cfg.jsonOutput),creating);
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
  if (data?.truncated !== false || !Array.isArray(data.tree)) throw new Error("Incomplete GitHub tree. Publishing is unavailable; review this change on GitHub.");
  const files = new Map<string, string>();
  const paths = new Set<string>();
  for (const entry of data.tree) {
    if (!entry || typeof entry.path !== "string" || !entry.path || /[\u0000-\u001f\u007f\\\\]/.test(entry.path) || entry.path.split("/").some((p: string) => !p || p === "." || p === "..") || paths.has(entry.path) || !["blob", "tree", "commit"].includes(entry.type) || !["100644", "100755", "120000", "040000", "160000"].includes(entry.mode)) throw new Error("Malformed GitHub publish tree");
    if (!({ blob: ["100644", "100755", "120000"], tree: ["040000"], commit: ["160000"] } as Record<string, string[]>)[entry.type]?.includes(entry.mode)) throw new Error("Malformed GitHub publish tree mode");
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
  if (repository?.permissions?.push !== true) throw new Error("Publishing requires repository write access.");
  if (repository.allow_squash_merge !== true) throw new Error("Squash merging is disabled. Ask the repository owner to enable it before publishing.");
  if (repository.delete_branch_on_merge !== false) throw new Error("Ask the repository owner to disable automatic head-branch deletion before publishing, so the drafts branch is preserved.");
  const { head, base } = await publishHeads(ctx, cfg.publishBranch, request);
  const [source, destination] = await Promise.all([publishTree(ctx, head, request), publishTree(ctx, base, request)]);
  const changed = new Set([...source.keys(), ...destination.keys()].filter(path => source.get(path) !== destination.get(path)));
  const review: PublishReview = { repo: ctx.repo, branch: ctx.branch, publishBranch: cfg.publishBranch, head, base, files: [], needsSync: false };
  if (changed.size) {
    const comparison = await request(ctx, `/compare/${base}...${head}?per_page=1&page=1`);
    if (sha(comparison?.base_commit?.sha) !== base) throw new Error("GitHub comparison does not match the reviewed target.");
    review.needsSync = sha(comparison?.merge_base_commit?.sha) !== base;
    if (review.needsSync) {
      review.files = [...changed].sort().map(filename => ({ filename, status: !source.has(filename) ? "removed" : !destination.has(filename) ? "added" : "modified" }));
    } else {
      if (!Array.isArray(comparison.files) || comparison.files.length >= 300) throw new Error("GitHub comparisons of 300 or more files are not supported. Publish this change on GitHub; no partial list is shown.");
      const covered = new Set<string>();
      for (const file of comparison.files) {
        if (!file || typeof file.filename !== "string" || covered.has(file.filename) || !changed.has(file.filename) || !["added", "removed", "modified", "renamed"].includes(file.status)) throw new Error("Incomplete or unsupported GitHub file comparison. Publish this change on GitHub.");
        covered.add(file.filename);
        if (file.status === "renamed") {
          if (typeof file.previous_filename !== "string" || !changed.has(file.previous_filename) || covered.has(file.previous_filename)) throw new Error("Incomplete GitHub rename comparison");
          covered.add(file.previous_filename);
        }
        review.files.push({ filename: file.filename, status: file.status, ...(file.status === "renamed" ? { previous_filename: file.previous_filename } : {}) });
      }
      if (covered.size !== changed.size) throw new Error("Incomplete GitHub file comparison. Publishing is unavailable; no partial list is shown.");
    }
    if (review.files.length >= 300) throw new Error("Publishing 300 or more files is not supported. Review and publish this change on GitHub.");
  }
  const current = await publishHeads(ctx, cfg.publishBranch, request);
  if (current.head !== head || current.base !== base) throw new Error("Branches changed during review. Review changes again before publishing.");
  assertActive();
  return review;
}

const publishing = new Set<string>();
const saving = new Map<string, number>();
const writeKey = (ctx: GitContext) => `${ctx.repo}:${ctx.branch}`;

export async function confirmRemotePublish(ctx: GitContext, manifest: Manifest, review: PublishReview, assertActive: () => void = () => {}): Promise<"published" | "synced"> {
  const cfg = config(ctx, manifest), key = writeKey(ctx);
  if (publishing.has(key) || saving.get(key)) throw new Error("Wait for the current save or publish to finish.");
  if (review.repo !== ctx.repo || review.branch !== ctx.branch || review.publishBranch !== cfg.publishBranch || !review.files.length) throw new Error("Review saved changes before publishing.");
  sha(review.head); sha(review.base);
  publishing.add(key);
  const request: typeof gh = (context, path, init) => { assertActive(); return gh(context, path, init); };
  const unchanged = async () => {
    const current = await publishHeads(ctx, cfg.publishBranch, request);
    if (current.head !== review.head || current.base !== review.base) throw new Error("Branches changed. Review changes again before publishing.");
  };
  const matches = (pr: any) => pr?.head?.repo?.full_name?.toLowerCase() === ctx.repo.toLowerCase() && pr?.base?.repo?.full_name?.toLowerCase() === ctx.repo.toLowerCase() && pr.head.ref === ctx.branch && pr.base.ref === cfg.publishBranch;
  const validate = (pr: any) => {
    if (!matches(pr) || !Number.isSafeInteger(pr.number) || pr.number <= 0 || pr.head.sha !== review.head) throw new Error("Pull request no longer matches this review. Review changes again.");
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
      if (!Array.isArray(list)) throw new Error("Incomplete GitHub pull request listing");
      found.push(...list.filter(matches));
      if (found.length > 1) throw new Error("Multiple matching pull requests. Resolve them on GitHub before publishing.");
      if (list.length < 100) return found[0];
    }
    throw new Error("Incomplete GitHub pull request listing; publishing stopped.");
  };
  try {
    if (review.prNumber) {
      const previous = await request(ctx, `/pulls/${review.prNumber}`);
      if (merged(previous)) return "published";
    }
    await unchanged();
    const repository = await request(ctx, "");
    if (repository?.permissions?.push !== true || repository.allow_squash_merge !== true || repository.delete_branch_on_merge !== false) throw new Error("Publishing settings or access changed. Enable squash merges, disable automatic branch deletion and verify write access, then review again.");
    let pr = review.prNumber ? await request(ctx, `/pulls/${review.prNumber}`) : await find();
    if (!pr) {
      if (review.creationUncertain) throw new Error("The previous pull request creation is unconfirmed. Check GitHub before retrying; no duplicate was created.");
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
    if (pr.state !== "open" || pr.draft || pr.base.sha !== review.base) throw new Error("Pull request or target changed. Review changes again before publishing.");
    if (review.needsSync) {
      await unchanged();
      await request(ctx, `/pulls/${pr.number}/update-branch`, { method: "PUT", body: JSON.stringify({ expected_head_sha: review.head }) });
      const updated = await request(ctx, `/pulls/${pr.number}`);
      if (!matches(updated) || updated.state !== "open" || sha(updated.head.sha) === review.head) throw new Error("GitHub is still syncing drafts, or the sync could not be verified. Wait, reload draft content and review again. Nothing was published.");
      return "synced";
    }
    if (pr.mergeable !== true || pr.mergeable_state !== "clean") throw new Error("GitHub has not allowed this merge. Resolve conflicts, required checks, reviews or branch protections on GitHub, then retry. No protection is bypassed.");
    await unchanged();
    let failure: unknown;
    try {
      const result = await request(ctx, `/pulls/${pr.number}/merge`, { method: "PUT", body: JSON.stringify({ merge_method: "squash", sha: review.head }) });
      if (result?.merged !== true) failure = new Error("GitHub did not merge the pull request. Check required checks, reviews and branch protections, then retry.");
    } catch (error) { failure = error; }
    let verified;
    try { verified = await request(ctx, `/pulls/${pr.number}`); }
    catch (error) {
      if (error instanceof GitError && error.status === 401) throw error;
      throw new Error(`Publish outcome is unconfirmed. Check pull request #${pr.number} on GitHub, or retry to verify it before starting another publish.`);
    }
    if (merged(verified)) return "published";
    if (failure) throw failure;
    throw new Error("The publish result could not be verified. Check this pull request on GitHub before retrying.");
  } catch (error) {
    if (error instanceof GitError && [403, 404].includes(error.status)) throw new GitError("Publishing requires GitHub App Contents and Pull requests read/write permissions, installation-owner approval and repository write access. Reconnect after approval. Branch protections still apply.", error.status);
    if (error instanceof GitError && [405, 409, 422].includes(error.status)) throw new GitError("GitHub rejected publishing. Check conflicts, required checks/reviews, branch protections and squash settings. Review changes again if either branch moved.", error.status);
    throw error;
  } finally { publishing.delete(key); }
}

export async function deleteRemotePost(ctx: GitContext, manifest: Manifest, collection: string, slug: string): Promise<void> {
  const key = writeKey(ctx);
  if (publishing.has(key)) throw new Error("Wait for publishing to finish before deleting.");
  const cfg = config(ctx,manifest);
  const folder = cfg.collections.find(c => c.name === collection)?.folder;
  if (!folder || !manifest.collections?.some(c => c.name === collection)) throw new Error("Unknown collection");
  saving.set(key, (saving.get(key) ?? 0) + 1);
  try { await mutate(ctx,manifest,filePath(ctx,manifest,folder,slug,"json",POST_SLUG),null,false); }
  finally { saving.set(key, (saving.get(key) ?? 1) - 1); }
}
