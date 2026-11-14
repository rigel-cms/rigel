import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/image-processing');
const publicDir = path.join(scratch, 'public');
await mkdir(path.join(publicDir, 'rigel-media'), { recursive: true });
await writeFile(path.join(publicDir, 'rigel-media/picture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=', 'base64'));
const baseline = await readFile(path.join(publicDir, 'rigel-media/picture.png'));
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/image-processing.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')}); import {run,runPrivateImage} from '/tests/fixtures/image-processing.js'; window.runImageChecks=run; window.runPrivateImage=runPrivateImage;`);
const dictionaries = { en: {}, fr: {} };
for (const locale of Object.keys(dictionaries)) {
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
}
const config = { backend: 'local', maxFileSize: 6 * 1024 * 1024, publicDir: pathToFileURL(publicDir + '/').href, languages: ['en', 'fr'], defaultLanguage: 'en', imageProcessing: {convertHeic:true,resize:false,quality:85,maxEdge:640} };
const virtual = { name: 'image-processing-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? config : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }

const fixtures = [
 ['example.heic', 'https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic', '7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2'],
 ['animation.webp', 'https://www.gstatic.com/webp/animated/1.webp', '8afc28fef9bba14b5eecbbc6bb8b4379dc96b6ebc3e0845607ced41b7dda337c'],
 ['animation.png', 'https://upload.wikimedia.org/wikipedia/commons/1/14/Animated_PNG_example_bouncing_beach_ball.png', '3b28e2462f1b31d0d15d795e6e58baf397899c3f864be7034bf47939b5bbbc3b'],
 ['animation.gif', 'https://raw.githubusercontent.com/imageio/imageio-binaries/master/images/newtonscradle.gif', 'a663c4e076b5c48e0aac58c7777d2bb3193cb3053c098d08da278a62d02ff314'],
];
for (const [name, url, hash] of fixtures) {
 let bytes;
 try { bytes = await readFile(path.join(scratch, name)); } catch {
  const response = await fetch(url); assert.ok(response.ok, url); bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(path.join(scratch, name), bytes);
 }
 const { createHash } = await import('node:crypto');
 assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
 await writeFile(path.join(publicDir, name), bytes);
}
let vite, chrome, ws, profile, uploads = 0;
const exceptions = [];
try {
  if (!process.env.RIGEL_IMAGE_SOURCE) await build(options);
  process.env.NODE_ENV = 'development';
  vite = await createServer({ ...options, root: process.env.RIGEL_IMAGE_SOURCE ? scratch : path.join(scratch, 'dist'), plugins: [virtual, svelte(), { name: 'real-media-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!['/rigel/media.json', '/rigel/api/local/media'].includes(req.url) && !req.url.startsWith('/rigel-media/')) return next();
      try {
        const module = await server.ssrLoadModule(path.join(root, req.url === '/rigel/media.json' ? 'src/routes/media.json.ts' : 'src/routes/local-media.ts'));
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        if (req.method === 'POST') uploads++;
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
        const response = await module[req.method]({ request, params: { filename: req.url.split('/').pop() } });
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { console.error(error); res.statusCode = 500; res.end(String(error)); }
    });
  } }] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  profile = path.join(scratch, `chrome-${Date.now()}`);
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
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.navigate', { url: origin });
  await wait(`typeof window.runImageChecks === 'function'`, 'browser fixture mounted');
  if (process.env.RIGEL_PRIVATE_HEIC) {
    const input = await readFile(process.env.RIGEL_PRIVATE_HEIC);
    const result = await evaluate(`window.runPrivateImage(${JSON.stringify(input.toString('base64'))}).catch(error => ({ error: error.stack }))`);
    assert.ok(!result.error, result.error);
    for (const [index, url] of result.stored.entries()) {
      const bytes = await readFile(path.join(publicDir, url));
      assert.equal(bytes.length, index === 0 ? result.outputBytes : result.resized.bytes);
      assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
      assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
      const ledger = JSON.parse(await readFile(path.join(publicDir, 'rigel-media/.rigel-media.json'), 'utf8'));
      assert.ok(ledger[url]);
    }
    console.log('PRIVATE HEIC:', JSON.stringify(result));
  }
  const result = await evaluate('window.runImageChecks().catch(error => { console.error(error); return {error: String(error), results:window.imageCheckResults}; })');
  if (result.error) throw new Error(JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  for (const url of result.stored) {
    const bytes = await readFile(path.join(publicDir, url));
    assert.ok(bytes.length > 100);
  }
  const ledger = JSON.parse(await readFile(path.join(publicDir, 'rigel-media/.rigel-media.json'), 'utf8'));
  assert.ok(result.stored.every(url => ledger[url]));
  await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.trim() === 'Media').click()`);
  await wait(`!![...document.querySelectorAll('.media-settings-section h3')].find(e => e.textContent === 'Image processing')`, 'Media image settings use the shared section heading');
  assert.equal(await evaluate(`(() => { const headings = [...document.querySelectorAll('.media-settings-section h3')]; return headings.length === 2 && ['fontSize', 'fontWeight', 'textTransform', 'letterSpacing', 'color'].every(key => getComputedStyle(headings[0])[key] === getComputedStyle(headings[1])[key]); })()`), true);
  await evaluate(`document.querySelector('.settings-pane input[type=checkbox]').click()`);
  await wait(`JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.convertHeic === false`, 'HEIC switch autosaved');
  await evaluate(`(()=>{const input=document.querySelector('.settings-pane input[type=number]'); input.value='75';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.quality === 75`, 'quality autosaved');
  await evaluate(`document.querySelectorAll('.settings-pane input[type=checkbox]')[1].click()`);
  await evaluate(`(()=>{const input=document.querySelectorAll('.settings-pane input[type=number]')[1];input.value='320';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.resize && JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.maxEdge===320`, 'resize and longest edge autosaved');
  const previousOrigin = await evaluate('performance.timeOrigin');
  await cdp('Page.reload');
  await wait(`performance.timeOrigin !== ${previousOrigin} && typeof window.runImageChecks === 'function' && !!document.querySelector('.settings-nav button')`, 'reload');
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.quality`),75);
  await evaluate(`[...document.querySelectorAll('.settings-nav button')].find(b => b.textContent.trim() === 'Media').click()`);
  assert.equal(await evaluate(`(() => { const [processing,stock] = document.querySelectorAll('.media-settings-section'); return stock.querySelector('h3').getBoundingClientRect().top-processing.querySelector('.image-processing-fields').getBoundingClientRect().bottom>=24; })()`), true, 'space before stock API keys');
  assert.equal(await evaluate(`document.querySelectorAll('.settings-pane .media-settings-section:first-child button').length`), 0, 'no reset button');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.image-processing-fields label > span')].map(e=>e.textContent)`), ['Quality', 'Max size (px)']);
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate(`(() => { const [left,right] = [...document.querySelectorAll('.image-processing-fields input')].map(e=>e.getBoundingClientRect()); return !!left && !!right && Math.abs(left.top-right.top)<1 && left.right<right.left && right.right<=innerWidth && document.documentElement.scrollWidth<=innerWidth; })()`), true, 'quality left and max size right without overflow');
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector('.settings-pane input[type=checkbox]').click()`);
  await evaluate(`document.querySelectorAll('.settings-pane input[type=checkbox]')[1].click()`);
  await wait(`JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.convertHeic && !JSON.parse(localStorage.getItem('rigelcms.settings')).imageProcessing.resize`, 'picker test conversion enabled without resizing');
  await writeFile(path.join(scratch, 'settings-light.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await evaluate(`document.documentElement.dataset.theme='dark'`);
  await writeFile(path.join(scratch, 'settings-dark.png'), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await click('.settings-head .close');
  await click('[data-staged-picker] button.outlined');
  await wait(`!!document.querySelector('dialog[open] [data-source=upload]')`, 'content picker sources');
  await click('dialog[open] [data-source=upload]');
  await wait(`!!document.querySelector('dialog[open] input[type=file]')`, 'local picker input');
  const beforePicker = uploads;
  await evaluate(`(async()=>{const file=new File([await (await fetch('/example.heic')).blob()],'Picker.heic',{type:'image/heic'});const input=document.querySelector('dialog[open] input[type=file]'), transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('dialog[open] .media-preview img')?.naturalWidth===1280`, 'processed HEIC staged preview');
  assert.equal(uploads, beforePicker, 'Processing and preview do not store bytes');
  await click('dialog[open] .media-actions .primary');
  await wait(`!document.querySelector('dialog[open]')`, 'local picker confirmed');
  assert.equal(uploads, beforePicker + 1);
  const afterPicker = JSON.parse(await readFile(path.join(publicDir, 'rigel-media/.rigel-media.json'), 'utf8'));
  const pickerUrl = Object.keys(afterPicker).find(url => afterPicker[url].name === 'Picker.webp');
  assert.ok(pickerUrl); assert.ok((await readFile(path.join(publicDir, pickerUrl))).length > 100);
  assert.deepEqual(await readFile(path.join(publicDir, 'rigel-media/picture.png')), baseline, 'existing media stays untouched');
  assert.deepEqual(exceptions, []);
  console.log(`PASS: ${result.results.length} real image checks, stored bytes/ledger readback, Settings persistence and compact layout, local picker staging/confirmation`);
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await vite?.close();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(publicDir, { recursive: true, force: true });
}
