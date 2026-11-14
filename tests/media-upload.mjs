import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { compile } from 'svelte/compiler';

const root = fileURLToPath(new URL('../', import.meta.url));
const component=compile(await readFile(path.join(root,'src/editor/lib/ImagePicker.svelte'),'utf8'),{filename:'ImagePicker.svelte',generate:'client'});
assert.deepEqual(component.warnings.filter(w=>w.code.startsWith('a11y')),[],'picker has no accessibility compiler warnings');
const scratch = path.join(root, '_temp/media-upload');
const publicDir = path.join(scratch, 'public');
await mkdir(path.join(publicDir, 'rigel-media'), { recursive: true });
await writeFile(path.join(publicDir, 'rigel-media/picture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9L8AAAAASUVORK5CYII=', 'base64'));
const baseline = await readFile(path.join(publicDir, 'rigel-media/picture.png'));
await writeFile(path.join(scratch, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/media-upload.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = { en: {}, fr: {} };
for (const locale of Object.keys(dictionaries)) {
  const { readdir } = await import('node:fs/promises');
  for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
}
const demoMode=process.env.RIGEL_UPLOAD_DEMO==='1';
const config = { backend: demoMode ? 'demo' : 'local', maxFileSize: 256 * 1024, publicDir: pathToFileURL(publicDir + '/').href, languages: ['en', 'fr'], defaultLanguage: 'en', imageProcessing: {convertHeic:true,resize:false,quality:85,maxEdge:640} };
const virtual = { name: 'image-processing-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? config : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await delay(100); } throw new Error('Timed out: ' + label); }

const heicPath=path.join(scratch,'example.heic');
let heic;
try {heic=await readFile(heicPath);} catch {const response=await fetch('https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic');assert.ok(response.ok);heic=Buffer.from(await response.arrayBuffer());await writeFile(heicPath,heic);}
const {createHash}=await import('node:crypto');
assert.equal(createHash('sha256').update(heic).digest('hex'),'7f8b363e4936c0666a25f64f3a92fda10bd8e5453be4592530b65a55dd98f3f2');
await writeFile(path.join(publicDir,'example.heic'),heic);

let vite, chrome, ws, profile, uploads = 0, postDelay = 0, activePosts = 0, maxPosts = 0, readOnly = false, failMetadata = false, failDelete = false;
const contentWrites=[];
const exceptions = [];
try {
  if (!process.env.RIGEL_IMAGE_SOURCE) await build(options);
  process.env.NODE_ENV = 'development';
  vite = await createServer({ ...options, root: process.env.RIGEL_IMAGE_SOURCE ? scratch : path.join(scratch, 'dist'), plugins: [virtual, svelte(), { name: 'real-media-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.method !== 'GET' && req.url !== '/rigel/api/local/media') {contentWrites.push(req.url);res.statusCode=500;res.end('Unexpected content write');return;}
      if (!['/rigel/media.json', '/rigel/api/local/media'].includes(req.url) && !req.url.startsWith('/rigel-media/')) return next();
      try {
        const module = await server.ssrLoadModule(path.join(root, req.url === '/rigel/media.json' ? 'src/routes/media.json.ts' : 'src/routes/local-media.ts'));
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        if (req.method === 'POST') { uploads++; activePosts++; maxPosts=Math.max(maxPosts,activePosts); await delay(postDelay); }
        if (req.method === 'PUT' || req.method === 'DELETE') {
          await delay(500);
          if (req.method === 'PUT' ? failMetadata : failDelete) { res.statusCode=503; res.end('Simulated media write failure'); return; }
        }
        const request = new Request(`http://${req.headers.host}${req.url}`, { method: req.method, headers: req.headers, ...(req.method === 'GET' ? {} : { body: Buffer.concat(chunks) }) });
        let response = await module[req.method]({ request, params: { filename: req.url.split('/').pop() } });
        if (req.method === 'POST') activePosts--;
        if (readOnly && req.url==='/rigel/media.json') {const data=await response.json(); response=Response.json({...data,writable:false});}
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
  if (demoMode) {
    await wait(`!!document.querySelector('.titlebar button') && document.querySelector('.titlebar button').disabled`, 'demo disabled');
    assert.equal(await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['demo'],'demo.txt',{type:'text/plain'}));const event=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt});document.querySelector('.media-library').dispatchEvent(event);return event.defaultPrevented;})()`),true);
    await delay(300);assert.equal(uploads,0);assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="progress"]')`),false);
    console.log('PASS: demo drop prevents navigation and performs no writes');
  } else {
  await wait(`!!document.querySelector('.titlebar button') && !document.querySelector('.titlebar button').disabled`, 'mounted writable library');
  assert.equal(await evaluate(`(() => { const main = document.querySelector('main'), library = document.querySelector('.media-library'), hint = document.querySelector('.media-drop-hint'), m = main.getBoundingClientRect(), r = library.getBoundingClientRect(), h = hint.getBoundingClientRect(); return m.height >= innerHeight && r.bottom >= innerHeight - 1 && r.left === m.left && r.right === m.right && getComputedStyle(hint).position === 'absolute' && h.bottom <= r.bottom && r.bottom - h.bottom <= 32 && r.right - h.right <= 32 && document.elementFromPoint(r.right - 8, Math.min(innerHeight - 8, r.bottom - 8))?.closest('.media-library') === library; })()`), true, 'whole Media pane is a full-height drop target with a bottom-right hint');
  for (const width of [1280, 390, 320]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate(`(async () => { const target = document.elementFromPoint(innerWidth - 8, innerHeight - 8), library = document.querySelector('.media-library'), hint = document.querySelector('.media-drop-hint'), dt = new DataTransfer(); dt.items.add(new File(['test'], 'test.txt', { type: 'text/plain' })); if (target?.closest('.media-library') !== library) return false; target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })); const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }); target.dispatchEvent(over); await new Promise(requestAnimationFrame); const active = library.classList.contains('media-dragging'); target.dispatchEvent(new DragEvent('dragleave', { bubbles: true, dataTransfer: dt })); const r = library.getBoundingClientRect(), h = hint.getBoundingClientRect(); return over.defaultPrevented && active && r.bottom >= innerHeight && r.bottom - h.bottom <= 32 && r.right - h.right <= 32 && h.width <= r.width && h.top >= document.querySelector('.media-library .grid').getBoundingClientRect().bottom; })()`), true, `${width}px blank bottom area accepts files and hint stays below content`);
    await writeFile(path.join(scratch, `library-empty-${width}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await evaluate(`document.querySelector('.titlebar button').focus()`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r'});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await wait(`!!document.querySelector('dialog[open] input[type=file]')`, 'keyboard-opened file chooser');
  assert.equal(await evaluate(`document.querySelector('dialog[open] input[type=file]').multiple`), true, 'standalone library supports multiple selection');
  await evaluate(`(() => {const input=document.querySelector('dialog[open] input[type=file]'), dt=new DataTransfer(); for(const name of ['one.txt','one.txt'])dt.items.add(new File(['hello '+name],name,{type:'text/plain'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`[...document.querySelectorAll('.toast[data-kind="info"]')].some(el=>el.textContent.includes('2 uploaded, 0 failed (2 files)'))`, 'two immediate uploads');
  assert.equal(uploads,2);
  assert.equal(await evaluate(`document.querySelectorAll('.toast[data-kind="success"]').length>=2`),true,'verified uploads produce per-file success toasts');
  const ledger=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));
  assert.equal(Object.keys(ledger).length,2,'identical files receive independent uploads without deduplication');
  for(const [url,meta] of Object.entries(ledger)) {const bytes=await readFile(path.join(publicDir,url));assert.equal(bytes.toString(),'hello '+meta.name);assert.deepEqual(Buffer.from(await (await fetch(origin+url)).arrayBuffer()),bytes);}
  console.log('PASS: multi-selection immediate uploads, real disk/ledger/served bytes');
  const drag = async (type, names = [], selector = '.media-library', text = false) => evaluate(`(() => {const dt=new DataTransfer(); ${text ? "dt.setData('text/uri-list','https://example.org')" : `for(const name of ${JSON.stringify(names)})dt.items.add(new File(['hello '+name],name,{type:'text/plain'}))`}; const event=new DragEvent(${JSON.stringify(type)},{bubbles:true,cancelable:true,dataTransfer:dt});document.querySelector(${JSON.stringify(selector)}).dispatchEvent(event);return event.defaultPrevented;})()`);
  assert.equal(await drag('dragover',[],'.media-library',true),false,'link drag not hijacked');
  assert.equal(await drag('dragenter',['drop.txt']),true);
  await wait(`!!document.querySelector('.media-dragging')`,'file drag highlight');
  await writeFile(path.join(scratch,'library-drag.png'),Buffer.from((await cdp('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await drag('dragleave',['drop.txt']);
  await wait(`!document.querySelector('.media-dragging')`,'leave clears highlight');
  await drag('dragenter',['invalid.exe','drop.txt']);
  await evaluate(`(()=>{const input=document.querySelector('.media-search');input.value='one.txt';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.titlebar button');
  await wait(`!!document.querySelector('dialog[open] input[type=file]')`,'standalone source dialog');
  assert.equal(await evaluate(`!!document.querySelector('dialog [data-source="picsum"]')`),true,'stock wizard retained');
  assert.equal(await drag('drop',['invalid.exe','invalid.png','drop.txt'],'dialog[open]'),true,'dialog drop prevents navigation');
  await wait(`[...document.querySelectorAll('.toast[data-kind="info"]')].some(el=>el.textContent.includes('1 uploaded, 2 failed (3 files)')) && document.querySelectorAll('.toast[data-kind="error"]').length===2`,'invalid file does not stop valid drop');
  assert.equal(await evaluate(`!!document.querySelector('.media-dragging')`),false);
  assert.equal(await evaluate(`document.querySelector('.media-search').value`),'one.txt','queue preserves filters');
  await evaluate(`(()=>{const input=document.querySelector('.media-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  postDelay=800;
  await drag('drop',['serial-one.txt','serial-two.txt']);
  await wait(`[...document.querySelectorAll('.toast[data-kind="progress"]')].some(el=>el.textContent.includes('Uploading 2 files') && el.textContent.includes('0 of 2 files completed'))`,'visible uploading and queued states');
  const progressId=await evaluate(`document.querySelector('.toast[data-kind="progress"]').dataset.toastId`);
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].some(el=>el.textContent.includes('serial-one.txt'))`),false,'no upload success before real write acknowledgement');
  await drag('drop',['invalid-added.exe','added-while-running.txt']);
  await wait(`document.querySelector('.toast[data-kind="progress"]')?.textContent.includes('Uploading 4 files')`,'running batch total includes added files');
  assert.equal(await evaluate(`document.querySelector('.toast[data-kind="progress"]').dataset.toastId`),progressId,'same progress toast updates');
  await wait(`document.querySelector('.toast[data-kind="progress"]')?.textContent.includes('1 of 4 files completed')`,'real completed count advances');
  await wait(`[...document.querySelectorAll('.toast[data-kind="info"]')].some(el=>el.textContent.includes('3 uploaded, 1 failed (4 files)'))`,'files added during queue run complete');
  assert.equal(maxPosts,1,'one serial worker');
  assert.equal(uploads,7,'invalid extension rejected locally; invalid image bytes rejected by real backend without stopping queue');
  await wait(`document.querySelectorAll('.media-library figure').length===7`,'completed batch refresh');
  const all=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));
  assert.equal(Object.keys(all).length,6);
  for(const [url,meta] of Object.entries(all)){const bytes=await readFile(path.join(publicDir,url));assert.equal(bytes.toString(),'hello '+meta.name);assert.deepEqual(Buffer.from(await (await fetch(origin+url)).arrayBuffer()),bytes);}
  await click('.media-library .thumb');
  await wait(`!!document.querySelector('dialog[open] .media-path')`,'stored file details');
  assert.equal(await evaluate(`document.querySelector('.media-path').getAttribute('role')`),'textbox');
  assert.equal(await evaluate(`document.querySelector('.media-path').getAttribute('aria-readonly')`),'true');
  assert.ok(await evaluate(`document.querySelector('.media-path').textContent.startsWith('/rigel-media/')`));
  const metadataUrl=await evaluate(`document.querySelector('.media-path').textContent`);
  await evaluate(`(()=>{const input=document.querySelector('input[aria-label="Media title"]');input.value='Verified metadata';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  failMetadata=true;
  await click('dialog .media-button-actions button.primary');
  await wait(`[...document.querySelectorAll('.toast[data-kind="error"]')].some(el=>el.textContent.includes('Metadata save failed'))`,'metadata failure stays visible');
  assert.equal(await evaluate(`document.querySelector('input[aria-label="Media title"]').value`),'Verified metadata','metadata draft preserved for retry');
  await delay(6200);
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="error"]')].some(el=>el.textContent.includes('Metadata save failed'))`),true,'metadata errors persist');
  failMetadata=false;
  await click('dialog .media-button-actions button.primary');
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].some(el=>el.textContent.includes('Metadata saved.'))`),false,'metadata success waits for acknowledged write');
  await wait(`[...document.querySelectorAll('.toast[data-kind="success"]')].some(el=>el.textContent.includes('Metadata saved.'))`,'verified metadata save uses reusable toast');
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="error"]')].some(el=>el.textContent.includes('Metadata save failed'))`),false,'metadata retry resolves previous error');
  const metadataLedger=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));
  assert.equal(metadataLedger[metadataUrl].title,'Verified metadata');
  all[metadataUrl]=metadataLedger[metadataUrl];
  await click('dialog .close');
  for(const width of [1280,390,320]) {
    await cdp('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
    for(const theme of ['light','dark']) {
      await evaluate(`document.documentElement.dataset.theme='${theme}'`);
      await delay(300);
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),true,`${width} ${theme} no overflow`);
      const {cssContentSize}=await cdp('Page.getLayoutMetrics');
      await writeFile(path.join(scratch,`library-${width}-${theme}.png`),Buffer.from((await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:cssContentSize.width,height:cssContentSize.height,scale:1}})).data,'base64'));
    }
  }
  await cdp('Emulation.clearDeviceMetricsOverride');
  await click('[data-picker="image"] button.outlined');
  await wait(`!!document.querySelector('dialog[open]')`,'content image picker');
  await click('dialog [data-source="upload"]');
  await wait(`!!document.querySelector('dialog input[type=file]')`,'content image upload input');
  assert.equal(await evaluate(`document.querySelector('dialog input[type=file]').multiple`),false,'content picker stays single');
  const beforePicker=uploads;
  await evaluate(`(async()=>{const dt=new DataTransfer();dt.items.add(new File([await (await fetch('/rigel-media/picture.png')).blob()],'staged.png',{type:'image/png'}));const input=document.querySelector('dialog input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`!!document.querySelector('dialog .media-preview img')`,'staged image preview');
  assert.equal(uploads,beforePicker,'no early content-picker write');
  await click('dialog .close');
  assert.equal(uploads,beforePicker,'cancel does not write');
  for(const kind of ['file','video']) {
    await click(`[data-picker="${kind}"] button.outlined`);
    await wait(`!!document.querySelector('dialog[open] [data-source="upload"]')`,`${kind} picker mounted`);
    await click('dialog [data-source="upload"]');
    await wait(`!!document.querySelector('dialog input[type=file]')`,`${kind} input`);
    assert.equal(await evaluate(`document.querySelector('dialog input[type=file]').multiple`),false);
    await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['staged'],'staged.${kind==='file'?'txt':'mp4'}',{type:'${kind==='file'?'text/plain':'video/mp4'}'}));const input=document.querySelector('dialog input[type=file]');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await wait(`!!document.querySelector('dialog .media-preview')`,`${kind} staged preview`);
    assert.equal(uploads,beforePicker);
    await click('dialog .close');assert.equal(uploads,beforePicker);
  }
  const beforeReload=await evaluate('performance.timeOrigin');
  await cdp('Page.reload');
  await wait(`performance.timeOrigin!==${beforeReload} && document.querySelectorAll('.media-library figure').length===7`,'uploads survive reload');
  assert.equal(await evaluate(`document.querySelectorAll('.toast').length`),0,'reload does not replay upload notifications');
  assert.deepEqual(JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8')),all);
  readOnly=true;
  await click('.media-tools > button');
  await wait(`document.querySelector('.titlebar button').disabled`,'read-only library');
  assert.equal(await drag('drop',['read-only.txt']),true,'read-only drop prevents navigation');
  await delay(400); assert.equal(uploads,beforePicker,'read-only no writes');
  readOnly=false;
  await click('.media-tools > button');
  await wait(`!document.querySelector('.titlebar button').disabled`,'writable restored');
  await evaluate(`(async()=>{
    const stored=JSON.parse(localStorage.getItem('rigelcms.settings')||'{}');stored.imageProcessing={convertHeic:true,resize:true,maxEdge:160,quality:85};localStorage.setItem('rigelcms.settings',JSON.stringify(stored));
    const canvas=document.createElement('canvas');canvas.width=canvas.height=800;const ctx=canvas.getContext('2d');const image=ctx.createImageData(800,800);for(let i=0;i<image.data.length;i+=65536)crypto.getRandomValues(image.data.subarray(i,Math.min(i+65536,image.data.length)));ctx.putImageData(image,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(blob.size<=262144)throw Error('source must exceed storage limit');window.largeSourceSize=blob.size;
    const dt=new DataTransfer();dt.items.add(new File([await(await fetch('/example.heic')).blob()],'queue.heic',{type:'image/heic'}));dt.items.add(new File([blob],'large.png',{type:'image/png'}));document.querySelector('.media-library').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
  })()`);
  await wait(`[...document.querySelectorAll('.toast[data-kind="info"]')].some(el=>el.textContent.includes('2 uploaded, 0 failed (2 files)'))`,'queued HEIC conversion and oversize source resize');
  const processed=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));
  for(const name of ['queue.webp','large.png']) {
    const entry=Object.entries(processed).find(([,meta])=>meta.name===name);assert.ok(entry,name);
    const [url]=entry, bytes=await readFile(path.join(publicDir,url));assert.ok(bytes.length<=262144);assert.deepEqual(Buffer.from(await(await fetch(origin+url)).arrayBuffer()),bytes);
    const dimensions=await evaluate(`(async()=>{const img=new Image();img.src=${JSON.stringify(url)};await img.decode();return [img.naturalWidth,img.naturalHeight];})()`);assert.equal(Math.max(...dimensions),160);
    if(name.endsWith('webp')){assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');}
  }
  assert.equal(uploads,beforePicker+2);
  await drag('drop',['reset-flight.txt','reset-queued.txt']);
  await until(()=>uploads===beforePicker+3,'request before connection reset');
  await click('[data-reset]');
  await delay(800);
  assert.equal(uploads,beforePicker+3,'connection reset stops unstarted queue');
  assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="progress"]')`),false,'reset discards stale results');
  await wait(`!document.querySelector('.titlebar button').disabled`,'verified context refresh');
  await drag('drop',['in-flight.txt','unstarted.txt']);
  await until(()=>uploads===beforePicker+4,'first request in flight');
  await click('[data-unmount]');
  await delay(800);
  assert.equal(uploads,beforePicker+4,'unmount stops unstarted work without pretending to cancel in-flight write');
  const afterUnmount=await until(async()=>{const ledger=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));return Object.keys(ledger).length===10 ? ledger : false;},'already-sent writes finish after unmount');
  assert.equal(Object.keys(afterUnmount).length,10);
  assert.ok(!Object.values(afterUnmount).some(meta=>['unstarted.txt','reset-queued.txt'].includes(meta.name)));
  await click('[data-unmount]');
  await wait(`!!document.querySelector('.media-library .thumb[aria-label="drop.txt"]')`,'library remount');
  await click('.media-library .thumb[aria-label="drop.txt"]');
  await wait(`!!document.querySelector('dialog[open] .danger-btn')`,'delete target preview');
  const deleteUrl=await evaluate(`document.querySelector('.media-path').textContent`);
  await click('dialog[open] .danger-btn');
  await wait(`!!document.querySelector('.action-dialog[open]')`,'explicit delete confirmation');
  assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="success"]')`),false,'no fabricated deletion success before confirmation');
  failDelete=true;
  await click('.action-dialog button[type="submit"]');
  await wait(`!!document.querySelector('.action-dialog .error')`,'delete failure keeps confirmation retryable');
  assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="success"]')`),false,'failed delete never reports success');
  assert.ok(await readFile(path.join(publicDir,deleteUrl)));
  failDelete=false;
  await click('.action-dialog button[type="submit"]');
  assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="success"]')`),false,'deletion success waits for backend');
  await wait(`!document.querySelector('.action-dialog')`,'delete completes');
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].some(el=>el.textContent.includes('File deleted.'))`),true,'verified deletion produces shared toast');
  const deletedLedger=JSON.parse(await readFile(path.join(publicDir,'rigel-media/.rigel-media.json'),'utf8'));
  assert.equal(Object.hasOwn(deletedLedger,deleteUrl),false);
  await assert.rejects(readFile(path.join(publicDir,deleteUrl)),{code:'ENOENT'});
  await drag('drop',Array.from({length:20},(_,i)=>`${i}-${'long-name-'.repeat(20)}.exe`));
  await wait(`document.querySelectorAll('.toast[data-kind="error"]').length===20`,'all per-file errors retained in bounded stack');
  assert.equal(await evaluate(`(()=>{const host=document.querySelector('.toast-stack'),r=host.getBoundingClientRect();return host.scrollHeight>host.clientHeight && r.height<=innerHeight*.4+1 && [...host.querySelectorAll('.toast')].every(el=>el.scrollWidth<=el.clientWidth);})()`),true,'large batch is scroll capped without losing or overflowing error text');
  await evaluate(`document.querySelector('.toast[data-kind="error"]:last-child > button').focus()`);
  await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r'});
  await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  await wait(`document.querySelectorAll('.toast[data-kind="error"]').length===19`,'keyboard dismisses error');
  await click('.media-library .thumb[aria-label="serial-one.txt"]');
  await wait(`!!document.querySelector('dialog[open] .media-button-actions button.primary')`,'metadata before teardown');
  await click('dialog .media-button-actions button.primary');
  await wait(`!!document.querySelector('.toast[data-kind="progress"]')`,'metadata save in flight');
  await click('[data-unmount]');
  await delay(100);
  assert.equal(await evaluate(`!!document.querySelector('.toast[data-kind="progress"]')`),false,'teardown removes stale metadata progress immediately');
  await delay(700);
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].some(el=>el.textContent.includes('Metadata saved.'))`),false,'stale metadata completion never announces success');
  await click('[data-unmount]');
  await wait(`!!document.querySelector('.media-library .thumb[aria-label="serial-two.txt"]')`,'library restored for delete teardown');
  await click('.media-library .thumb[aria-label="serial-two.txt"]');
  await wait(`!!document.querySelector('dialog[open] .danger-btn')`,'delete teardown target');
  const priorSuccess=await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].map(el=>el.dataset.toastId)`);
  await click('dialog[open] .danger-btn');
  await wait(`!!document.querySelector('.action-dialog[open]')`,'delete teardown confirmation');
  await click('.action-dialog button[type="submit"]');
  await click('[data-unmount]');
  await delay(800);
  assert.equal(await evaluate(`[...document.querySelectorAll('.toast[data-kind="success"]')].every(el=>${JSON.stringify(priorSuccess)}.includes(el.dataset.toastId))`),true,'stale deletion completion never notifies a new context');
  assert.deepEqual(await readFile(path.join(publicDir,'rigel-media/picture.png')),baseline);
  assert.deepEqual(exceptions,[]);
  assert.deepEqual(contentWrites,[],'media queue never saves content');
  console.log('PASS: drop/highlight/filtering, serial queue additions/failure recovery, picker staging/cancel, reload, read-only, unmount, light/dark 1280/390/320 geometry');

  }
} finally {
  ws?.close();
  if (chrome && chrome.exitCode === null) { const exited = once(chrome, 'exit'); chrome.kill(); await exited; }
  await vite?.close();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await rm(publicDir, { recursive: true, force: true });
}