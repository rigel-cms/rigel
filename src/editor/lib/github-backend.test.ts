import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Manifest } from "../../manifest/types";
import { emptyBody } from "../../article-body";
import { readValues } from "../../routes/serialize";
import { loadManifestRemote, saveRemoteSelection, deleteRemotePost } from "./github-backend";

const ctx = { token: "secret-token", repo: "owner/site", branch: "drafts" };
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
  const put = (path: string, text: string) => { const sha = id(); blobs.set(sha, text); files.set(path, { sha, text }); };
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
      return tree ? json({ truncated: state.truncated, tree: [...tree].map(([path, file]) => ({ path, sha: file.sha, type: "blob", mode: file.mode ?? "100644" })) }) : json({}, 404);
    }
    if (path.startsWith("/git/blobs/")) { const sha = path.slice(11), text = blobs.get(sha); return text !== undefined ? json({ sha, encoding: "base64", content: state.malformed ? "%%%" : Buffer.from(text).toString("base64") }) : json({}, 404); }
    if (path.startsWith("/git/commits/")) { const commit = commits.get(path.slice(13)); return commit ? json({ tree: { sha: commit.tree }, parents: commit.parents.map(sha => ({ sha })) }) : json({}, 404); }
    if (path === "/git/blobs" && method === "POST") { const sha = id(); blobs.set(sha, Buffer.from(body.content, "base64").toString("utf8")); return json({ sha }, 201); }
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

test.each([undefined, "pretty", "minified"] as const)("GitHub saves use %s JSON for posts, documents and menus only", async (jsonOutput) => {
  const s = server(), original = blueprint();
  original.github!.jsonOutput = jsonOutput;
  const before = new Map(s.files);
  const m = await loadManifestRemote(ctx, original);
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
  const reloaded = await loadManifestRemote(ctx, original);
  expect(reloaded.collections![0].posts[0]).toEqual({ slug: "hello", frontmatter, body });
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
  const m = await loadManifestRemote(ctx, original);
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
  const m = await loadManifestRemote(ctx, original);
  const post = { title: "Spanish", slug: "Árbol y NIÑO!", author: "author:alex", custom: { keep: true } };
  await saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, post, emptyBody(), false);
  const reloaded = await loadManifestRemote(ctx, original);
  expect(reloaded.collections![0].posts[0]).toMatchObject({ slug: "hello", frontmatter: { ...post, slug: "arbol-y-nino" } });
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "arbol-y-nino" }, emptyBody(), true)).rejects.toThrow(/already used/);
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "!!!" }, emptyBody(), true)).rejects.toThrow(/slug/);
  await saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "legacy" }, { title: "Legacy" }, emptyBody(), true);
  expect(JSON.parse(s.files.get("playground/src/content/blog/legacy.json")!.text).frontmatter).not.toHaveProperty("slug");
  await expect(saveRemoteSelection(ctx, reloaded, { kind: "post", collection: "blog", slug: "other" }, { slug: "legacy" }, emptyBody(), true)).rejects.toThrow(/already used/);
  const doc = { name: "Álex", slug: "Página española", custom: { keep: true } };
  await saveRemoteSelection(ctx, reloaded, { kind: "document", type: "author", id: "author:alex" }, doc, "", false);
  const after = await loadManifestRemote(ctx, original);
  expect(after.documents![0]).toMatchObject({ id: "author:alex", slug: "alex", data: { ...doc, slug: "pagina-espanola", _id: "author:alex" } });
  expect([...s.files.keys()].filter(path => path.includes("authors/"))).toEqual(["playground/src/content/authors/alex.json"]);
});

test("remote read and save boundaries reject explicit-versus-legacy URL collisions", async () => {
  const s = server();
  const postPath = "playground/src/content/blog/other.json";
  s.put(postPath, JSON.stringify({ frontmatter: { title: "Other", slug: "hello" }, body: emptyBody() }));
  await expect(loadManifestRemote(ctx, blueprint())).rejects.toThrow(/already used/);
  s.files.delete(postPath);
  const docPath = "playground/src/content/authors/other.json";
  s.put(docPath, JSON.stringify({ name: "Other", slug: "alex" }));
  await expect(loadManifestRemote(ctx, blueprint())).rejects.toThrow(/already used/);
  s.put(docPath, JSON.stringify({ name: "Other" }));
  const m = await loadManifestRemote(ctx, blueprint());
  await expect(saveRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }, { name: "Spanish", slug: "other" }, "", false)).rejects.toThrow(/already used/);
  for (const slug of ["", "!!!", null]) await expect(saveRemoteSelection(ctx, m, { kind: "document", type: "author", id: "author:alex" }, { name: "Spanish", slug }, "", false)).rejects.toThrow(/slug/);
  s.put(postPath, JSON.stringify({ frontmatter: { slug: "BAD URL" }, body: emptyBody() }));
  await expect(loadManifestRemote(ctx, blueprint())).rejects.toThrow(/slug/);
});

