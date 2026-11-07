import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

const url = process.env.RIGEL_URL || "http://127.0.0.1:4322/rigel/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "Run against a local fixture host only");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=", "base64");
const video = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAANcbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAHgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAod0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAHgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAB4AAAEAAABAAAAAAH/bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAABgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABqm1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAWpzdGJsAAAAvnN0c2QAAAAAAAAAAQAAAK5hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANGF2Y0MBZAAK/+EAF2dkAAqs2V7ARAAAAwAEAAADAMg8SJZYAQAGaOvjyyLA/fj4AAAAABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAL7iAAAAAAAAABhzdHRzAAAAAAAAAAEAAAADAAACAAAAABRzdHNzAAAAAAAAAAEAAAABAAAAKGN0dHMAAAAAAAAAAwAAAAEAAAQAAAAAAQAABgAAAAABAAACAAAAABxzdHNjAAAAAAAAAAEAAAABAAAAAwAAAAEAAAAgc3RzegAAAAAAAAAAAAAAAwAAAsUAAAAMAAAADAAAABRzdGNvAAAAAAAAAAEAAAOMAAAAYXVkdGEAAABZbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAbWRpcmFwcGwAAAAAAAAAAAAAAAAsaWxzdAAAACSpdG9vAAAAHGRhdGEAAAABAAAAAExhdmY2My4xLjEwMgAAAAhmcmVlAAAC5W1kYXQAAAKuBgX//6rcRem95tlIt5Ys2CDZI+7veDI2NCAtIGNvcmUgMTY1IHIzMjIyIGIzNTYwNWEgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAPZYiEADP//vbsvgU2FMjBAAAACEGaImxCv/7AAAAACAGeQXkK/8SB", "base64");
const emptyBody = { root: { type: "root", version: 1, children: [], direction: null, format: "", indent: 0 } };
const manifest = {
  backend: "github", pages: [{ slug: "copy", label: "Copy", shared: true, groups: [{ id: "content", label: "Content", fields: [{ key: "body", type: "markdown", label: "Rich copy" }] }], values: {} }], documents: [],
  preview: { collections: { blog: { url: "/blog/{slug}/", template: "/preview/blog/" } } },
  github: { repo: "fixture-owner/fixture-site", branch: "drafts", publishBranch: "main", repoRoot: "site", publicDir: "static", mediaDir: "uploads/media", maxFileSize: 2097152, authOrigin: "https://auth.fixture.test", appSlug: "rigel-cms", copyDir: "src/copy", collections: [{ name: "blog", folder: "src/blog" }] },
  schema: { objects: [], documents: [{ name: "mediaTest", type: "document", shared: true, title: "Media fields", folder: "src/fields", fields: [{ key: "title", type: "string", label: "Title" }, { key: "image", type: "image", label: "Image" }, { key: "file", type: "file", label: "Attachment", accept: ".txt" }] }] },
  collections: [{ name: "blog", label: "Blogs", fields: [{ key: "title", type: "string", label: "Title" }, { key: "cover", type: "image", label: "Cover" }], posts: [] }],
};
let sequence = 0, writes = 0;
const id = () => (++sequence).toString(16).padStart(40, "0");
const blobs = new Map(), trees = new Map(), commits = new Map();
const files = new Map();
const put = (path, bytes) => { const sha = id(); blobs.set(sha, Buffer.from(bytes)); files.set(path, sha); };
put("site/src/fields/entry.json", JSON.stringify({ title: "Media fields", image: "", file: "" }));
put("site/src/blog/article.json", JSON.stringify({ frontmatter: { title: "Article", cover: "" }, body: emptyBody }));
put("site/src/copy/copy.ts", 'import { defineCopy } from "@rigel-cms/rigel/content";\nexport default defineCopy({slug:"copy",label:"Copy",shared:true,groups:[],values:{content:{body:"Copy"}}});');
let tree = id(); trees.set(tree, new Map(files));
let head = id(); commits.set(head, { tree, parents: [] });
const requests = [], errors = [];
const api = (path, method, body) => {
  requests.push({ path, method, body });
  if (method === "OPTIONS") return [204, null];
  if (path === "/user") return [200, { login: "fixture-user", name: "Fixture user", avatar_url: "https://avatars.githubusercontent.com/u/1", html_url: "https://github.com/fixture-user" }];
  const repository = { id: 42, full_name: manifest.github.repo, name: "fixture-site", default_branch: "main", owner: { login: "fixture-owner" }, permissions: { push: true, pull: true }, archived: false, disabled: false };
  if (path.startsWith("/user/installations?")) return [200, { total_count: 1, installations: [{ id: 7, app_slug: "rigel-cms", account: { login: "fixture-owner", type: "User" }, permissions: { contents: "write" }, suspended_at: null, html_url: "https://github.com/settings/installations/7" }] }];
  if (path.startsWith("/user/installations/7/repositories?")) return [200, { total_count: 1, repositories: [repository] }];
  const prefix = `/repos/${manifest.github.repo}`;
  if (path === prefix) return [200, repository];
  path = decodeURIComponent(path.slice(prefix.length));
  if (path === "/git/ref/heads/drafts") return [200, { object: { sha: head } }];
  if (path.startsWith("/git/trees/")) {
    const key = path.slice(11).split("?")[0], entries = trees.get(commits.get(key)?.tree ?? key);
    assert.ok(entries);
    return [200, { truncated: false, tree: [...entries].map(([path, sha]) => ({ path, sha, type: "blob", mode: "100644", size: blobs.get(sha).length })) }];
  }
  if (path.startsWith("/git/blobs/")) { const sha = path.slice(11); assert.ok(blobs.has(sha)); return [200, { sha, encoding: "base64", content: blobs.get(sha).toString("base64") }]; }
  if (path.startsWith("/git/commits/")) { const commit = commits.get(path.slice(13)); assert.ok(commit); return [200, { tree: { sha: commit.tree } }]; }
  if (path === "/git/blobs" && method === "POST") { const sha = id(); blobs.set(sha, Buffer.from(body.content, "base64")); return [201, { sha }]; }
  if (path === "/git/trees" && method === "POST") {
    assert.equal(body.base_tree, commits.get(head).tree);
    const next = new Map(trees.get(body.base_tree));
    for (const entry of body.tree) { assert.ok(entry.path.startsWith("site/")); if (entry.sha === null) next.delete(entry.path); else { assert.ok(blobs.has(entry.sha)); next.set(entry.path, entry.sha); } }
    const sha = id(); trees.set(sha, next); return [201, { sha }];
  }
  if (path === "/git/commits" && method === "POST") { assert.deepEqual(body.parents, [head]); const sha = id(); commits.set(sha, body); return [201, { sha }]; }
  if (path === "/git/refs/heads/drafts" && method === "PATCH") {
    assert.equal(body.force, false); assert.deepEqual(commits.get(body.sha).parents, [head]);
    head = body.sha; files.clear(); for (const entry of trees.get(commits.get(head).tree)) files.set(...entry); writes++; return [200, { object: { sha: head } }];
  }
  if (path.startsWith("/contents/")) { const file = path.slice(10).split("?")[0], sha = files.get(file); return sha ? [200, { type: "file", sha, encoding: "base64", content: blobs.get(sha).toString("base64") }] : [404, {}]; }
  throw new Error(`Unexpected ${method} ${path}`);
};
await mkdir("_temp", { recursive: true });
const profile = await mkdtemp(`${process.cwd()}/_temp/github-media-browser-`);
const chrome = spawn(process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not start")), 10000);
    chrome.once("error", reject);
    chrome.stderr.on("data", chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint); await once(socket, "open");
  let sequence = 0; const pending = new Map();
  socket.addEventListener("message", ({ data }) => { const result = JSON.parse(data), request = pending.get(result.id); if (!request) return; pending.delete(result.id); result.error ? request.reject(new Error(result.error.message)) : request.resolve(result.result); });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15000); pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  socket.addEventListener("message", ({ data }) => {
    const event = JSON.parse(data); if (event.sessionId !== sessionId) return;
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
    if (event.method === "Fetch.requestPaused") void (async () => {
      const { requestId, request } = event.params, target = new URL(request.url);
      assert.ok(!request.url.includes("ghu_fixture"));
      if (target.hostname !== "api.github.com") assert.ok(!Object.entries(request.headers).some(([key, value]) => key.toLowerCase() === "authorization" && value.includes("ghu_fixture")), "No GitHub token outside GitHub");
      let status = 200, result;
      if (target.pathname === "/rigel/manifest.json") result = manifest;
      else if (target.hostname === "api.github.com") [status, result] = api(target.pathname + target.search, request.method, request.postData ? JSON.parse(request.postData) : undefined);
      else if (target.pathname.startsWith("/rigel/api/local/")) throw new Error("Repository media called a local persistence API");
      else if (target.hostname === "images.fixture.test") { await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "image/png" }, { name: "Access-Control-Allow-Origin", value: "*" }], body: png.toString("base64") }); return; }
      else { await cdp("Fetch.continueRequest", { requestId }); return; }
      await cdp("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type,Accept,X-GitHub-Api-Version" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,OPTIONS" }], body: Buffer.from(result === null ? "" : JSON.stringify(result)).toString("base64") });
    })().catch(error => { if (!error.message.includes("Invalid InterceptionId")) errors.push(error.message); void cdp("Fetch.failRequest", { requestId: event.params.requestId, errorReason: "Failed" }).catch(() => {}); });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `
    if (window === top) {
    localStorage.setItem('rigelcms.settings', JSON.stringify({userPref:{editorExperience:'sidebar'}}));
    localStorage.setItem('rigelcms.session', JSON.stringify({version:1,scope:${JSON.stringify(JSON.stringify([manifest.github.authOrigin, manifest.github.repo, "drafts", "rigel-cms"]))},accessToken:'ghu_fixture_media',expiresAt:Date.now()+3600000}));
    window.createdMediaURLs=[]; window.revokedMediaURLs=[];
    const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);createdMediaURLs.push(url);return url};
    URL.revokeObjectURL=url=>{revokedMediaURLs.push(url);revoke(url)};
    window.alert=window.confirm=window.prompt=()=>{throw Error('Native dialogs forbidden')};
    }
  ` });
  const evaluate = async expression => { const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out ${expression}\n${JSON.stringify(errors)}\n${await evaluate("document.body.innerText.slice(-2500)")}`); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = text => evaluate(`[...document.querySelectorAll('button')].find(el=>el.getBoundingClientRect().width && el.textContent.trim()===${JSON.stringify(text)}).click()`);
  const field = (selector, value) => evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const chooseFile = async (name, type, bytes) => {
    await waitFor("!!document.querySelector('dialog[open] input[type=file]')");
    await evaluate(`(()=>{const input=document.querySelector('dialog[open] input[type=file]'), transfer=new DataTransfer();transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0))],${JSON.stringify(name)},{type:${JSON.stringify(type)}}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await waitFor("!!document.querySelector('dialog[open] .media-selection')");
  };
  const ledger = () => JSON.parse(blobs.get(files.get("site/static/uploads/media/.rigel-media.json")));
  await cdp("Page.navigate", { url });
  await waitFor("!!document.querySelector('#rigel-sidebar')");
  await button("Media"); await waitFor("document.querySelector('.media-library')?.textContent.includes('No media')");
  assert.equal(writes, 0);
  await button("Upload"); await chooseFile("Private.png", "image/png", png);
  assert.equal(writes, 0, "Choosing a file needs explicit confirmation");
  await field('[aria-label="Image alt text"]', "Private image");
  await click("dialog[open] .media-actions .primary");
  await waitFor("!document.querySelector('dialog[open]') && !!document.querySelector('.media-library img[src^=blob]')");
  const imageUrl = Object.keys(ledger())[0];
  assert.match(imageUrl, /^\/uploads\/media\/[a-f0-9-]+\.png$/);
  assert.equal(writes, 1);
  assert.deepEqual(blobs.get(files.get("site/static" + imageUrl)), png, "Binary bytes survive upload and readback");
  const atomic = requests.find(request => request.path.endsWith("/git/trees") && request.method === "POST");
  assert.deepEqual(atomic.body.tree.map(entry => entry.path).sort(), ["site/static" + imageUrl, "site/static/uploads/media/.rigel-media.json"].sort());
  await waitFor("document.querySelector('.media-library img').naturalWidth === 1");
  await click(".media-library .thumb");
  await waitFor("document.querySelector('dialog[open] .media-preview img')?.naturalWidth === 1");
  await waitFor("document.querySelector('dialog[open] a[download]')?.href.startsWith('blob:')");
  assert.equal(await evaluate("document.querySelector('dialog[open] .media-path').textContent"), imageUrl);
  await field('[aria-label="Media title"]', "Updated private title");
  await button("Save"); await waitFor("document.querySelector('dialog[open]').textContent.includes('Metadata saved')");
  assert.equal(ledger()[imageUrl].title, "Updated private title");
  const beforeClose = await evaluate("revokedMediaURLs.length");
  await click("dialog[open] .media-head .close");
  await waitFor(`revokedMediaURLs.length > ${beforeClose}`);
  await button("Upload"); await chooseFile("notes.txt", "text/plain", Buffer.from("Private attachment"));
  await click("dialog[open] .media-actions .primary");
  await waitFor("!document.querySelector('dialog[open]') && document.querySelectorAll('.media-library .thumb').length===2");
  const fileUrl = Object.keys(ledger()).find(url => url.endsWith(".txt"));
  await button("Media fields"); await waitFor("!!document.querySelector('main .table-link')"); await click("main .table-link");
  await waitFor("!!document.querySelector('.document-form')");
  await button("Choose…"); await waitFor("!!document.querySelector('dialog[open] .thumb')"); await click("dialog[open] .thumb"); await click("dialog[open] .media-actions .primary");
  await waitFor("document.querySelector('.image-field img')?.naturalWidth===1");
  assert.equal(writes, 3, "Image selection leaves the document unsaved");
  await button("Save"); await waitFor("document.querySelector('.save-status')?.textContent.trim()==='Saved'");
  assert.equal(JSON.parse(blobs.get(files.get("site/src/fields/entry.json"))).image, imageUrl);
  await evaluate("document.querySelectorAll('.image-field button')[2].click()");
  await waitFor("!!document.querySelector('dialog[open] .thumb')");
  await click("dialog[open] .thumb"); await click("dialog[open] .media-actions .primary");
  await waitFor("document.querySelector('.image-field a[download]')?.href.startsWith('blob:')");
  assert.equal(writes, 4, "File selection remains unsaved");
  await button("Save"); await waitFor("document.querySelector('.save-status')?.textContent.trim()==='Saved'");
  assert.equal(JSON.parse(blobs.get(files.get("site/src/fields/entry.json"))).file, fileUrl);
  await button("Copy"); await waitFor("!!document.querySelector('.markdown-editor')");
  await button("Markdown"); await waitFor("!!document.querySelector('.markdown-editor textarea')");
  await field('.markdown-editor textarea', `![Private](${imageUrl})\n\n[Attachment](${fileUrl})\n\nCopy`);
  await button("Visual"); await waitFor("document.querySelector('.ProseMirror img[src]')?.naturalWidth===1");
  await waitFor("document.querySelector('.ProseMirror a')?.href.startsWith('blob:')");
  await button("Save"); await waitFor("document.querySelector('.save-status')?.textContent.trim()==='Saved'");
  assert.ok(!blobs.get(files.get("site/src/copy/copy.ts")).toString().includes("blob:"), "Markdown persists the canonical repository path, not its preview URL");
  await button("Media"); await waitFor("document.querySelectorAll('.media-library .thumb').length===2");
  await button("Copy"); await waitFor("document.querySelector('.ProseMirror img[src]')?.naturalWidth===1");
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(!await evaluate("document.querySelector('.save-status')?.textContent.includes('Unsaved')"), "Authenticated previews do not dirty Markdown content");
  await button("Blogs"); await waitFor("!!document.querySelector('main .table-link')"); await click("main .table-link");
  await waitFor("!!document.querySelector('[aria-label=\"Toggle properties panel\"]')");
  await click('[aria-label="Toggle properties panel"]'); await waitFor("!!document.querySelector('.block-editor [data-image-trigger]')");
  const articleWrites = writes;
  await click('.block-editor [data-image-trigger]'); await waitFor("!!document.querySelector('dialog[open]')");
  await click('dialog[open] [data-source="url"]'); await waitFor("!!document.querySelector('dialog[open] input[type=url]')");
  await field('dialog[open] input[type=url]', 'https://images.fixture.test/photo.png'); await button("Use this URL");
  await waitFor("!!document.querySelector('dialog[open] .media-selection')");
  assert.equal(writes, articleWrites, "Remote import also requires confirmation");
  await click('dialog[open] .media-actions .primary');
  await waitFor("!document.querySelector('dialog[open]') && document.querySelector('.block-editor img[src^=blob]')?.naturalWidth===1");
  assert.equal(writes, articleWrites + 1, "Image import commits only media while article is dirty");
  assert.deepEqual(JSON.parse(blobs.get(files.get('site/src/blog/article.json'))).body, emptyBody);
  const importedUrl = Object.keys(ledger()).find(url => url.endsWith('.png') && url !== imageUrl);
  await waitFor("[...document.querySelectorAll('.visual-editor iframe')].some(frame=>frame.contentDocument?.querySelector('[data-rigel-richtext] img[src^=blob]')?.naturalWidth===1)");
  await click('.block-editor [data-media-trigger]'); await waitFor("!!document.querySelector('.media-menu:popover-open')");
  await evaluate("[...document.querySelectorAll('.media-menu:popover-open button')].find(button=>button.textContent.trim()==='Video').click()");
  await waitFor("!!document.querySelector('dialog[open]')");
  await click('dialog[open] [data-source="upload"]'); await chooseFile('private.mp4', 'video/mp4', video);
  await click('dialog[open] .media-actions .primary');
  await waitFor("!document.querySelector('dialog[open]') && document.querySelector('.block-editor video[src^=blob]')?.readyState >= 1");
  assert.equal(writes, articleWrites + 2, "Video upload commits media without saving the article");
  assert.deepEqual(JSON.parse(blobs.get(files.get('site/src/blog/article.json'))).body, emptyBody);
  const videoUrl = Object.keys(ledger()).find(url => url.endsWith('.mp4'));
  assert.deepEqual(blobs.get(files.get('site/static' + videoUrl)), video);
  await waitFor("[...document.querySelectorAll('.visual-editor iframe')].some(frame=>frame.contentDocument?.querySelector('[data-rigel-richtext] video[src^=blob]')?.readyState >= 1)");
  await button("Save"); await waitFor("document.querySelector('.save-status')?.textContent.trim()==='Saved'");
  assert.ok(blobs.get(files.get('site/src/blog/article.json')).toString().includes(importedUrl));
  assert.ok(!blobs.get(files.get('site/src/blog/article.json')).toString().includes('blob:'));
  await button("Media"); await waitFor("document.querySelectorAll('.media-library .thumb').length===4");
  await evaluate(`document.querySelector('.media-library button[aria-label="notes.txt"]').click()`);
  await waitFor("!!document.querySelector('dialog[open] iframe[src^=blob]')");
  await button("Delete file"); await waitFor("!!document.querySelector('.action-dialog')");
  await evaluate("[...document.querySelectorAll('.action-dialog button')].find(button=>button.textContent.trim()==='Delete file').click()");
  await waitFor("!document.querySelector('dialog[open]') && document.querySelectorAll('.media-library .thumb').length===3");
  assert.ok(!files.has("site/static" + fileUrl)); assert.ok(!Object.hasOwn(ledger(), fileUrl));
  assert.ok(!requests.some(request => request.path.includes("/pulls")), "Media never publishes");
  const benchmarkUrls = Array.from({ length: 40 }, (_, i) => `/uploads/media/benchmark-${String(i).padStart(2, "0")}.png`);
  for (const asset of benchmarkUrls) put("site/static" + asset, png);
  tree = id(); trees.set(tree, new Map(files));
  const previousHead = head; head = id(); commits.set(head, { tree, parents: [previousHead] });
  const benchmarkStart = requests.length;
  await button("Refresh");
  await waitFor("document.querySelectorAll('.media-library .thumb').length===43");
  await waitFor("document.querySelector('.media-library img[src^=blob]')?.naturalWidth===1");
  await new Promise(resolve => setTimeout(resolve, 300));
  const coldReads = requests.slice(benchmarkStart).filter(request => request.method === "GET");
  assert.equal(coldReads.filter(request => request.path.includes("/git/ref/")).length, 1);
  assert.equal(coldReads.filter(request => request.path.includes("/git/trees/")).length, 1);
  assert.ok(await evaluate("document.querySelectorAll('.media-library img:not([src])').length > 10"), "Offscreen thumbnails do not download eagerly");
  const firstPreview = await evaluate("document.querySelector('.media-library .thumb img[src^=blob]').dataset.rigelMediaUrl");
  const reopenStart = requests.length;
  for (let i = 0; i < 2; i++) {
    await evaluate(`document.querySelector('.media-library img[data-rigel-media-url="' + ${JSON.stringify(firstPreview)} + '"]').closest('button').click()`);
    await waitFor("document.querySelector('dialog[open] .media-preview img')?.naturalWidth===1");
    await waitFor("document.querySelector('dialog[open] a[download]')?.href.startsWith('blob:')");
    await click("dialog[open] .media-head .close");
  }
  assert.equal(requests.slice(reopenStart).filter(request => request.method === "GET").length, 0, "Detail reopen/download reuses immutable blobs");
  const cachedPreviewURL = await evaluate(`[...document.querySelectorAll('.media-library img')].find(img=>img.dataset.rigelMediaUrl===${JSON.stringify(firstPreview)}).src`);
  const refreshStart = requests.length, refreshedSha = files.get("site/static" + firstPreview);
  await button("Refresh");
  await waitFor(`revokedMediaURLs.includes(${JSON.stringify(cachedPreviewURL)})`);
  await waitFor(`[...document.querySelectorAll('.media-library img')].some(img=>img.dataset.rigelMediaUrl===${JSON.stringify(firstPreview)} && img.src.startsWith('blob:') && img.src!==${JSON.stringify(cachedPreviewURL)} && img.naturalWidth===1)`);
  assert.equal(requests.slice(refreshStart).filter(request => request.method === "GET" && request.path.endsWith(`/git/blobs/${refreshedSha}`)).length, 1, "Refresh clears identical-SHA image bytes and reloads its preview");
  await evaluate("document.querySelectorAll('.media-library .thumb')[42].click()");
  await waitFor("!!document.querySelector('dialog[open] .media-selection')");
  await waitFor("document.querySelector('dialog[open] a[download]')?.href.startsWith('blob:')");
  await click("dialog[open] .media-head .close");
  const benchmark = { assets: 43, coldGets: coldReads.length, headReads: 1, treeReads: 1, detailReopenGets: 0 };
  console.log(JSON.stringify({ mediaBenchmark: benchmark }));
  await writeFile("_temp/github-media-benchmark.json", JSON.stringify(benchmark, null, 2));
  await writeFile("_temp/github-media.png", Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await button("Upload"); await chooseFile("not-confirmed.png", "image/png", png);
  const writesBeforeLogout = writes;
  await evaluate("Date.now = () => new Date().getTime() + 7200000");
  await evaluate("document.querySelector('dialog[open] .media-actions .primary')?.click()");
  await waitFor("!document.querySelector('dialog[open]') && createdMediaURLs.every(url=>revokedMediaURLs.includes(url))");
  assert.equal(writes, writesBeforeLogout, "Expired context cannot commit an unconfirmed upload");
  await click(".user-btn"); await waitFor("!!document.querySelector('.user-menu')"); await click("#github-sign-out");
  await waitFor("!!document.querySelector('#github-connection')");
  await waitFor("createdMediaURLs.every(url=>revokedMediaURLs.includes(url))");
  assert.deepEqual(errors, []);
  await writeFile("_temp/github-media-results.json", JSON.stringify({ writes, requests: requests.length, assertions: "atomic upload, binary private preview/download, metadata, schema image/file unsaved Save, deletion, no publish/local API/token leaks, object URL cleanup", liveGitHub: false }, null, 2));
  console.log("PASS GitHub media: real App, mocked GitHub transport; no live GitHub writes");
} finally {
  socket?.close(); chrome.kill("SIGTERM");
  await once(chrome, "exit").catch(() => {}); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
