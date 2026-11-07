import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const url = process.env.RIGEL_URL || "http://127.0.0.1:4322/rigel/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const shaOf = text => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest("hex");
let sequence = 0, head = "b".repeat(40), installed = true, writable = true, fixtureUser = "fixture-user", active = 0, peak = 0;
const nextSha = () => (++sequence).toString(16).padStart(40, "0");
const files = new Map(), blobs = new Map(), trees = new Map(), commits = new Map(), requests = [], errors = [];
let localMode = false, localReindexed = 0;
let holdBlobs = false;
const layouts = [];
const localLedgers = new Map();
const articleBody = text => ({ root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "text", version: 1, text, detail: 0, format: 0, mode: "normal", style: "" }], direction: null, format: "", indent: 0 }], direction: null, format: "", indent: 0 } });
const put = (path, text) => { const sha = shaOf(text); blobs.set(sha, text); files.set(path, { sha, text, mode: "100644" }); };
const folder = "src/content/blog", ledgerPath = folder + "/.rigel-collection.json";
const collection = { name: "blog", label: "Blog", fields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "slug", label: "URL", type: "string" }, { key: "draft", label: "Draft", type: "boolean" }], posts: [], columns: ["title", "slug"] };
for (let i = 0; i < 12; i++) put(`${folder}/article-${String(i).padStart(2,"0")}.json`, JSON.stringify({ frontmatter: { title: `Article ${i}`, draft: true }, body: articleBody(`Body marker ${i}`) }));
const fingerprint = JSON.stringify([collection.name, null, collection.fields, collection.columns]);
put(ledgerPath, JSON.stringify({ version: 1, fingerprint, entries: [...files].map(([path, file]) => ({ slug: path.split("/").at(-1).slice(0,-5), sha: file.sha, frontmatter: JSON.parse(file.text).frontmatter })) }));
function remember() { const tree = nextSha(); trees.set(tree, new Map(files)); commits.set(head, { tree, parents: [] }); }
remember();
const gateway = createServer((request, response) => {
  const target = new URL(request.url, "http://localhost");
  if (target.pathname !== "/authorize") { response.writeHead(404).end(); return; }
  const origin = target.searchParams.get("origin");
  const nonce = target.searchParams.get("nonce");
  response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  response.end(`<!doctype html><title>Fixture gateway</title><button onclick='window.opener.postMessage(${JSON.stringify({ type: "rigel:auth", provider: "github", nonce, access_token: "ghu_fixture_user_token", expires_in: 3600 })},${JSON.stringify(origin)}); window.close()'>Authorize fixture</button><script>document.querySelector('button').click()</script>`);
});
await new Promise(resolve => gateway.listen(0, "127.0.0.1", resolve));
const authOrigin = `http://localhost:${gateway.address().port}`;
const manifest = { backend: "github", pages: [], collections: [collection], github: { repo: "fixture-owner/fixture-site", branch: "drafts", publishBranch: "main", repoRoot: "", authOrigin, appSlug: "rigel-cms", copyDir: "src/content/copy", collections: [{ name: "blog", folder }] } };
function api(path, method, body) {
  requests.push({ path, method });
  if (method === "OPTIONS") return [204, null];
  if (path === "/graphql" && method === "POST") return [404, {}];
  if (path === "/user") return [200, { login: fixtureUser, avatar_url: "https://avatars.githubusercontent.com/u/1", html_url: `https://github.com/${fixtureUser}` }];
  const installation = { id: 7, app_slug: "rigel-cms", account: { login: "fixture-owner", type: "User" }, permissions: { contents: "write" }, suspended_at: null, html_url: "https://github.com/settings/installations/7" };
  if (path.startsWith("/user/installations?")) return [200, { total_count: installed && fixtureUser === "fixture-user" ? 1 : 0, installations: installed && fixtureUser === "fixture-user" ? [installation] : [] }];
  const repository = { id: 42, full_name: manifest.github.repo, name: "fixture-site", default_branch: "main", owner: { login: "fixture-owner" }, permissions: { push: writable, pull: true }, archived: false, disabled: false };
  if (path.startsWith("/user/installations/7/repositories?")) return [200, { total_count: 1, repositories: [repository] }];
  const prefix = `/repos/${manifest.github.repo}`;
  if (path === prefix) return [200, repository];
  if (method === "GET" && path === `${prefix}/git/ref/heads/drafts`) return [200, { object: { sha: head } }];
  if (method === "GET" && path.startsWith(`${prefix}/git/trees/`)) {
    const key = path.slice(`${prefix}/git/trees/`.length).split("?")[0], tree = trees.get(commits.get(key)?.tree ?? key);
    assert.ok(tree);
    return [200, { truncated: false, tree: [...tree].map(([path, file]) => ({ path, sha: file.sha, mode: file.mode, type: "blob" })) }];
  }
  if (method === "GET" && path.startsWith(`${prefix}/git/blobs/`)) { const sha = path.split("/").at(-1); assert.ok(blobs.has(sha)); return [200, { sha, encoding: "base64", content: Buffer.from(blobs.get(sha)).toString("base64") }]; }
  if (method === "GET" && path.startsWith(`${prefix}/git/commits/`)) return [200, { tree: { sha: commits.get(path.split("/").at(-1)).tree } }];
  if (method === "POST" && path === `${prefix}/git/blobs`) { const text = Buffer.from(body.content,"base64").toString(), sha = shaOf(text); blobs.set(sha,text); return [201,{sha}]; }
  if (method === "POST" && path === `${prefix}/git/trees`) {
    const tree = new Map(trees.get(body.base_tree));
    for (const entry of body.tree) { if (entry.sha === null) tree.delete(entry.path); else tree.set(entry.path,{sha:entry.sha,text:blobs.get(entry.sha),mode:entry.mode}); }
    requests.at(-1).paths = body.tree.map(e => e.path);
    const sha = nextSha(); trees.set(sha,tree); return [201,{sha}];
  }
  if (method === "POST" && path === `${prefix}/git/commits`) { const sha = nextSha(); commits.set(sha,{tree:body.tree,parents:body.parents}); return [201,{sha}]; }
  if (method === "PATCH" && path === `${prefix}/git/refs/heads/drafts`) {
    assert.equal(body.force,false); const commit = commits.get(body.sha); if (commit.parents[0] !== head) return [422,{}];
    head = body.sha; files.clear(); for (const [path,file] of trees.get(commit.tree)) files.set(path,file); return [200,{object:{sha:head}}];
  }
  if (method === "GET" && path.startsWith(`${prefix}/contents/`)) { const file = files.get(path.slice(`${prefix}/contents/`.length).split("?")[0]); return file ? [200,{type:"file",sha:file.sha,encoding:"base64",content:Buffer.from(file.text).toString("base64")}] : [404,{}]; }
  throw new Error(`Unexpected fixture request: ${method} ${path}`);
}
await mkdir("_temp", { recursive: true });
const profile = await mkdtemp(`${process.cwd()}/_temp/github-browser-`);
const chrome = spawn(process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--no-first-run", "--no-default-browser-check", "--window-size=1280,900", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome did not start")), 10000);
    chrome.once("error", reject);
    chrome.stderr.on("data", chunk => { const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  socket = new WebSocket(endpoint);
  await once(socket, "open");
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const result = JSON.parse(data), request = pending.get(result.id);
    if (!request) return;
    pending.delete(result.id);
    result.error ? request.reject(new Error(result.error.message)) : request.resolve(result.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(requestId, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  const cdp = (method, params) => send(method, params, sessionId);
  socket.addEventListener("message", ({ data }) => {
    const event = JSON.parse(data);
    if (event.sessionId !== sessionId) return;
    if (event.method === "Runtime.exceptionThrown") errors.push(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text);
    if (event.method === "Fetch.requestPaused") void (async () => {
      const { requestId, request } = event.params;
      const target = new URL(request.url);
      if (target.pathname === "/rigel/manifest.json") {
        await cdp("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from(JSON.stringify(manifest)).toString("base64") });
      } else if (target.hostname === "api.github.com") {
        const isBlob = request.method === "GET" && target.pathname.includes("/git/blobs/");
        if (isBlob) { active++; peak = Math.max(peak,active); while (holdBlobs) await new Promise(resolve => setTimeout(resolve,20)); await new Promise(resolve => setTimeout(resolve,60)); }
        const [status, result] = api(target.pathname + target.search, request.method, request.postData ? JSON.parse(request.postData) : undefined);
        if (isBlob) active--;
        await cdp("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [
          { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Headers", value: "Authorization,Content-Type,Accept,X-GitHub-Api-Version" }, { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,PATCH,DELETE,OPTIONS" },
        ], body: Buffer.from(result === null ? "" : JSON.stringify(result)).toString("base64") });
      } else if (target.pathname.startsWith("/rigel/api/local/")) {
        if (localMode) await cdp("Fetch.continueRequest", { requestId });
        else throw new Error("GitHub mode called a local persistence API");
      } else await cdp("Fetch.continueRequest", { requestId });
    })().catch(error => { errors.push(error.message); void cdp("Fetch.failRequest", { requestId: event.params.requestId, errorReason: "Failed" }); });
  });
  await cdp("Page.enable"); await cdp("Runtime.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*://api.github.com/*" }, { urlPattern: "*/rigel/manifest.json" }, { urlPattern: "*/rigel/api/local/*" }] });
  const evaluate = async expression => {
    const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out: ${expression}\n${JSON.stringify(errors)}\n${await evaluate("document.body.innerText.slice(0,2000)")}`);
  };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const checkLayout = async state => {
    for (const width of [1280, 390]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await evaluate(`(() => {
        const heading = document.querySelector('.titlebar'), card = document.querySelector('.table-card');
        const add = [...heading.querySelectorAll('button')].find(b => b.textContent === 'Add new');
        const refresh = add?.nextElementSibling;
        const status = document.querySelector('main > [role=status]');
        const alert = document.querySelector('main > [role=alert]');
        const controls = [...document.querySelectorAll('main > button')];
        const fits = element => {
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.left < 0 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1) return false;
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
            if (/(hidden|clip|auto|scroll)/.test(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) return false;
          }
          return true;
        };
        return {
          refreshAfterAdd: refresh?.textContent === 'Refresh' && refresh.parentElement === heading && !card.contains(refresh),
          statusAfterTable: !status || (card.nextElementSibling === status && status.getBoundingClientRect().top >= card.getBoundingClientRect().bottom && getComputedStyle(status).position === 'static'),
          alertAfterTable: !alert || !!(card.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING),
          noClipping: [add, refresh, status, alert, ...controls].filter(Boolean).every(fits),
          status: !!status, alert: !!alert,
          overflow: document.documentElement.scrollWidth > innerWidth
        };
      })()`);
      assert.equal(layout.refreshAfterAdd, true, JSON.stringify({ state, width, layout }));
      assert.equal(layout.statusAfterTable, true);
      assert.equal(layout.alertAfterTable, true);
      assert.equal(layout.noClipping, true, JSON.stringify({ state, width, layout }));
      assert.equal(layout.overflow, false);
      assert.equal(layout.status, state !== 'indexed');
      assert.equal(layout.alert, state === 'error');
      const artifact = `_temp/collection-layout-${state}-${width}.png`;
      await writeFile(artifact, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      layouts.push({ state, width, ...layout, artifact });
    }
    await cdp('Emulation.clearDeviceMetricsOverride');
  };
  const checkMaintenance = async backend => {
    for (const width of [1280, 390]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const layout = await evaluate(`(() => {
        const pane = document.querySelector('.settings-pane');
        const groups = [...pane.querySelectorAll('.clear-data')];
        const styles = groups.map(element => {
          const style = getComputedStyle(element);
          return Object.fromEntries(['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'backgroundColor', 'boxShadow', 'marginTop'].map(key => [key, style[key]]));
        });
        return {
          devMode: pane.querySelector('[role=switch]').checked,
          headings: groups.map(element => element.querySelector('h3').textContent),
          tags: groups.map(element => element.tagName),
          enabled: !groups[0]?.querySelector('button').disabled,
          styles,
          fits: groups.every(element => { const rect = element.getBoundingClientRect(); return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth && element.scrollWidth <= element.clientWidth; })
        };
      })()`);
      assert.equal(layout.devMode, false);
      assert.deepEqual(layout.headings, ['Maintenance', 'Clear Data']);
      assert.deepEqual(layout.tags, ['DIV', 'DIV']);
      assert.equal(layout.enabled, true);
      assert.equal(layout.fits, true);
      assert.deepEqual(layout.styles[0], layout.styles[1]);
      for (const key of ['borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) assert.equal(layout.styles[0][key], '0px');
      assert.equal(layout.styles[0].boxShadow, 'none');
      assert.equal(layout.styles[0].backgroundColor, 'rgba(0, 0, 0, 0)');
      const artifact = `_temp/maintenance-${backend}-${width}.png`;
      await writeFile(artifact, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      layouts.push({ backend, width, ...layout, artifact });
    }
    await cdp('Emulation.clearDeviceMetricsOverride');
  };
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.setItem('rigelcms.settings',JSON.stringify({language:'en',devMode:false,userPref:{editorExperience:'sidebar'}}));" });
  await cdp("Page.navigate", { url });
  await waitFor("!!document.querySelector('#github-sign-in')");
  await click("#github-sign-in");
  await waitFor("!!document.querySelector('#rigel-sidebar')");
  const articleShas = () => new Set([...files].filter(([path]) => path !== ledgerPath).map(([,file]) => file.sha));
  const articleReads = start => requests.slice(start).filter(r => r.method === 'GET' && articleShas().has(r.path.split('/').at(-1))).length;
  assert.equal(articleReads(0),0);
  await click('[data-collection="blog"]');
  await waitFor("document.querySelectorAll('tbody .table-link').length === 12");
  assert.equal(articleReads(0),0);
  await checkLayout('indexed');
  await click('tbody .table-link');
  await waitFor("!!document.querySelector('[aria-label=\"Toggle properties panel\"]') && !document.querySelector('main')?.innerText.includes('Loading article')");
  assert.equal(articleReads(0),1);
  await click('[data-collection="blog"]'); await waitFor("document.querySelectorAll('tbody .table-link').length === 12");
  await click('tbody .table-link'); await waitFor("!!document.querySelector('[aria-label=\"Toggle properties panel\"]')");
  assert.equal(articleReads(0),1);
  await click('[aria-label="Toggle properties panel"]');
  await waitFor("!!document.querySelector('[data-collection-field=title] input')");
  await click('#properties-tab-page');
  await evaluate("(() => {const input=document.querySelector('[data-collection-field=title] input');input.value='Saved indexed article';input.dispatchEvent(new Event('input',{bubbles:true}));})()");
  await click('.save-button');
  await waitFor("document.querySelector('.save-status')?.textContent.trim()==='Saved'");
  assert.deepEqual(requests.filter(r=>r.paths).at(-1).paths.sort(),[`${folder}/article-00.json`,ledgerPath].sort());
  const savedArticle=files.get(`${folder}/article-00.json`);
  assert.equal(JSON.parse(files.get(ledgerPath).text).entries.find(entry=>entry.slug==='article-00').sha,savedArticle.sha);
  await click('.user-btn');
  await evaluate("[...document.querySelectorAll('.user-menu button')].find(b=>b.textContent.trim()==='Settings').click()");
  await waitFor("!!document.querySelector('.settings-modal')");
  await evaluate("[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.includes('Advanced')).click()");
  await checkMaintenance(localMode ? 'local' : 'github');
  await evaluate("[...document.querySelectorAll('.settings-pane button')].find(b=>b.textContent==='Reindex all content').click()");
  await waitFor("!!document.querySelector('.action-dialog[open]')");
  const originalArticles = [...files].filter(([path]) => path !== ledgerPath).map(([path,file])=>[path,file.text]);
  await click('.action-dialog button[type=submit]');
  await waitFor("document.querySelector('.settings-pane')?.textContent.includes('Content metadata ledgers saved.')");
  assert.deepEqual([...files].filter(([path])=>path!==ledgerPath).map(([path,file])=>[path,file.text]),originalArticles);
  assert.deepEqual(requests.filter(r=>r.paths).at(-1).paths,[ledgerPath]);
  await click('.settings-modal .close');
  put(`${folder}/article-01.json`, JSON.stringify({frontmatter:{title:'External edit',draft:true},body:articleBody('Changed body')}));
  files.delete(`${folder}/article-02.json`);
  put(`${folder}/article-12.json`, JSON.stringify({frontmatter:{title:'New external article',draft:true},body:articleBody('New body')}));
  head=nextSha(); remember();
  const beforeReload=requests.length;
  await cdp('Page.navigate',{url}); await waitFor("!!document.querySelector('#rigel-sidebar')");
  assert.equal(articleReads(beforeReload),0);
  await click('.search-trigger');
  await waitFor("!!document.querySelector('.palette')");
  assert.equal(articleReads(beforeReload),0);
  await evaluate("document.querySelector('.palette-backdrop').click()");
  await click('[data-collection="blog"]'); await waitFor("document.querySelectorAll('tbody .table-link').length === 12");
  await waitFor("document.querySelector('tbody')?.textContent.includes('External edit')");
  assert.equal(articleReads(beforeReload),2);
  assert.equal(await evaluate("document.querySelector('tbody').textContent.includes('External edit')"),true);
  assert.equal(await evaluate("document.querySelector('tbody').textContent.includes('article-02')"),false);
  await evaluate("[...document.querySelectorAll('.titlebar button')].find(b=>b.textContent==='Refresh').click()");
  await waitFor("[...document.querySelectorAll('.titlebar button')].find(b=>b.textContent==='Refresh')?.disabled === true");
  await waitFor("[...document.querySelectorAll('.titlebar button')].find(b=>b.textContent==='Refresh')?.disabled === false && document.querySelectorAll('tbody .table-link').length === 12 && !document.querySelector('main > [role=status]')");
  const beforeRefreshedSelection=requests.length;
  await click('tbody .table-link');
  await waitFor("!!document.querySelector('[aria-label=\"Toggle properties panel\"]')");
  assert.equal(articleReads(beforeRefreshedSelection),1);
  await click('[data-collection="blog"]'); await waitFor("document.querySelectorAll('tbody .table-link').length === 12");
  const beforeCorrupt=requests.length;
  await evaluate("new Promise((resolve,reject)=>{const request=indexedDB.open('rigelcms-files',1);request.onsuccess=()=>{const db=request.result,tx=db.transaction('files','readwrite');tx.objectStore('files').clear();tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};})");
  put(ledgerPath,'{'); head=nextSha(); remember();
  await cdp('Page.navigate',{url}); await waitFor("!!document.querySelector('#rigel-sidebar')");
  assert.equal(articleReads(beforeCorrupt),0);
  holdBlobs = true;
  await click('[data-collection="blog"]');
  await waitFor("document.querySelector('main > [role=status]')?.textContent.includes('Indexing metadata')");
  await checkLayout('loading');
  await evaluate("[...document.querySelectorAll('main > button')].find(b=>b.textContent==='Cancel').click()");
  holdBlobs = false;
  await waitFor("!!document.querySelector('main > [role=alert]')");
  assert.equal(await evaluate("document.querySelector('.table-card')?.textContent.includes('Metadata index incomplete')"),true);
  await checkLayout('error');
  await evaluate("[...document.querySelectorAll('main > button')].find(b=>b.textContent==='Retry loading').click()");
  await waitFor("document.querySelectorAll('tbody .table-link').length === 12 && !document.querySelector('main > [role=alert]')");
  assert.equal(articleReads(beforeCorrupt),12);
  assert.equal(requests.slice(beforeCorrupt).some(r=>!['GET','OPTIONS'].includes(r.method) && r.path!=='/graphql'),false);
  const fallbackReads = articleReads(beforeCorrupt);
  if (process.env.RIGEL_FIXTURE_ROOT) {
    const directory = join(process.env.RIGEL_FIXTURE_ROOT,folder), ledger = join(directory,'.rigel-collection.json');
    const originals = new Map(await Promise.all((await readdir(directory)).filter(name=>!name.startsWith('.') && name.endsWith('.json')).map(async name=>[name,await readFile(join(directory,name))])));
    localLedgers.set(ledger,await readFile(ledger).catch(error=>{if(error.code==='ENOENT')return null;throw error;}));
    localMode=true; manifest.backend=undefined; manifest.github=undefined; manifest.collections=[{...collection,posts:[]}];
    await cdp('Page.navigate',{url}); await waitFor("!!document.querySelector('#rigel-sidebar')");
    await click('.user-btn');
    await evaluate("[...document.querySelectorAll('.user-menu button')].find(b=>b.textContent.trim()==='Settings').click()");
    await waitFor("!!document.querySelector('.settings-modal')");
    await evaluate("[...document.querySelectorAll('.settings-nav button')].find(b=>b.textContent.includes('Advanced')).click()");
    await checkMaintenance('local');
    await evaluate("[...document.querySelectorAll('.settings-pane button')].find(b=>b.textContent==='Reindex all content').click()");
    await waitFor("!!document.querySelector('.action-dialog[open]')");
    await click('.action-dialog button[type=submit]');
    await waitFor("document.querySelector('.settings-pane')?.textContent.includes('Content metadata ledgers saved.')");
    const entries=JSON.parse(await readFile(ledger,'utf8')).entries;
    assert.equal(entries.length,originals.size);
    for(const [name,bytes] of originals) assert.deepEqual(await readFile(join(directory,name)),bytes);
    localReindexed=entries.length;
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({benchmark:'12 indexed articles',loginArticleReads:0,selectedArticleReads:1,reopenedArticleReads:0,externalChangedOrNewReads:2,deletedReads:0,corruptLedgerFallbackReads:fallbackReads,cancelAndRetry:true,peakBlobConcurrency:peak,reindexArticleFilesChanged:0,ledgerOnlyCommit:true,articleSaveAtomic:true,localReindexed,layouts}));
} finally {
  holdBlobs = false;
  for(const [file,bytes] of localLedgers) if(bytes===null) await rm(file,{force:true}); else await writeFile(file,bytes);
  socket?.close(); chrome.kill("SIGKILL");
  await new Promise(resolve => gateway.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
