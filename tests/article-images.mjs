import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/article-images');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/article-images.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = { en: {} };
for (const file of await readdir(path.join(root, 'src/editor/i18n/en'))) if (file.endsWith('.json')) Object.assign(dictionaries.en, JSON.parse(await readFile(path.join(root, 'src/editor/i18n/en', file), 'utf8')));
const virtual = { name: 'article-images-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: ['en'], defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 120; i++) { if (await fn()) return; await delay(100); } throw Error('Timed out: ' + label); }
let vite, chrome, socket, profile, checks = 0;
try {
  await build(options);
  await mkdir(path.join(scratch, 'dist/rigel'), { recursive: true });
  await writeFile(path.join(scratch, 'dist/rigel/media.json'), JSON.stringify({ assets: [{name:'fixture.svg',url:'/fixture.svg',type:'image/svg+xml',alt:'Fixture alt'}, {name:'fixture.mp4',url:'/fixture.mp4',type:'video/mp4'}], writable:false, folder:'media' }));
  await writeFile(path.join(scratch, 'dist/fixture.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="blue"/></svg>');
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port;
  await until(async () => { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; return port; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => reject(Error(method + ' timed out')), 15000); pending.set(key, { resolve, reject, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = expression => until(() => evaluate(expression), expression);
  const click = async expression => {
    const point = await evaluate(`(async()=>{const el=${expression};el.scrollIntoView({block:'center'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    for (const type of ['mouseMoved','mousePressed','mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, ...point, ...(type === 'mouseMoved' ? {} : {button:'left',clickCount:1}) });
    await delay(100);
  };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  const content = `document.querySelector('.block-content')`;
  const body = () => evaluate('window.articleFixture.body().root.children');
  const paragraph = text => ({type:'paragraph',version:1,children:text ? [{type:'text',version:1,text,format:0,detail:0,mode:'normal',style:''}]:[],direction:null,format:'',indent:0,textFormat:0,textStyle:''});
  const before = paragraph('Before'), after = paragraph('After'), empty = paragraph('');
  const reset = async (children, inline = true) => {
    await evaluate(`window.articleFixture.reset(${JSON.stringify(children)},${inline})`);
    await wait(`${content}?.children.length === ${children.length}`);
    await delay(150);
  };
  const select = async index => {
    await click(`${content}.children[${index}]`);
    await evaluate(`(()=>{const root=${content},p=root.children[${index}];root.focus();const s=getSelection();s.selectAllChildren(p);s.collapseToEnd()})()`);
    await delay(150);
  };
  const pick = async (replace = false, video = false) => {
    if (replace) await click(`document.querySelector('[aria-label="Replace image"]')`);
    else {
      await click(`document.querySelector('[data-media-trigger]')`);
      await click(`document.querySelector('.media-menu button:nth-child(${video ? 2 : 1})')`);
    }
    await wait(`!!document.querySelector('dialog[open] .thumb')`);
    await click(`document.querySelector('dialog[open] .thumb')`);
    await click(`document.querySelector('dialog[open] .media-actions button.primary')`);
    await wait(`!document.querySelector('dialog[open]')`);
    await delay(150);
  };
  await wait(`!!${content}`);
  await reset([before, empty, after]);
  const gap = await evaluate(`(()=>{const children=${content}.children,a=children[0].getBoundingClientRect(),b=children[1].getBoundingClientRect();return {x:a.left+20,y:(a.bottom+b.top)/2}})()`);
  await cdp('Input.dispatchMouseEvent', {type:'mouseMoved', ...gap});
  await wait(`!!document.querySelector('.block-insert')`);
  await click(`document.querySelector('.block-insert')`);
  assert.deepEqual(await body(), [before,empty,empty,after], 'plus inserts exactly one empty paragraph'); checks++;
  await pick();
  const inserted = await body();
  assert.deepEqual(inserted.map(n=>n.type), ['paragraph','image','paragraph','paragraph'], 'image replaces plus paragraph without injecting empty neighbors'); checks++;
  assert.deepEqual([inserted[0],inserted[2],inserted[3]], [before,empty,after], 'deliberate empty paragraph and text neighbors survive'); checks++;
  assert.equal(inserted[1].alt,'Fixture alt'); checks++;
  assert.equal(await evaluate(`document.activeElement === ${content}`), true, 'inserted image keeps editor focus'); checks++;
  await click(`document.querySelector('[aria-label="More actions"]')`);
  await click(`document.querySelector('.block-menu .block-history')`);
  assert.deepEqual(await body(), [before,empty,empty,after], 'Undo restores insertion paragraph'); checks++;
  await select(1);
  await click(`document.querySelector('[aria-label="More actions"]')`);
  await click(`document.querySelectorAll('.block-menu .block-history')[1]`);
  assert.deepEqual(await body(), inserted, 'Redo restores exact image sequence'); checks++;
  await cdp('Input.dispatchKeyEvent', {type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await cdp('Input.dispatchKeyEvent', {type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  await cdp('Input.insertText', {text:'Typed'});
  await delay(150);
  assert.equal((await body())[2].children[0].text,'Typed', 'arrow navigation resumes writing in the existing following paragraph'); checks++;

  for (const inline of [true, false]) {
    await reset([before,empty,after], inline);
    await select(1);
    await pick();
    const nodes = await body();
    assert.deepEqual(nodes.map(n=>n.type), ['paragraph','image','paragraph'], `${inline ? 'inline' : 'sidebar'} empty paragraph insertion`); checks++;
    assert.deepEqual([nodes[0],nodes[2]], [before,after]); checks++;
  }
  await reset([before,empty,after], false);
  await select(0);
  await pick();
  const fromText = await body();
  assert.deepEqual(fromText.map(n=>n.type), ['paragraph','image','paragraph','paragraph'], 'nonempty text inserts after rather than replacing or adding a paragraph'); checks++;
  assert.deepEqual([fromText[0],fromText[2],fromText[3]], [before,empty,after]); checks++;
  await click(`${content}.querySelector('img')`);
  await pick();
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','image','image','paragraph','paragraph'], 'main toolbar inserts after selected image'); checks++;

  const linkedImage = {...inserted[1],alt:'Original alt',url:'/original-link'};
  await reset([empty,linkedImage,empty,after], false);
  await click(`${content}.querySelector('img')`);
  await pick(true);
  const replaced = await body();
  assert.deepEqual(replaced.map(n=>n.type), ['paragraph','image','paragraph','paragraph'], 'contextual replacement adds no paragraphs'); checks++;
  assert.equal(replaced[1].url,'/original-link', 'replacement preserves image link'); checks++;
  assert.equal(replaced[1].alt,'Original alt', 'replacement picker prefills existing alt'); checks++;
  assert.deepEqual([replaced[0],replaced[2],replaced[3]], [empty,empty,after], 'replacement preserves deliberate empty neighbors'); checks++;

  await reset([before,paragraph('/image'),after], false);
  await select(1);
  await wait(`document.querySelector('.block-slash').matches(':popover-open')`);
  await click(`[...document.querySelectorAll('.block-slash button')].find(b=>b.textContent==='Image')`);
  await wait(`!!document.querySelector('dialog[open] .thumb')`);
  await click(`document.querySelector('dialog[open] .thumb')`);
  await click(`document.querySelector('dialog[open] .media-actions button.primary')`);
  await wait(`!document.querySelector('dialog[open]')`);
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','image','paragraph'], 'slash image replaces command paragraph without adding another'); checks++;

  await reset([before,empty,after], false);
  await select(1);
  await click(`document.querySelector('.block-add')`);
  await click(`[...document.querySelectorAll('.block-slash button')].find(b=>b.textContent==='Image')`);
  await wait(`!!document.querySelector('dialog[open] .thumb')`);
  await click(`document.querySelector('dialog[open] .thumb')`);
  await click(`document.querySelector('dialog[open] .media-actions button.primary')`);
  await wait(`!document.querySelector('dialog[open]')`);
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','image','paragraph'], 'sidebar Add block reuses selected empty paragraph'); checks++;

  await reset([before,empty,after], false);
  await select(1);
  await pick(false,true);
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','video','paragraph'], 'shared video insertion also replaces the empty paragraph'); checks++;
  await reset([before,empty,after], false);
  await select(1);
  await click(`document.querySelector('[data-media-trigger]')`);
  await click(`document.querySelector('.media-menu button:nth-child(3)')`);
  await wait(`!!document.querySelector('dialog[open] input')`);
  await evaluate(`(()=>{const input=document.querySelector('dialog[open] input');input.value='https://www.youtube.com/watch?v=dQw4w9WgXcQ';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await click(`document.querySelector('dialog[open] button.primary')`);
  await wait(`!document.querySelector('dialog[open]')`);
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','embed','paragraph'], 'shared embed insertion also replaces the empty paragraph'); checks++;
  await reset([before,paragraph(' '),after], false);
  await select(1);
  await pick();
  assert.deepEqual((await body()).map(n=>n.type), ['paragraph','paragraph','image','paragraph'], 'whitespace paragraph is content, not an empty insertion slot'); checks++;
  assert.deepEqual((await body())[1],paragraph(' '), 'intentional whitespace remains byte-equivalent'); checks++;
  await reset([empty], false);
  await select(0);
  await pick();
  assert.deepEqual((await body()).map(n=>n.type), ['image'], 'image at document end does not inject a trailing paragraph'); checks++;
  for (const type of ['keyDown','keyUp']) await cdp('Input.dispatchKeyEvent', {type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await cdp('Input.insertText', {text:'After image'});
  await delay(150);
  const continued = await body();
  assert.deepEqual(continued.map(n=>n.type), ['image','paragraph'], 'Enter creates a paragraph after a final image only on demand'); checks++;
  assert.equal(continued[1].children[0].text,'After image', 'typing works after final image'); checks++;
  await writeFile(path.join(scratch, 'result.json'), JSON.stringify({checks,plusImage:inserted,fromText,replaced,continued},null,2));
  await cdp('Page.captureScreenshot', {format:'png'}).then(result=>writeFile(path.join(scratch,'result.png'),Buffer.from(result.data,'base64')));
  console.log(`Article images: ${checks} Chrome checks passed; ${path.join(scratch,'result.json')}`);
  assert.deepEqual(errors, []);
} finally {
  socket?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once('exit', resolve)); chrome.kill();
    await Promise.race([exited, delay(3000)]);
    if (chrome.exitCode === null) { chrome.kill('SIGKILL'); await Promise.race([exited, delay(3000)]); }
  }
  await vite?.close();
  if (profile) await rm(profile, {recursive:true,force:true});
}
