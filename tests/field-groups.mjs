import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/field-groups');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/field-groups.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = { en: {} };
for (const file of await readdir(path.join(root, 'src/editor/i18n/en'))) if (file.endsWith('.json')) Object.assign(dictionaries.en, JSON.parse(await readFile(path.join(root, 'src/editor/i18n/en', file), 'utf8')));
const virtual = { name: 'field-groups-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'demo', languages: ['en'] } : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }
let vite, chrome, ws, checks = 0;
const profile = path.join(scratch, `chrome-${Date.now()}`);
const exceptions = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [] });
  await vite.listen();
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  async function check(expression, label) { assert.equal(await evaluate(expression), true, label); checks++; }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.navigate', { url: `http://127.0.0.1:${vite.httpServer.address().port}` });
  await until(() => evaluate(`!!document.querySelector('#schema [data-schema-path="custom"]')`), 'panels');
  for (const panel of ['schema', 'collection']) {
    const attr = panel === 'schema' ? 'data-schema-path' : 'data-collection-field';
    for (const [group, keys] of Object.entries({ page: ['title', 'draft', 'layout'], content: ['custom', 'description'], seo: ['keywords', 'publishedAt', 'notes', 'metaTitle'] })) {
      for (const key of keys) await check(`!!document.querySelector('#${panel} #properties-${group} [${attr}="${key}"]')`, `${panel}: ${key} in ${group}`);
    }
    await click(`#${panel} #properties-tab-seo`);
    await check(`document.querySelector('#${panel} #properties-seo').checkVisibility()`, `${panel}: SEO visible`);
    await check(`document.querySelector('#${panel} [${attr}="notes"] .ProseMirror') !== null`, `${panel}: full markdown renderer in SEO`);
    await check(`document.querySelector('#${panel} [data-seo-length="metaTitle"]') !== null && document.querySelectorAll('#${panel} [data-seo-length]').length === 1`, `${panel}: only native SEO guidance`);
  }
  await check(`!!document.querySelector('#collection [data-collection-field="author"] button[role="combobox"]')`, 'SEO reference renderer');
  await evaluate(`(() => { const input = document.querySelector('#collection [data-collection-field="keywords"] input'); input.value = 'alpha, beta'; input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await check(`JSON.stringify(JSON.parse(document.querySelector('#values').textContent).keywords) === '["alpha","beta"]'`, 'SEO tags retain arrays');
  await click('#focus-custom');
  await until(() => evaluate(`document.activeElement.closest('#schema [data-schema-path="custom"]') !== null`), 'content focus');
  await check(`document.querySelector('#schema #properties-content').checkVisibility()`, 'custom selection routes Content');
  await click('#focus-description');
  await until(() => evaluate(`document.activeElement.closest('#schema [data-schema-path="description"]') !== null`), 'overridden native SEO focus');
  await click('#focus-collection-description');
  await until(() => evaluate(`document.activeElement.closest('#collection [data-collection-field="description"]') !== null`), 'collection overridden native SEO focus');
  await check(`document.querySelector('#collection #properties-content').checkVisibility()`, 'collection overridden native SEO selection routes Content');
  await click('#focus-nested');
  await until(() => evaluate(`document.activeElement.closest('#schema [data-schema-path="settings.canonical"]') !== null`), 'nested SEO focus');
  await check(`document.querySelector('#schema #properties-seo').checkVisibility()`, 'nested selection follows top-level group');
  await check(`!document.querySelector('#shared [role="tablist"]') && [...document.querySelectorAll('#shared [data-schema-path]')].every(e => e.checkVisibility())`, 'shared records keep every field visible without tabs');
  assert.deepEqual(exceptions, []);
  console.log(`field-groups: ${checks} checks passed; no browser exceptions`);
} finally {
  ws?.close(); chrome?.kill(); await vite?.close();
  await delay(200); await rm(profile, { recursive: true, force: true });
}