test("remote saves reject URL claims added to another file since loading", async () => {
  const s = server();
  const m = await loadManifestRemote(ctx, blueprint());
  s.put("playground/src/content/blog/other.json", JSON.stringify({ frontmatter: { title: "Other", slug: "claimed" }, body: emptyBody() }));
  s.head = "b".repeat(40);
  await expect(saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug: "hello" }, { title: "Draft", slug: "claimed" }, emptyBody(), false)).rejects.toThrow(/reload/);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test("concurrent remote drafts cannot claim the same effective URL slug", async () => {
  const s = server();
  const m = await loadManifestRemote(ctx, blueprint());
  const results = await Promise.allSettled(["one", "two"].map(slug => saveRemoteSelection(ctx, m, { kind: "post", collection: "blog", slug }, { title: "Race", slug: "shared-url" }, emptyBody(), true)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(s.calls.filter(call => call.method === "PATCH")).toHaveLength(1);
});

test("independent remote editors atomically compete for a URL slug on different filenames", async () => {
  const s = server();
  const one = await loadManifestRemote(ctx, blueprint());
  const two = await loadManifestRemote(ctx, blueprint());
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
  const reloaded = await loadManifestRemote(ctx, blueprint());
  expect(reloaded.collections![0].posts.filter(post => post.frontmatter.slug === "shared-url")).toHaveLength(1);
  expect(s.calls.filter(call => call.method === "PATCH")).toHaveLength(2);
  expect(s.calls.filter(call => call.method === "PATCH").every(call => call.body.force === false)).toBe(true);
});

test("remote collection loads validate present types without filling optional omissions", async () => {
  const s = server();
  const original = blueprint();
  original.collections![0].fields.push({ key: "description", label: "Description", type: "text" });
  const manifest = await loadManifestRemote(ctx, original);
  expect(Object.hasOwn(manifest.collections![0].posts[0].frontmatter, "description")).toBe(false);
  s.put("playground/src/content/blog/hello.json", JSON.stringify({ frontmatter: { description: false }, body: emptyBody() }));
  await expect(loadManifestRemote(ctx, original)).rejects.toThrow(/Description/);
  expect(s.calls.every(call => call.method === "GET")).toBe(true);
});

test("loads real draft content and CAS saves all kinds with Unicode without touching main", async()=>{
  const s=server();const original=blueprint();const m=await loadManifestRemote(ctx,original);
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
  const reloaded=await loadManifestRemote(ctx,original);
  expect(reloaded.documents?.[0].data.name).toBe("Zoë");
  expect(reloaded.collections?.[0].posts[0].frontmatter.title).toBe("世界");
  expect(s.calls.filter(c=>c.method==="PATCH").every(c=>c.path === "/git/refs/heads/drafts" && c.body.force === false)).toBe(true);
  expect(s.calls.some(c=>c.method === "PUT" || c.method === "DELETE")).toBe(false);
});

test.each([false,true])("creates absent drafts from publish head without forcing, including race=%s",async race=>{
  const s=server();s.exists=false;s.race=race;
  await loadManifestRemote(ctx,blueprint());
  expect(s.calls.filter(c=>c.method!=="GET")).toEqual([{path:"/git/refs",method:"POST",body:{ref:"refs/heads/drafts",sha:"b".repeat(40)}}]);
  expect(s.calls.filter(c=>c.path==="/git/ref/heads/drafts").length).toBe(2);
});

test("existing branch is never reset or recreated",async()=>{
  const s=server();await loadManifestRemote(ctx,blueprint());
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
  expect(s.calls.some(c=>c.path==="/git/ref/heads/main")).toBe(false);
});

test("content requests bypass persistent caches and time out without forwarding cookies",async()=>{
  server();
  await loadManifestRemote(ctx,blueprint());
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init).toMatchObject({ cache: "no-store", credentials: "omit", redirect: "error", signal: expect.any(AbortSignal) });
});

test("loaded CAS state survives a reactive manifest proxy without leaking into JSON",async()=>{
  server();const m=await loadManifestRemote(ctx,blueprint());
  const proxy=new Proxy(m,{});
  await saveRemoteSelection(ctx,proxy,{kind:"document",type:"author",id:"author:alex"},{name:"Proxy"},"",false);
  expect(JSON.stringify(m)).not.toMatch(/secret-token|\"files\"|\"paths\"/);
});

test("CAS keeps loaded SHA and refuses collisions for updates, deletes and creates",async()=>{
  const s=server();const m=await loadManifestRemote(ctx,blueprint());
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
  const s=server(); const m=await loadManifestRemote(ctx,blueprint());
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
  const m = await loadManifestRemote(ctx, originalManifest);
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
  const s=server(); const m=await loadManifestRemote(ctx,blueprint());
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
  const s=server(); const m=await loadManifestRemote(ctx,blueprint());
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
  const error=await loadManifestRemote(ctx,blueprint()).catch(e=>e);
  expect(error).toBeInstanceOf(Error);expect(error.message).toContain(String(status));
  expect(error.message).not.toMatch(/secret-token|raw body/);
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
});

test("truncated trees and malformed blobs fail closed",async()=>{
  const s=server();s.truncated=true;
  await expect(loadManifestRemote(ctx,blueprint())).rejects.toThrow(/Incomplete/);
  expect(s.calls.some(c=>c.path.startsWith("/git/blobs/"))).toBe(false);
  s.truncated=false;s.malformed=true;
  await expect(loadManifestRemote(ctx,blueprint())).rejects.toThrow(/payload/);
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
  await expect(loadManifestRemote(ctx,blueprint())).rejects.toThrow(/tree/);
});

test.each(["../outside","/absolute","src//copy","src/./copy","src/%2e%2e/copy","src\\copy"])("rejects unsafe configured path %s without HTTP",async folder=>{
  const s=server();const m=blueprint();m.github!.copyDir=folder;
  await expect(loadManifestRemote(ctx,m)).rejects.toThrow(/path/);
  expect(s.calls).toEqual([]);
});

test("mutations reject publish branch, retargeted manifests, unknown selections and unsafe filenames",async()=>{
  const s=server();const m=await loadManifestRemote(ctx,blueprint());const before=s.calls.length;
  for(const slug of ["../oops","/oops","nested/path","x%2fy"]) await expect(deleteRemotePost(ctx,m,"blog",slug)).rejects.toThrow(/filename/);
  await expect(saveRemoteSelection({...ctx,branch:"main"},m,{kind:"page",slug:"contact"},{},"",false)).rejects.toThrow(/drafts/);
  await expect(saveRemoteSelection(ctx,m,{kind:"collection",name:"blog"},{},"",false)).rejects.toThrow(/editable/);
  await expect(deleteRemotePost(ctx,blueprint(),"blog","hello")).rejects.toThrow(/Reload/);
  m.github!.repoRoot="other";
  await expect(deleteRemotePost(ctx,m,"blog","hello")).rejects.toThrow(/Reload/);
  expect(s.calls.length).toBe(before);
});

test("validation parity rejects broken references, bodies, menus and documents",async()=>{
  const s=server();const m=await loadManifestRemote(ctx,blueprint());const before=s.calls.length;
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
  const error=await loadManifestRemote(ctx,blueprint()).catch(e=>e);
  expect(error.message).not.toMatch(/secret-token|raw body/);
  expect(error.message).toBe("Invalid remote content JSON");
});

test("loads valid large UTF-8 documents below the local 1 MiB limit",async()=>{
  const s=server();const name="é".repeat(100000);
  s.put("playground/src/content/authors/alex.json",JSON.stringify({name}));
  const m=await loadManifestRemote(ctx,blueprint());
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
  await expect(loadManifestRemote(ctx,blueprint())).rejects.toThrow(/directory/);
  expect(s.calls.every(c=>c.method==="GET")).toBe(true);
});