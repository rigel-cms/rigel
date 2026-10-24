import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/preview-loading');
await mkdir(scratch, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await delay(20); }
  throw new Error(`Timed out: ${label}`);
}
const requests = [];
function fixture(req, res) {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url.pathname === '/asset.svg') {
    setTimeout(() => { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"></svg>'); }, 700);
    return;
  }
  if (url.pathname === '/style.css') {
    setTimeout(() => { res.setHeader('Content-Type', 'text/css'); res.end('h1 {color: rgb(12,34,56)}'); }, 600);
    return;
  }
  setTimeout(() => {
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/missing') { res.statusCode = 404; res.end('Missing'); return; }
    res.end(`<!doctype html><html><head>${url.searchParams.has('assets') ? '<link rel="stylesheet" href="/style.css">' : ''}</head><body><h1 ${url.searchParams.has('unprepared') || url.pathname.includes('unprepared') ? '' : 'data-rigel-text="title"'}>Deployed ${url.pathname}</h1><button>Hidden control</button>${url.searchParams.has('assets') ? '<img src="/asset.svg">' : ''}</body></html>`);
  }, Number(url.searchParams.get('delay') ?? 0));
}
const remote = httpServer(fixture);
await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
const remoteOrigin = `http://127.0.0.1:${remote.address().port}`;
await writeFile(path.join(scratch, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import Harness from './Harness.svelte'; import '/src/editor/styles.css'; mount(Harness, {target: document.getElementById('app')});`);
await writeFile(path.join(scratch, 'Harness.svelte'), `<script>
import PreviewFrame from '/src/editor/lib/PreviewFrame.svelte';
import SitePreview from '/src/editor/lib/SitePreview.svelte';
let consumer = $state('shared');
let url = $state('/fast'), reloadToken = $state(0), mounted = $state(true), layout = $state('visual');
let frame = $state(), value = $state('Unsaved title'), error = $state(''), events = $state([]);
window.previewTest = {
  navigate(next) { url = next; }, reload() { reloadToken++; }, unmount() { mounted = false; },
  layout(next) { layout = next; }, edit(next) { value = next; if(frame?.contentDocument?.querySelector('h1')) frame.contentDocument.querySelector('h1').textContent = next; },
  consumer() { consumer = 'legacy'; },
  events() { return events; }
};
function loaded() { frame.contentDocument.querySelector('h1').textContent = value; events.push({type:'ready', time: performance.now(), url}); }
</script>
<div class="rigel" style="display:block;height:700px">
<button onclick={() => layout = layout === 'visual' ? 'legacy' : 'visual'}>Properties</button>
<p role="status">{error}</p>
<div class={layout === 'visual' ? 'canvas-stage' : 'site-preview'} style="height:550px;position:relative;padding:0">
{#if consumer === 'legacy'}
  {#key url}<SitePreview target={{kind:'page', slug:'copy'}} config={{draftUrl:new URL(url,location.href).origin, pages:{copy:new URL(url,location.href).pathname}}} values={{title:value}} body="" />{/key}
{:else if mounted}<PreviewFrame bind:frame {url} {reloadToken} title="Loading regression" onloading={() => { error = ''; events.push({type:'loading', time:performance.now(), url}); }} onload={loaded} onerror={message => {error = message; events.push({type:'error', time:performance.now(), url});}} />{/if}
</div></div>`);
const options = {
  configFile: false, root: scratch, logLevel: 'warn', plugins: [svelte()],
  resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] },
  build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } },
};
let vite, chrome, ws;
let checks = 0;
const exceptions = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [{ name:'fixture', configureServer(server) {
    server.middlewares.use((req, res, next) => /^\/(?:fast|slow|latest|missing|style\.css|asset\.svg)/.test(req.url ?? '') ? fixture(req, res) : next());
  } }] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio:'ignore'});
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome debugging');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); }
  });
  function cdp(method, params = {}) { return new Promise((resolve,reject) => { const key = ++id; pending.set(key,{resolve,reject}); ws.send(JSON.stringify({id:key,method,params})); }); }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', {expression, returnByValue:true, awaitPromise:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const wait = (expression, label) => until(() => evaluate(expression), label);
  const busy = `document.querySelector('.preview-frame')?.getAttribute('aria-busy') === 'true'`;
  const idle = `document.querySelector('iframe')?.classList.contains('revealed') && !document.querySelector('.preview-loading')`;
  const navigate = url => evaluate(`previewTest.navigate(${JSON.stringify(url)})`);
  const screenshot = async name => { const r = await cdp('Page.captureScreenshot'); await writeFile(path.join(scratch,name),Buffer.from(r.data,'base64')); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', {width:1200,height:850,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate', {url:origin});
  await wait(busy, 'initial loading');
  assert.equal(await evaluate(`document.querySelector('iframe').inert && document.querySelector('iframe').getAttribute('aria-hidden') === 'true'`), true);
  await screenshot('loading.png');
  await wait(idle, 'fast reveal');
  const elapsed = await evaluate(`{const e=previewTest.events(); e.find(x=>x.type==='ready').time-e[0].time}`);
  assert(elapsed >= 490 && elapsed < 1500, `fast minimum: ${elapsed}ms`); checks++;
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.querySelector('h1').textContent`), 'Unsaved title'); checks++;
  await wait(`getComputedStyle(document.querySelector('iframe')).opacity === '1'`, 'first fade complete');
  await navigate('/slow?delay=800&assets');
  await wait(busy, 'slow same-origin HTML');
  await delay(550);
  assert.equal(await evaluate(busy), true);
  assert.equal(await evaluate(`document.querySelector('iframe').inert`), true);
  await evaluate(`document.querySelector('.rigel > button').click()`);
  assert.equal(await evaluate(`!!document.querySelector('.site-preview')`), true); checks++;
  await wait(`!!document.querySelector('iframe').contentDocument?.querySelector('h1')`, 'slow HTML parsed');
  await evaluate(`Object.defineProperty(document.querySelector('iframe').contentDocument.fonts, 'ready', {value: new Promise(() => {})})`);
  await wait(idle, 'slow assets and bounded unresolved fonts finish');
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.querySelector('img').naturalWidth`), 8); checks++;
  await navigate(`${remoteOrigin}/fast`);
  await wait(busy, 'cross-origin start');
  await wait(idle, 'cross-origin fast reveal');
  assert.equal(await evaluate(`document.querySelector('iframe').hasAttribute('srcdoc')`), true); checks++;
  await wait(`getComputedStyle(document.querySelector('iframe')).opacity === '1'`, 'cross-origin fade');
  await navigate(`${remoteOrigin}/slow?delay=500&assets`);
  await wait(busy, 'cross-origin slow');
  await delay(600);
  assert.equal(await evaluate(busy), true); checks++;
  await wait(idle, 'cross-origin slow assets');
  await navigate('/fast?fade=1'); await wait(busy, 'fade start'); await wait(idle, 'fade reveal');
  await wait(`Number(getComputedStyle(document.querySelector('iframe')).opacity) > 0 && Number(getComputedStyle(document.querySelector('iframe')).opacity) < 1`, 'intermediate fade');
  const opacity = await evaluate(`Number(getComputedStyle(document.querySelector('iframe')).opacity)`);
  assert(opacity > 0 && opacity < 1, `visible fade intermediate opacity ${opacity}`); checks++;
  await screenshot('fade.png');
  await wait(`getComputedStyle(document.querySelector('iframe')).opacity === '1'`, 'fade end');
  await evaluate(`window.originalFrame=document.querySelector('iframe'); window.originalDoc=originalFrame.contentDocument; window.eventCount=previewTest.events().length; previewTest.edit('Edited while visible')`);
  await delay(600);
  assert.equal(await evaluate(`document.querySelector('iframe') === originalFrame && originalFrame.contentDocument === originalDoc && previewTest.events().length === eventCount && !originalFrame.inert`), true); checks++;
  await evaluate(`previewTest.reload()`); await wait(busy, 'reload loader'); await wait(idle, 'reload reveal');
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.querySelector('h1').textContent`), 'Edited while visible'); checks++;
  await navigate(`${remoteOrigin}/slow?delay=1000`); await wait(busy, 'stale fetch');
  await navigate('/latest'); await wait(idle, 'latest wins'); await delay(1100);
  assert.equal(await evaluate(`document.querySelector('iframe').contentDocument.URL.endsWith('/latest') && !document.querySelector('.preview-loading')`), true); checks++;
  await navigate('/fast?stale-settle=1'); await wait(busy, 'stale settling'); await delay(100); await navigate('/latest?next=1'); await wait(busy, 'new settle');
  await delay(350); assert.equal(await evaluate(busy), true); await wait(idle, 'new settle complete'); checks++;
  await navigate(`${remoteOrigin}/missing`); await wait(`previewTest.events().at(-1)?.type === 'error'`, 'HTTP failure');
  assert.equal(await evaluate(`!document.querySelector('.preview-loading') && document.querySelector('.preview-frame').getAttribute('aria-busy') === 'false'`), true); checks++;
  await navigate('/slow?delay=20500'); await wait(busy, 'stalled document');
  await delay(20200);
  assert.equal(await evaluate(`!document.querySelector('.preview-loading') && previewTest.events().at(-1).type === 'error' && !document.querySelector('iframe').classList.contains('revealed')`), true); checks++;
  await delay(600);
  assert.equal(await evaluate(`previewTest.events().at(-1).type`), 'error', 'late native load cannot reveal a timed-out frame'); checks++;
  await cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await navigate('/fast?reduced=1'); await wait(idle, 'reduced motion');
  const reduced = await evaluate(`{const e=previewTest.events(); e.at(-1).time-e.at(-2).time}`);
  assert(reduced < 450, `reduced motion skips minimum: ${reduced}ms`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('iframe')).transitionDuration`), '0s'); checks++;
  await cdp('Emulation.setDeviceMetricsOverride', {width:390,height:800,deviceScaleFactor:1,mobile:true});
  await screenshot('mobile.png');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true); checks++;
  await navigate('/slow?delay=900'); await wait(busy, 'unmount pending');
  await evaluate(`window.countBeforeUnmount=previewTest.events().length; previewTest.unmount()`); await delay(1200);
  assert.equal(await evaluate(`previewTest.events().length === countBeforeUnmount && !document.querySelector('.preview-loading')`), true); checks++;
  await evaluate(`previewTest.layout('visual'); previewTest.consumer()`);
  for (const prefix of ['', remoteOrigin]) {
    await navigate(`${prefix}/fast/unprepared`);
    await wait(`document.querySelector('.preview-error')?.textContent.includes('no prepared Rigel anchors')`, 'legacy internal callback error');
    await wait(idle, 'legacy error clears busy and reveals unprepared page');
    assert.equal(await evaluate(`document.querySelector('iframe').inert`), false); checks++;
  }
  assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  await writeFile(path.join(scratch,'results.json'), JSON.stringify({checks,elapsed,reduced,opacity,requests,exceptions},null,2));
  console.log(`PASS ${checks} loading regression groups; fast ${elapsed.toFixed(1)}ms; reduced ${reduced.toFixed(1)}ms; intermediate opacity ${opacity}. Screenshots and results: ${scratch}`);
} finally {
  ws?.close(); chrome?.kill(); await vite?.close(); await new Promise(resolve => remote.close(resolve));
}
