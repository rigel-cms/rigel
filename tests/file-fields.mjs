import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/file-fields');
const publicDir = path.join(scratch, 'public');
await mkdir(path.join(publicDir, 'rigel-media'), { recursive: true });
await writeFile(path.join(publicDir, 'rigel-media/original.csv'), 'name,value\nalpha,one\n');
await writeFile(path.join(publicDir, 'rigel-media/wrong.txt'), 'Not CSV');
await writeFile(path.join(publicDir, 'rigel-media/picture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=', 'base64'));
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/file-field.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = { en: {}, fr: {} };
for (const locale of Object.keys(dictionaries)) {
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
}
const config = { backend: 'local', publicDir: pathToFileURL(publicDir + '/').href, languages: ['en', 'fr'], defaultLanguage: 'en' };
const virtual = { name: 'file-field-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? config : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }
let vite, chrome, ws, uploads = 0, checks = 0;
const exceptions = [];
try {
  await build(options);
  process.env.NODE_ENV = 'development';
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [virtual, { name: 'real-media-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!['/rigel/media.json', '/rigel/api/local/media'].includes(req.url)) return next();
      try {
        const module = await server.ssrLoadModule(path.join(root, req.url === '/rigel/media.json' ? 'src/routes/media.json.ts' : 'src/routes/local-media.ts'));
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        if (req.method === 'POST') uploads++;
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
        const response = await module[req.method]({ request });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { console.error(error); res.statusCode = 500; res.end(String(error)); }
    });
  } }] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  async function evaluate(expression) { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  const wait = async (expression, label) => { try { return await until(() => evaluate(expression), label); } catch (error) { console.error(await evaluate('document.body.innerText'), exceptions); throw error; } };
  async function check(expression, label) { const result = await evaluate(expression); if (!result) console.error(label, await evaluate(`({draft:document.querySelector('#draft').textContent,href:document.querySelector('iframe').contentDocument.querySelector('a')?.outerHTML})`)); assert.equal(result, true, label); checks++; }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = text => evaluate(`[...document.querySelectorAll('dialog[open] button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  async function upload(name, body) { await evaluate(`(()=>{const input=document.querySelector('dialog[open] input[type=file]'); const files=new DataTransfer(); files.items.add(new File([${JSON.stringify(body)}],${JSON.stringify(name)},{type:'text/csv'})); input.files=files.files; input.dispatchEvent(new Event('change',{bubbles:true}));})()`); }
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('#file-field .image-field button')`, 'native file picker rendered');
  await check(`(() => { const b = document.querySelector('#file-field button[aria-label="Remove file"]'); const r = b.getBoundingClientRect(); return r.width === 36 && r.height === 36 && getComputedStyle(b).padding === '0px'; })()`, 'remove control is square without text-button padding');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
  await check(`(() => { const r = document.querySelector('#file-field button[aria-label="Remove file"]').getBoundingClientRect(); return r.width === 44 && r.height === 44; })()`, 'touch remove control is a 44px square');
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await click('#file-field .image-field button');
  await wait(`!!document.querySelector('dialog[open] .thumb')`, 'library loaded');
  await check(`[...document.querySelectorAll('dialog[open] .media-views button')].every(b => { const r = b.getBoundingClientRect(); return r.width === 36 && r.height === 36; })`, 'media view controls are square');
  await check(`document.querySelector('dialog[open]').getAttribute('aria-label') === 'Choose file'`, 'truthful file dialog');
  await check(`[...document.querySelectorAll('dialog[open] [data-source]')].map(x=>x.dataset.source).join(',') === 'library,upload'`, 'no stock or URL sources');
  await check(`[...document.querySelectorAll('dialog[open] .thumb')].every(b=>b.getAttribute('aria-label').endsWith('.csv'))`, 'library filtered to CSV');
  await click('dialog[open] [data-source="upload"]');
  await wait(`!!document.querySelector('dialog[open] input[type=file]')`, 'upload input');
  await check(`document.querySelector('input[type=file]').accept === '.csv'`, 'native accept');
  await upload('wrong.txt', 'name,value\nalpha,one');
  await wait(`!!document.querySelector('dialog[open] [role=alert]')`, 'non CSV rejected');
  assert.equal(uploads, 0);
  await upload('schedule.csv', 'name,value\nbeta,two\n');
  await wait(`!!document.querySelector('dialog[open] .media-selection')`, 'CSV preview');
  await check(`!document.querySelector('dialog[open] img,dialog[open] textarea,dialog[open] input[type=text]')`, 'no fake image or alt fields');
  assert.equal(uploads, 0);
  await button('Upload file');
  await wait(`!document.querySelector('dialog[open]') && document.querySelector('#draft').textContent !== '/rigel-media/original.csv'`, 'upload confirmed');
  assert.equal(uploads, 1);
  const url = await evaluate(`document.querySelector('#draft').textContent`);
  assert.match(url, /^\/rigel-media\/[a-f0-9-]+\.csv$/);
  assert.equal(await readFile(path.join(publicDir, url), 'utf8'), 'name,value\nbeta,two\n');
  await check(`document.querySelector('#saved').textContent === '/rigel-media/original.csv'`, 'upload leaves content unsaved');
  await check(`document.querySelector('iframe').contentDocument.querySelector('a').getAttribute('href') === document.querySelector('#draft').textContent`, 'native preview href follows draft');
  await click('#save');
  await check(`document.querySelector('#saved').textContent === document.querySelector('#draft').textContent`, 'explicit save');
  await click('#file-field .image-field button');
  await wait(`!!document.querySelector('dialog[open] .thumb')`, 'replacement library');
  await click('dialog[open] button[aria-label="original.csv"]');
  await button('Use file');
  await wait(`document.querySelector('#draft').textContent === '/rigel-media/original.csv'`, 'existing CSV replaces draft');
  await click('#file-field button[aria-label="Remove file"]');
  await check(`document.querySelector('#draft').textContent === '' && document.querySelector('#saved').textContent !== ''`, 'clear stays unsaved');
  await check(`!document.querySelector('iframe').contentDocument.querySelector('a').hasAttribute('href')`, 'clear removes preview href');
  await click('#image-field button');
  await wait(`!!document.querySelector('dialog[open] .thumb')`, 'image library');
  await check(`[...document.querySelectorAll('dialog[open] .thumb')].every(b=>b.getAttribute('aria-label').endsWith('.png')) && !!document.querySelector('[data-source="picsum"]')`, 'image picker preserved');
  await click('dialog[open] button[aria-label="Close"]');
  await click('#video-field button');
  await wait(`!!document.querySelector('dialog[open] [data-source="youtube"]')`, 'video providers preserved');
  assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, uploads, url, result: 'PASS (real media API, explicit Save fixture)' }));
} finally { ws?.close(); chrome?.kill(); await vite?.close(); }
