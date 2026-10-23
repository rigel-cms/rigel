import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/tooltips');
await mkdir(scratch, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
await writeFile(path.join(scratch, 'index.html'), '<html><body style="margin:0"><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount, unmount } from 'svelte'; import App from '/src/editor/App.svelte'; import Select from '/src/editor/lib/Select.svelte'; import { tooltipRoot } from '/src/editor/lib/tooltip.ts'; import '/src/editor/styles.css'; window.editor = mount(App, {target:document.getElementById('app')}); window.dispose = () => unmount(window.editor); window.register = tooltipRoot; window.addSelect = target => mount(Select,{target,props:{title:'Forwarded hint',ariaLabel:'Fixture select',options:[{value:'a',label:'Alpha'},{value:'b',label:'Beta'}]}});`);
const options = { configFile: false, root: scratch, logLevel: 'error', plugins: [svelte()], resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } } };
let vite, chrome, ws;
let writes = 0, checks = 0;
const exceptions = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [{ name: 'tooltip-fixture', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== 'GET') { writes++; res.statusCode = 405; res.end(); }
      else if (req.url === '/rigel/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ pages: [], collections: [{name:'blog',label:'Blog',fields:[],posts:[{slug:'test',frontmatter:{title:'Test'},body:{root:{children:[],direction:null,format:'',indent:0,type:'root',version:1}}}]}] })); }
      else if (req.url === '/rigel/media.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({assets:[],writable:false})); }
      else next();
    });
  } }] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome debugging port');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, {once:true}));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, {resolve,reject}); ws.send(JSON.stringify({id:key,method,params})); }); }
  async function evaluate(expression) { const result = await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; }
  async function check(expression, label) { const result = await evaluate(expression); if (!result) console.error(label, await evaluate(`({active:document.activeElement.outerHTML,tips:[...document.querySelectorAll('[role="tooltip"]')].map(t=>t.outerHTML),exceptions:${JSON.stringify(exceptions)}})`)); assert.equal(result, true, label); checks++; }
  const wait = (expression, label) => until(() => evaluate(expression), label);
  const shown = `!!document.querySelector('[role="tooltip"]:popover-open')`;
  const focus = async selector => { await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`); await delay(30); };
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = async key => { await cdp('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode: ({Escape:27,Tab:9,ArrowDown:40,Enter:13})[key]}); await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code:key}); };
  async function hover(selector) { const rect = await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',...rect}); }
  async function shot(name) { const result = await cdp('Page.captureScreenshot'); await writeFile(path.join(scratch, name+'.png'),Buffer.from(result.data,'base64')); }
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Emulation.setFocusEmulationEnabled', {enabled:true});
  await cdp('Emulation.setDeviceMetricsOverride',{width:1100,height:800,deviceScaleFactor:1,mobile:false});
  await cdp('Page.navigate',{url:origin});
  await wait(`!!document.querySelector('#nav-pages')`,'App mounted');
  await evaluate(`document.documentElement.dataset.theme='light'`);
  await focus('.search-trigger');
  await check(shown,'keyboard focus opens immediately');
  await check(`document.querySelector('[role="tooltip"]').textContent === 'Search content (⌘K)'`,'real sidebar hint');
  await shot('light');
  await key('Escape');
  await check(`!(${shown}) && document.activeElement.matches('.search-trigger')`,'Escape preserves focus');
  await hover('#nav-pages'); await delay(100);
  await check(`!(${shown})`,'hover is delayed');
  await wait(shown,'hover opens');
  await hover('[role="tooltip"]'); await delay(600);
  await check(shown,'tooltip remains hoverable');
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:1090,y:790}); await delay(250);
  await check(`!(${shown})`,'pointer departure dismisses');
  await evaluate(`document.querySelector('.search-trigger').blur(); document.querySelector('#nav-pages').setAttribute('aria-describedby','existing');`);
  await focus('#nav-pages');
  await check(`document.activeElement.getAttribute('aria-describedby') === 'existing rigel-tooltip'`,'description IDs preserved');
  await key('Escape');
  await check(`document.activeElement.getAttribute('aria-describedby') === 'existing'`,'description IDs restored');
  await evaluate(`document.body.insertAdjacentHTML('beforeend','<div class="rigel" id="probes" style="position:fixed;right:0;bottom:0"><button id="edge" data-tooltip="Edge hint">Edge</button><dialog class="rigel" id="modal"><button id="modal-button" data-tooltip="Modal hint">Modal</button><div id="popup" popover="auto"><button id="popup-button" data-tooltip="Popover hint">Popover</button></div><div id="select"></div></dialog></div><button id="website" title="Host website title">Website</button>'); window.addSelect(document.querySelector('#select'));`);
  await focus('#edge');
  await check(`(()=>{const r=document.querySelector('[role="tooltip"]').getBoundingClientRect();return r.left>=8 && r.right<=innerWidth-8 && r.top>=8 && r.bottom<=innerHeight-8})()`,'viewport clamp and flip');
  await evaluate(`document.querySelector('#modal').showModal()`);
  await focus('#modal-button');
  await check(`${shown} && document.querySelector('#modal').contains(document.querySelector('[role="tooltip"]'))`,'modal tooltip stays non-inert');
  await evaluate(`document.querySelector('#popup').showPopover()`); await focus('#popup-button');
  await check(`(()=>{const t=document.querySelector('[role="tooltip"]'),r=t.getBoundingClientRect();return t.matches(':popover-open') && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===t})()`,'tooltip above native popover');
  await key('Escape');
  await check(`document.querySelector('#modal').open && document.querySelector('#popup').matches(':popover-open') && !(${shown})`,'first Escape dismisses only tooltip');
  await key('Escape');
  await check(`!document.querySelector('#popup').matches(':popover-open')`,'next Escape reaches popover');
  await focus('#select button');
  await check(`document.querySelector('#select button').dataset.tooltip === 'Forwarded hint' && !document.querySelector('#select button').hasAttribute('title')`,'Select forwards title as custom hint');
  await key('ArrowDown'); await key('ArrowDown'); await key('Enter');
  await check(`document.querySelector('#select button').textContent.includes('Beta')`,'Select keyboard selection unchanged');
  await evaluate(`document.querySelector('#modal').close(); document.activeElement?.blur()`);
  await focus('#edge'); await evaluate(`document.querySelector('#edge').dataset.tooltip='Updated hint'`); await delay(50);
  await check(`document.querySelector('[role="tooltip"]').textContent==='Updated hint'`,'dynamic hints update');
  await evaluate(`document.querySelector('#edge').remove()`); await delay(50);
  await check(`!(${shown})`,'removed trigger cleans up');
  await focus('#nav-pages'); await evaluate(`document.querySelector('#nav-pages').dispatchEvent(new Event('scroll'))`);
  await check(`!(${shown})`,'scroll dismisses');
  await evaluate(`document.activeElement.blur(); document.querySelector('#nav-pages').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'touch'})); document.querySelector('#nav-pages').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'})); document.querySelector('#nav-pages').focus()`); await delay(550);
  await check(`!(${shown})`,'touch does not leave sticky hints');
  await key('Tab'); await delay(30);
  await check(shown,'keyboard focus immediately after touch');
  await evaluate(`document.activeElement.blur()`);
  await check(`!(${shown})`,'blur dismisses');
  await hover('#nav-pages'); await key('Escape'); await delay(500);
  await check(`!(${shown})`,'Escape cancels pending hover');
  await delay(200);
  await focus('.search-trigger');
  await click('.search-trigger');
  await check(`!(${shown}) && !!document.querySelector('.palette')`,'click dismisses without blocking control');
  await key('Escape');
  await evaluate(`document.documentElement.dataset.theme='dark'; document.documentElement.dataset.contrast='high'; document.activeElement.blur()`); await focus('.sidebar-toggle');
  await shot('dark-high-contrast');
  await check(`document.querySelector('#website').title==='Host website title'`,'host title preserved');
  await click('[data-collection="blog"]'); await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Test').click()`);
  await check(`document.querySelector('[data-tooltip="Delete post"]').getAttribute('aria-label')==='Delete post'`,'delete retains accessible name');
  await check(`document.querySelectorAll('.rigel [title]:not(iframe)').length===0`,'editor controls have no native hints');
  await click('[data-image-trigger]'); await wait(`!!document.querySelector('.image-dialog[open]')`,'ImagePicker modal');
  await focus('.image-dialog [data-tooltip="Grid view"]');
  await check(`${shown} && document.querySelector('.image-dialog').contains(document.querySelector('[role="tooltip"]'))`,'real ImagePicker hint');
  await shot('image-dialog');
  await click('.image-dialog .close');
  await evaluate(`document.activeElement.blur()`); await delay(750);
  await focus('.search-trigger');
  await evaluate(`window.dispose()`); await delay(50);
  await check(`!(${shown}) && !document.querySelector('[aria-describedby~="rigel-tooltip"]')`,'provider teardown cleans tooltip and ARIA');
  assert.equal(writes,0,'no API mutations'); assert.equal(exceptions.length,0,JSON.stringify(exceptions));
  console.log(`PASS: ${checks} tooltip browser assertions; zero writes; zero runtime exceptions. Screenshots: _temp/tooltips/{light,dark-high-contrast,image-dialog}.png`);
} finally { ws?.close(); chrome?.kill(); await vite?.close(); }
