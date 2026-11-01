import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/inline-markdown');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html data-theme="dark"><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/inline-markdown.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const preview = '<!doctype html><style>body{background:white;color:#142536;font:20px/1.7 Georgia;margin:0;padding:120px 40px}main{max-width:640px}h2{font-size:32px}footer{margin-top:40px}</style><main data-rigel-doc="page:sample"><div id="copy" style="color: rgb(20, 37, 54);" data-rigel-richtext="copy" data-rigel-doc="page:sample"><h2>Native copy</h2><p>Website <strong>presentation</strong> stays readable.</p><p>Another paragraph.</p></div></main><footer>Footer remains below copy</footer>';
const dictionaries = { en: {}, fr: {} };
for (const locale of Object.keys(dictionaries)) for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
const virtual = { name: 'inline-markdown-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: ['en'], defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }
let vite, chrome, ws, checks = 0;
const exceptions = [];
try {
  await build(options);
  await writeFile(path.join(scratch, 'dist/preview.html'), preview);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 15000); pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params })); });
  async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  const wait = (expression, label) => until(() => evaluate(expression), label);
  async function check(expression, label) { const result = await evaluate(expression); if (!result) console.error(label, await evaluate(`({html:document.querySelector('iframe')?.contentDocument.querySelector('#copy')?.outerHTML, original:window.original, controls:!!document.querySelector('iframe')?.contentDocument.querySelector('.rigel-inline')})`)); assert.equal(result, true, label); checks++; }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const frame = `document.querySelector('iframe').contentDocument`;
  const copy = `${frame}.querySelector('#copy')`;
  async function activate() {
    const point = await evaluate(`(()=>{const f=document.querySelector('iframe'), p=f.contentDocument.querySelector('#copy p'); const a=f.getBoundingClientRect(), b=p.getBoundingClientRect(); return {x:a.left+b.left+30,y:a.top+b.top+10};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await wait(`${copy}.isContentEditable`, 'native Markdown editor');
  }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('iframe.revealed')`, 'preview');
  await check(`!document.querySelector('.with-panel') && document.querySelector('.visual-actions button').getAttribute('aria-pressed') === 'false'`, 'properties closed initially');
  await evaluate(`window.original = {html:${copy}.outerHTML, color:${frame}.defaultView.getComputedStyle(${copy}).color, font:${frame}.defaultView.getComputedStyle(${copy}).fontFamily};`);
  await activate();
  await check(`${copy}.getBoundingClientRect().height > 100 && ${frame}.querySelector('footer').getBoundingClientRect().top >= ${copy}.getBoundingClientRect().bottom`, 'copy retains flow and footer placement');
  await check(`!${copy}.closest('.rigel') && ${frame}.defaultView.getComputedStyle(${copy}).color === original.color && ${frame}.defaultView.getComputedStyle(${copy}).fontFamily === original.font`, 'website colors and typography preserved in CMS dark theme');
  await evaluate(`document.documentElement.dataset.theme = 'light'`);
  await check(`${frame}.defaultView.getComputedStyle(${copy}).color === original.color && ${copy}.getBoundingClientRect().height > 100`, 'theme changes affect controls, not website prose');
  await check(`document.querySelector('#draft').textContent === document.querySelector('#saved').textContent`, 'activation does not dirty copy');
  await click('.mode-toggle button:first-child');
  await wait(`!${copy}.isContentEditable`, 'Browse teardown');
  await check(`${copy}.outerHTML === original.html && !${frame}.querySelector('.rigel-inline')`, 'byte-exact no-op restoration and controls removed');
  await click('.mode-toggle button:nth-child(2)');
  await check(`!document.querySelector('.with-panel')`, 'returning to Edit leaves properties closed');
  await activate();
  await cdp('Input.insertText', { text: 'Edited ' });
  await wait(`document.querySelector('#draft').textContent.includes('Edited ')`, 'real iframe typing updates field');
  await check(`!document.querySelector('#saved').textContent.includes('Edited ')`, 'typing does not save');
  await evaluate(`${frame}.querySelector('.markdown-modes button:nth-child(2)').click()`);
  await wait(`!!${frame}.querySelector('textarea') && !${copy}.isContentEditable`, 'source mode makes prose readonly');
  await check(`${frame}.querySelector('textarea').value === document.querySelector('#draft').textContent`, 'source retains field value');
  await evaluate(`(()=>{const input=${frame}.querySelector('textarea'); input.value += '\\n\\nSource edit.'; input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`document.querySelector('#draft').textContent.includes('Source edit.')`, 'source updates field');
  await evaluate(`${frame}.querySelector('.markdown-modes button:first-child').click()`);
  await wait(`${copy}.isContentEditable`, 'visual mode restores editing');
  await check(`${copy}.textContent.includes('Source edit.') && !document.querySelector('#saved').textContent.includes('Source edit.')`, 'source edit returns to visual without saving');
  await click('.mode-toggle button:first-child');
  await wait(`!${frame}.querySelector('.rigel-inline')`, 'edited Browse teardown');
  await check(`${copy}.textContent.includes('Edited ') && !${copy}.classList.contains('ProseMirror')`, 'preview patches edited value after teardown');
  await click('#save');
  await check(`document.querySelector('#saved').textContent === document.querySelector('#draft').textContent`, 'explicit Save fixture retains updated field');
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, result: 'PASS: real VisualEditor iframe, native Markdown, geometry, typography, source, teardown and explicit Save fixture' }));
} finally { ws?.close(); chrome?.kill(); await vite?.close(); }
