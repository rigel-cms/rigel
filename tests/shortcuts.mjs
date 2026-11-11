import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, build } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const recoveryMode = process.argv.includes("--recovery");
const usageMode = process.argv.includes("--usage");
const recoveryBackend = { fail: false };
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = path.join(root, "_temp/shortcuts");
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, "index.html"), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, "main.js"), `import { mount } from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);

const body = {
  root: {
    type: "root", version: 1, direction: null, format: "", indent: 0,
    children: [{ type: "paragraph", version: 1, direction: null, format: "", indent: 0, textFormat: 0, textStyle: "", children: [{ type: "text", version: 1, text: "Original body", format: 0, detail: 0, mode: "normal", style: "" }] }],
  },
};
const manifest = {
  recoveryScope: "browser-test-project",
  schema: { objects: [], documents: [{ name: "settings", title: "Settings", type: "document", folder: "settings", shared: true, fields: [{ key: "title", label: "Title", type: "string" }] }] },
  documents: [{ id: "settings:site", type: "settings", slug: "site", data: { title: "Site name" } }],
  menus: { maxDepth: 3, entries: [{ slug: "main", title: "Main menu", items: [] }] },
  pages: [{ slug: "home", label: "Home", groups: [{ id: "hero", label: "Hero", fields: [{ key: "title", label: "Title", type: "string" }] }], values: { hero: { title: "Original title" } } }],
  collections: [{ name: "blog", label: "Blog", fields: [{ key: "title", label: "Title", type: "string" }], columns: ["title"], posts: [{ slug: "test", frontmatter: { title: "Test post" } }] }],
  preview: { pages: { home: "/preview-page.html" }, collections: { blog: { url: "/preview-post.html", template: "/preview-post.html" } } },
};
const pagePreview = '<!doctype html><html><body><main data-rigel-doc="page:home"><h1 data-rigel-text="hero.title">Original title</h1></main></body></html>';
const postPreview = '<!doctype html><html><body><main data-rigel-doc="blog:test"><h1 data-rigel-text="title">Test post</h1><div data-rigel-richtext="$body" data-rigel-doc="blog:test"><p>Original body</p></div></main></body></html>';

if (usageMode) {
  manifest.contentLocales = { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] };
  manifest.schema.documents.push(
    { name: "author", title: "Authors", type: "document", folder: "authors", shared: true, fields: [{ key: "name", label: "Name", type: "string" }, { key: "related", label: "Related page", type: "reference", to: ["page"] }] },
    { name: "page", title: "Pages", type: "document", folder: "pages", locale: "en", fields: [{ key: "title", label: "Title", type: "string" }, { key: "author", label: "Author", type: "reference", to: ["author"] }] },
    { name: "pageFr", title: "Pages françaises", type: "document", folder: "pages-fr", locale: "fr", fields: [{ key: "title", label: "Titre", type: "string" }, { key: "author", label: "Auteur", type: "reference", to: ["author"] }] },
  );
  manifest.documents.push(
    { id: "author:alex", type: "author", slug: "alex", data: { name: "Alex", _id: "author:alex", _type: "author" } },
    { id: "author:unused", type: "author", slug: "unused", data: { name: "Unused author", _id: "author:unused", _type: "author", related: { _ref: "page:landing" } } },
    { id: "offlinePage:offline", type: "offlinePage", slug: "offline", data: { title: "Offline page", _id: "offlinePage:offline", _type: "offlinePage" } },
    { id: "page:landing", type: "page", slug: "landing", data: { title: "Landing", _id: "page:landing", _type: "page", author: { _ref: "author:alex" } } },
    { id: "pageFr:accueil", type: "pageFr", slug: "accueil", data: { title: "Accueil", _id: "pageFr:accueil", _type: "pageFr", author: { _ref: "author:alex" } } },
  );
  manifest.schema.documents.push({ ...manifest.schema.documents.find(type => type.name === "page"), name: "offlinePage", title: "Offline pages", folder: "offline-pages" });
  manifest.preview.documents = { page: { url: "/preview-document/{slug}.html" }, pageFr: { url: "/preview-fr/{slug}.html" } };
  manifest.collections.push({ name: "notes", label: "News", fields: [{ key: "title", label: "Title", type: "string" }], columns: ["title"], posts: [{ slug: "plain", frontmatter: { title: "Plain article" } }] });
  manifest.collections[0].locale = "en";
  manifest.collections[0].fields.push({ key: "author", label: "Author", type: "reference", to: "author" });
  manifest.collections[0].posts[0].frontmatter.author = "author:alex";
  manifest.collections[0].fields.push({ key: "cover", label: "Cover", type: "image" });
  manifest.collections[0].posts[0].frontmatter.cover = "/usage-fixture.svg";
}

const dictionaries = { en: {} };
for (const file of await readdir(path.join(root, "src/editor/i18n/en"))) if (file.endsWith(".json")) Object.assign(dictionaries.en, JSON.parse(await readFile(path.join(root, "src/editor/i18n/en", file), "utf8")));
const virtual = { name: "shortcut-config", resolveId(id) { if (id.startsWith("virtual:rigel-")) return "\0" + id; }, load(id) { if (id.startsWith("\0virtual:rigel-")) return "export default " + JSON.stringify(id.endsWith("config") ? { backend: "local", languages: ["en"], defaultLanguage: "en" } : id.endsWith("i18n") ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: "error", plugins: [virtual, svelte()], resolve: { alias: { "/src": path.join(root, "src") }, dedupe: ["svelte"] }, build: { outDir: path.join(scratch, "dist"), emptyOutDir: true }, server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 120; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error("Timed out: " + label); }

let vite, chrome, ws, cdp, evaluate;
let checks = 0;
const writes = [];
const exceptions = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, "dist"), plugins: [{ name: "shortcut-backend", configureServer(server) { server.middlewares.use(async (req, res, next) => {
    const send = (status, type, value) => { res.statusCode = status; if (type) res.setHeader("Content-Type", type); res.end(value); };
    if (req.url === "/rigel/manifest.json") return send(200, "application/json", JSON.stringify(manifest));
    if (req.url === "/rigel/media.json") return send(200, "application/json", JSON.stringify({ assets: usageMode ? [{ name: "Usage fixture", url: "/usage-fixture.svg", type: "image/svg+xml", size: 100 }] : [], writable: false }));
    if (usageMode && req.url === "/usage-fixture.svg") return send(200, "image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>');
    if (usageMode && req.url === "/preview-document/landing.html") return send(200, "text/html", '<!doctype html><html><body><main data-rigel-doc="page:landing"><h1 data-rigel-text="title">Landing</h1></main></body></html>');
    if (usageMode && req.url === "/preview-fr/accueil.html") return send(200, "text/html", '<!doctype html><html><body><main data-rigel-doc="pageFr:accueil"><h1 data-rigel-text="title">Accueil</h1></main></body></html>');
    if (req.url === "/preview-page.html") return send(200, "text/html", pagePreview);
    if (req.url === "/preview-post.html") return send(200, "text/html", postPreview);
    if (recoveryMode && req.method !== "GET" && req.url.startsWith("/rigel/api/local/")) {
      writes.push(req.url);
      let text = ""; for await (const chunk of req) text += chunk;
      if (recoveryBackend.fail) return send(503, "text/plain", "Simulated save failure");
      const data = JSON.parse(text);
      if (req.url === "/rigel/api/local/save") manifest.pages[0].values = data.values;
      else if (req.url.startsWith("/rigel/api/local/documents/")) manifest.documents[0].data = data.data;
      else if (req.url.startsWith("/rigel/api/local/menus/")) Object.assign(manifest.menus.entries[0], data);
      else { const slug = decodeURIComponent(req.url.split("/").pop()); const post = manifest.collections[0].posts.find(post => post.slug === slug); if (post) Object.assign(post, data); else manifest.collections[0].posts.push({ slug, ...data }); }
      return send(200, "application/json", "{}");
    }
    if (usageMode && req.url === "/rigel/api/local/notes/plain" && req.method === "GET") return send(200, "application/json", JSON.stringify({ frontmatter: { title: "Plain article" }, body }));
    if (req.url === "/rigel/api/local/blog/test" && req.method === "GET") return send(200, "application/json", JSON.stringify({ frontmatter: { title: "Test post", ...(usageMode ? { author: "author:alex", cover: "/usage-fixture.svg" } : {}) }, body }));
    if (req.url === "/rigel/api/local/blog/test" && req.method === "POST") { writes.push(req.url); await delay(120); return send(200, "application/json", "{}"); }
    if (req.url === "/rigel/api/local/save" && req.method === "POST") { writes.push(req.url); await delay(120); return send(200, "application/json", "{}"); }
    if (req.method !== "GET") { writes.push("unexpected " + req.method + " " + req.url); return send(500, "text/plain", "Unexpected content write"); }
    next();
  }); } }] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const port = await until(async () => { try { return (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch { return false; } }, "Chrome");
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === "page").webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener("message", event => { const message = JSON.parse(event.data); if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  cdp = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + " timed out")); }, 15000); pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) })); });
  evaluate = async expression => { const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = (expression, label = expression) => until(() => evaluate(expression), label);
  async function check(expression, label) { const value = await evaluate(expression); if (!value) console.error(label, await evaluate(`({active:document.activeElement?.outerHTML?.slice(0,200), body:document.body.innerText.slice(0,400), writes:${JSON.stringify(writes)}})`)); assert.equal(value, true, label); checks++; }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async (keyValue, code, modifiers = 0, extra = {}) => {
    const keyCode = keyValue.length === 1 ? ({ "/": 191, "?": 191 }[keyValue] ?? keyValue.toUpperCase().charCodeAt(0)) : ({ Escape: 27, Enter: 13 }[keyValue] ?? 0);
    await cdp("Input.dispatchKeyEvent", { type: "rawKeyDown", key: keyValue, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, ...extra });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key: keyValue, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
  };
  const meta = 4, ctrl = 2, shift = 8, alt = 1;
  const hostFrame = `document.querySelector('.visual-editor iframe')`;
  const frameDoc = `${hostFrame}.contentDocument`;
  const clickInFrame = async (selector, frameSelector = '.visual-editor iframe') => {
    const point = await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(frameSelector)}); const el=f.contentDocument.querySelector(${JSON.stringify(selector)}); if(!el) return null; el.scrollIntoView({block:'center'}); const a=f.getBoundingClientRect(), b=el.getBoundingClientRect(); return {x:a.left+b.left+20,y:a.top+b.top+10};})()`);
    assert.ok(point, "missing iframe selector " + selector);
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, x: point.x, y: point.y });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, x: point.x, y: point.y });
  };
  const shot = async name => { const result = await cdp("Page.captureScreenshot", { format: "png" }); await writeFile(path.join(scratch, name + ".png"), Buffer.from(result.data, "base64")); };
  const focusFrame = (frameSelector = ".visual-editor iframe") => evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(frameSelector)}); f.focus(); f.contentWindow.focus();})()`);
  const reset = async () => { await cdp("Page.navigate", { url: origin }); await wait(`!!document.querySelector('#nav-pages')`, "app mount"); };

  await cdp("Runtime.enable"); await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await reset();

  if (usageMode) {
    await (await import("./entry-usage-browser.mjs")).runEntryUsage({ cdp, evaluate, wait, click, shot, origin, writes, exceptions });
  } else if (recoveryMode) {
    await (await import("./draft-recovery-browser.mjs")).runRecovery({ cdp, evaluate, wait, click, shot, origin, writes, exceptions, manifest, recoveryBackend, delay });
  } else {
  await check(`document.querySelector('.search-trigger kbd').textContent === '⌘ K'`, "search badge uses the compact platform label");
  await check(`document.querySelector('.search-trigger').getAttribute('aria-keyshortcuts') === 'Meta+K Control+K'`, "search exposes accessible key names");
  await key("k", "KeyK", meta);
  await wait(`!!document.querySelector('.palette')`, "search palette");
  await check(`document.activeElement === document.querySelector('.palette input')`, "search focus moves to the palette input");
  await key("b", "KeyB", meta);
  await check(`!document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "layout shortcut is blocked while search is open");
  await key("s", "KeyS", meta);
  assert.equal(writes.length, 0); checks++;
  await key("Escape", "Escape", 0);
  await check(`!document.querySelector('.palette')`, "Escape closes search");
  await key("k", "KeyK", meta);
  await wait(`!!document.querySelector('.palette')`, "search palette again");
  await key("k", "KeyK", meta);
  await check(`!document.querySelector('.palette')`, "search shortcut toggles closed");
  await shot("search");

  await key("b", "KeyB", meta);
  await check(`document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "Cmd+B collapses the navigation sidebar");
  await key("b", "KeyB", ctrl);
  await check(`!document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "Ctrl+B expands it on the same build");
  await check(`document.querySelector('.sidebar-toggle').getAttribute('aria-keyshortcuts') === 'Meta+B Control+B'`, "sidebar toggle exposes its shortcut");
  await evaluate(`location.hash = '#/copy/home'`);
  await wait(`!!document.querySelector('main input:not([readonly])')`, "page form");
  await evaluate(`document.querySelector('main input:not([readonly])').focus()`);
  await key("b", "KeyB", meta);
  await check(`!document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "sidebar shortcut is ignored while a text field has focus");

  await key("/", "Slash", meta);
  await wait(`!!document.querySelector('.shortcuts-dialog[open]')`, "shortcut help");
  await check(`document.querySelectorAll('.shortcuts-dialog .keys tr').length === 7`, "help lists every editor shortcut");
  await check(`[...document.querySelectorAll('.shortcuts-dialog .keys td:last-child')].some(cell => cell.textContent === '⌘ + S')`, "help renders the platform save key");
  await check(`[...document.querySelectorAll('.shortcuts-dialog kbd')].every(key => getComputedStyle(key).fontFamily.includes('monospace'))`, "help key labels use a monospace font");
  await check(`[...document.querySelectorAll('.shortcuts-dialog kbd, .search-trigger kbd')].every(key => getComputedStyle(key).fontWeight === '400')`, "shortcut key labels use regular weight");
  await check(`[...document.querySelectorAll('.shortcuts-dialog kbd')].some(key => key.textContent === 'Esc')`, "help uses the short Escape label");
  await check(`document.activeElement === document.querySelector('.shortcuts-dialog .close')`, "help moves focus to its close button");
  await check(`getComputedStyle(document.querySelector('.shortcuts-dialog .media-head')).borderBottomStyle === 'solid' && getComputedStyle(document.querySelector('#shortcuts-title')).fontSize === '16px'`, "help reuses the standard modal header");
  await check(`document.querySelector('.shortcuts-dialog').getAttribute('aria-labelledby') === 'shortcuts-title'`, "help dialog is labelled");
  await shot("help");
  await key("Escape", "Escape", 0);
  await wait(`!document.querySelector('.shortcuts-dialog')`, "help closes");
  await check(`document.activeElement === document.querySelector('main input:not([readonly])')`, "help restores focus to the opener");

  await wait(`!!document.querySelector('.preview-frame iframe.revealed')`, "page preview");
  await clickInFrame("h1", ".site-preview iframe");
  await focusFrame(".site-preview iframe");
  await key("s", "KeyS", meta);
  assert.equal(writes.length, 0); checks++;

  await evaluate(`(()=>{const input=document.querySelector('main input:not([readonly])'); input.focus(); input.select();})()`);
  await cdp("Input.insertText", { text: "Changed title" });
  await check(`document.querySelector('.save-status').textContent.includes('Unsaved')`, "editing marks the page dirty");
  await delay(400);
  assert.equal(writes.length, 0); checks++;
  await focusFrame(".site-preview iframe");
  await key("s", "KeyS", meta);
  await wait(`document.querySelector('.save-status').textContent.includes('Saved')`, "manual save completes");
  assert.equal(writes.length, 1); checks++;
  await check(`JSON.stringify(${JSON.stringify(writes)}) === '["/rigel/api/local/save"]'`, "save uses the existing local save endpoint");
  await key("k", "KeyK", meta);
  await wait(`!!document.querySelector('.palette')`, "search from the page preview frame");
  await key("Escape", "Escape", 0);
  await wait(`!document.querySelector('.palette')`, "page preview search closes");
  await key("s", "KeyS", meta);
  await delay(250);
  assert.equal(writes.length, 1); checks++;

  await evaluate(`(()=>{const input=document.querySelector('main input:not([readonly])'); input.focus(); input.select();})()`);
  await cdp("Input.insertText", { text: "Again" });
  await key("s", "KeyS", meta, { autoRepeat: true });
  await key("s", "KeyS", meta);
  await delay(300);
  assert.equal(writes.length, 2); checks++;
  await check(`document.querySelector('.save-status').textContent.includes('Saved')`, "repeated keydown does not duplicate the save");

  await evaluate(`(()=>{const input=document.querySelector('main input:not([readonly])'); input.focus(); input.select();})()`);
  await cdp("Input.insertText", { text: "Alt" });
  await key("s", "KeyS", meta | alt);
  await delay(250);
  assert.equal(writes.length, 2); checks++;

  await evaluate(`(()=>{const input=document.querySelector('main input:not([readonly])'); input.focus(); input.select();})()`);
  await cdp("Input.insertText", { text: "Composing" });
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true,isComposing:true,bubbles:true,cancelable:true}))`);
  await delay(250);
  assert.equal(writes.length, 2); checks++;
  await check(`document.querySelector('.save-status').textContent.includes('Unsaved')`, "composition keeps the draft unsaved");

  await key("s", "KeyS", meta);
  await delay(300);
  await check(`document.querySelector('.save-status').textContent.includes('Saved')`, "composition guard does not block a later save");

  await evaluate(`(()=>{const input=document.querySelector('main input:not([readonly])'); input.focus(); input.select();})()`);
  await cdp("Input.insertText", { text: "Blocked" });
  await click(".user-btn");
  await wait(`!!document.querySelector('.user-menu')`, "user menu");
  await key("s", "KeyS", meta);
  await delay(250);
  const blockedWrites = writes.length;
  await click(".user-menu button[aria-keyshortcuts]");
  await wait(`!!document.querySelector('.shortcuts-dialog[open]')`, "help from menu");
  await key("s", "KeyS", meta);
  await delay(250);
  assert.equal(writes.length, blockedWrites); checks++;
  await key("b", "KeyB", meta);
  await check(`!document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "shortcuts are blocked while help is open");
  await key("Escape", "Escape", 0);
  await wait(`!document.querySelector('.shortcuts-dialog')`, "help closes again");
  await check(`document.querySelector('.save-status').textContent.includes('Unsaved')`, "blocked saves leave the draft untouched");
  await key("s", "KeyS", meta);
  await wait(`document.querySelector('.save-status').textContent.includes('Saved')`, "saving after dialogs close");

  await evaluate(`location.hash = '#/collections/blog/test'`);
  await wait(`!!document.querySelector('.visual-editor .preview-frame iframe.revealed')`, "post preview");
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Edit'`, "post opens in Edit mode");
  await check(`document.querySelector('.visual-editor.with-panel') !== null && document.querySelector('#properties-tab-page')?.getAttribute('aria-selected') === 'true'`, "articles open properties on the Page tab");
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Browse'`, "Cmd+Shift+E switches to Browse");
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Edit'`, "Cmd+Shift+E returns to Edit");
  await check(`document.querySelector('.mode-toggle button').getAttribute('aria-keyshortcuts') === 'Meta+Shift+E Control+Shift+E'`, "mode buttons expose their shortcut");

  await key("Y", "KeyY", meta | shift);
  await check(`document.querySelector('.visual-editor').classList.contains('with-panel') && document.querySelector('.visual-actions .icon-btn[aria-pressed]').getAttribute('aria-pressed') === 'true'`, "Cmd+Shift+Y opens the properties panel");
  await key("Y", "KeyY", ctrl | shift);
  await check(`!document.querySelector('.visual-editor').classList.contains('with-panel')`, "Ctrl+Shift+Y closes it");

  await focusFrame();
  await key("Y", "KeyY", meta | shift);
  await check(`document.querySelector('.visual-editor').classList.contains('with-panel')`, "properties shortcut works with focus in the preview frame");
  await key("Y", "KeyY", meta | shift);
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Browse'`, "mode shortcut works with focus in the preview frame");
  await key("E", "KeyE", meta | shift);

  await evaluate(`${hostFrame}.contentWindow.location.reload()`);
  await delay(500);
  await wait(`document.querySelector('.canvas-stage').dataset.ready === 'true'`, "iframe reload");
  await focusFrame();
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Browse'`, "mode shortcut survives an iframe reload");
  await key("E", "KeyE", meta | shift);

  await focusFrame();
  await key("k", "KeyK", meta);
  await wait(`!!document.querySelector('.palette')`, "search from the preview frame");
  await check(`document.activeElement === document.querySelector('.palette input')`, "preview search moves focus into the palette");
  await key("Escape", "Escape", 0);
  await wait(`!document.querySelector('.palette')`, "preview search closes");
  await focusFrame();

  await clickInFrame('[data-rigel-richtext="$body"] p');
  await wait(`!!document.querySelector('.rigel-inline') || !!${frameDoc}.querySelector('[contenteditable="true"]')`, "inline body editor");
  const before = await evaluate(`${frameDoc}.querySelector('[data-rigel-richtext="$body"]')?.innerText`);
  await cdp("Input.insertText", { text: "Hello " });
  await wait(`${frameDoc}.querySelector('[data-rigel-richtext="$body"]')?.innerText.includes('Hello')`, "typed text");
  const frameWrites = writes.length;
  await key("s", "KeyS", meta);
  await wait(`document.querySelector('.save-status').textContent.includes('Saved')`, "save from the preview frame");
  assert.equal(writes.length, frameWrites + 1); checks++;
  await check(`JSON.stringify(${JSON.stringify(writes)}).includes('/rigel/api/local/blog/test')`, "preview save uses the article endpoint");
  await key("b", "KeyB", meta);
  await cdp("Input.insertText", { text: "Bold" });
  await wait(`${frameDoc}.querySelector('[data-rigel-richtext="$body"] strong')?.textContent.includes('Bold')`, "rich text bold");
  await check(`!document.querySelector('.rigel').classList.contains('sidebar-collapsed')`, "Cmd+B is left to rich text bold while editing");
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Edit'`, "mode shortcut is ignored during inline editing");
  await key("z", "KeyZ", meta);
  await delay(200);
  await key("z", "KeyZ", meta);
  await delay(200);
  await key("z", "KeyZ", meta);
  await delay(300);
  await check(`${frameDoc}.querySelector('[data-rigel-richtext="$body"]')?.innerText === ${JSON.stringify(before)}`, "Cmd+Z still undoes rich text typing and formatting");
  await click(".mode-toggle button:first-child");
  await wait(`!document.querySelector('.visual-editor iframe').contentDocument.querySelector('.rigel-inline')`, "inline editor closes");
  await key("E", "KeyE", meta | shift);
  await check(`document.querySelector('.mode-toggle button[aria-pressed="true"]').textContent === 'Edit'`, "mode shortcut resumes after leaving the inline editor");

  await key("s", "KeyS", meta);
  await delay(300);
  await evaluate(`location.hash = '#/copy/home'`);
  await wait(`!!document.querySelector('main input:not([readonly])')`, "page form again");
  await evaluate(`document.querySelector('main input:not([readonly])').focus()`);
  await cdp("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 1, mobile: true });
  await key("/", "Slash", meta);
  await wait(`!!document.querySelector('.shortcuts-dialog[open]')`, "mobile help");
  await check(`(()=>{const d=document.querySelector('.shortcuts-dialog .rigel-modal').getBoundingClientRect(); return d.left>=8 && d.right<=innerWidth-8 && d.top>=0 && d.bottom<=innerHeight && document.querySelector('.shortcuts-dialog .rigel-modal').scrollWidth<=document.querySelector('.shortcuts-dialog .rigel-modal').clientWidth;})()`, "help fits a narrow viewport without horizontal overflow");
  await check(`document.activeElement === document.querySelector('.shortcuts-dialog .close')`, "mobile help keeps keyboard focus on close");
  await shot("help-mobile");
  await key("Escape", "Escape", 0);
  await wait(`!document.querySelector('.shortcuts-dialog')`, "mobile help closes");
  await check(`document.activeElement === document.querySelector('main input:not([readonly])')`, "mobile help restores focus");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

  assert.deepEqual(exceptions, []);
  console.log(`PASS shortcuts: ${checks} checks, ${writes.length} content writes`);
  }
} finally {
  try { ws?.close(); } catch {}
  try { chrome?.kill("SIGTERM"); } catch {}
  try { await vite?.close(); } catch {}
}
