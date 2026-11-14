import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/richtext-links');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/tests/fixtures/richtext-links.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = { en: {} };
for (const file of await readdir(path.join(root, 'src/editor/i18n/en'))) if (file.endsWith('.json')) Object.assign(dictionaries.en, JSON.parse(await readFile(path.join(root, 'src/editor/i18n/en', file), 'utf8')));
const virtual = { name: 'links-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: ['en'], defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src'), '/tests': path.join(root, 'tests') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 120; i++) { if (await fn()) return; await delay(100); } throw Error('Timed out: ' + label); }
let vite, chrome, socket, checks = 0, fixtureFile, fixtureBytes;
try {
  await build(options);
  const paragraph = '<h2>Heading</h2>\n<p>Before <a href="/old">one <strong>two</strong> <em>three</em> four</a> after <a href="/other">other</a>.</p>';
  await writeFile(path.join(scratch, 'dist/preview.html'), `<html><body style="margin:100px 40px;font:20px/1.7 Georgia"><main data-rigel-doc="page:sample"><div id="copy" data-rigel-doc="page:sample" data-rigel-richtext="copy">${paragraph}</div><div id="legacy" data-rigel-doc="page:sample" data-rigel-richtext="legacy">${paragraph.replace('href="/old"', 'href="/old" title="Title"')}</div></main></body></html>`);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [] });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
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
    const point = await evaluate(`(async()=>{const el=${expression}; el.ownerDocument.defaultView.frameElement?.scrollIntoView({block:'center'}); el.scrollIntoView({block:'center'}); await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); const r=el.getBoundingClientRect(), f=el.ownerDocument.defaultView.frameElement?.getBoundingClientRect();return {x:r.left+r.width/2+(f?.left??0),y:r.top+r.height/2+(f?.top??0)};})()`);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    await delay(100);
  };
  const check = async (expression, label) => { assert.equal(await evaluate(expression), true, label); checks++; };
  const key = async key => { for (const type of ['keyDown', 'keyUp']) await cdp('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: key === 'Escape' ? 27 : 13 }); };
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: origin });
  await wait(`!!document.querySelector('iframe.revealed')`);
  const frame = `document.querySelector('iframe').contentDocument`;
  const copy = `${frame}.querySelector('#copy')`;
  await click(`${copy}.querySelector('em')`);
  await wait(`${copy}.isContentEditable`);
  await wait(`!!${frame}.querySelector('.body-toolbar:not([hidden])')`);
  const surfaces = [
    { doc: frame, content: copy, host: `${frame}.querySelector('.block-editor')`, first: true },
    { doc: 'document', content: `document.querySelector('#markdown .ProseMirror')`, host: `document.querySelector('#markdown')` },
    { doc: 'document', content: `document.querySelector('#blocks .block-content')`, host: `document.querySelector('#blocks')` },
    { doc: frame, content: `${frame}.querySelector('#legacy')`, host: `${frame}.querySelector('.rigel-inline .markdown-editor')` },
  ];
  for (const { doc, content, host, first } of surfaces) {

    const button = label => `${host}.querySelector('[aria-label="${label}"]')`;
    const input = `${host}.querySelector('.markdown-link input')`;
    const linked = `${content}.querySelector('a')`;
    if (!first) await click(`${content}.querySelector('em')`);
    const caret = await evaluate(`(()=>{const s=${doc}.defaultView.getSelection();return [s.anchorNode?.textContent,s.anchorOffset,s.focusNode?.textContent,s.focusOffset]})()`);
    await click(button('Link'));
    await wait(`!!${input}`);
    await check(`${input}.value === '/old'`, 'clicked existing mixed-format link prefills its URL');
    await key('Escape');
    assert.deepEqual(await evaluate(`(()=>{const s=${doc}.defaultView.getSelection();return [s.anchorNode?.textContent,s.anchorOffset,s.focusNode?.textContent,s.focusOffset]})()`), caret, 'cancel preserves caret');
    checks++;
    await check(`[...${content}.querySelectorAll('a[href="/old"]')].map(a=>a.textContent).join('') === 'one two three four'`, 'cancel changes nothing');

    await click(`${content}.querySelector('em')`);
    await click(button('Link'));

    await evaluate(`${input}.value='javascript:alert(1)';${input}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await click(button('Apply link'));
    await check(`${input}.getAttribute('aria-invalid') === 'true' && ${linked}.getAttribute('href') === '/old'`, 'unsafe URLs rejected');
    await evaluate(`${input}.value='/new';${input}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await key('Enter');
    await wait(`${linked}.getAttribute('href') === '/new'`);
    await check(`[...${content}.querySelectorAll('a[href="/new"]')].map(a=>a.textContent).join('') === 'one two three four' && !!${content}.querySelector('strong') && !!${content}.querySelector('em') && !${content}.querySelector('a[href="/old"]') && ${content}.querySelectorAll('a[href="/other"]').length === 1`, 'edit preserves full link, mixed formatting and adjacent link');
    await click(`${content}.querySelector('em')`);
    await click(button('Link'));
    await click(button('Remove link'));
    await wait(`${content}.querySelectorAll('a').length === 1`);
    await check(`${content}.querySelector('p').textContent === 'Before one two three four after other.' && !!${content}.querySelector('strong') && !!${content}.querySelector('em') && ${content}.querySelector('a').getAttribute('href') === '/other'`, 'unlink removes entire link without changing text or formatting');
    const selection = `${doc}.defaultView.getSelection()`;
    await evaluate(`(()=>{const root=${content};root.focus();const node=root.ownerDocument.createTreeWalker(root.querySelector('p'),4).nextNode();const s=${selection};s.setBaseAndExtent(node,0,node,6);})()`);
    await delay(150);
    await click(button('Link'));
    await evaluate(`${input}.value='/inserted';${input}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await key('Enter');
    await wait(`${content}.querySelector('a').getAttribute('href') === '/inserted'`);
    await check(`${content}.querySelector('a').textContent === 'Before'`, 'new links still apply to selected text');
  }
  if (process.env.RIGEL_SITE) {
    fixtureFile = path.join(process.env.RIGEL_SITE, 'src/content/news/launch-week.json');
    fixtureBytes = await readFile(fixtureFile);
    const fixture = JSON.parse(fixtureBytes);
    const text = (text, format = 0) => ({ type: 'text', version: 1, text, format, detail: 0, mode: 'normal', style: '' });
    fixture.body.root.children = [{ type: 'paragraph', version: 1, children: [text('Before '), { type: 'link', version: 1, url: '/old', children: [text('one '), text('two', 1), text(' '), text('three', 2), text(' four')] }, text(' after '), { type: 'link', version: 1, url: '/other', children: [text('other')] }, text('.')], direction: null, format: '', indent: 0, textFormat: 0, textStyle: '' }];
    await writeFile(fixtureFile, JSON.stringify(fixture));
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('rigelcms.settings',JSON.stringify({theme:'light',devMode:true,userPref:{editorExperience:'inline'}}))` });
    const starterUrl = new URL(process.env.RIGEL_URL ?? 'http://127.0.0.1:4322/rigel/');
    starterUrl.hash = '/collections/news/launch-week';
    await cdp('Page.navigate', { url: starterUrl.href });
    await wait(`!!document.querySelector('iframe')?.contentDocument?.querySelector('[data-rigel-richtext="$body"] em')`);
    const region = `${frame}.querySelector('[data-rigel-richtext="$body"]')`;
    await wait(`!!${region}?.querySelector('em')`);
    await click(`${region}.querySelector('em')`);
    await wait(`${region}.isContentEditable`);
    const host = `${frame}.querySelector('.rigel-inline .block-editor')`;
    await wait(`!!${host}?.querySelector('.body-toolbar:not([hidden])')`);
    await click(`${host}.querySelector('[aria-label="Link"]')`);
    const input = `${host}.querySelector('.markdown-link input')`;
    await wait(`!!${input}`);
    await check(`${input}.value === '/old'`, 'starter first click opens current URL in source-linked editor');
    await evaluate(`${input}.value='/starter-edit';${input}.dispatchEvent(new Event('input',{bubbles:true}))`);
    await key('Enter');
    await wait(`${region}.querySelector('a').getAttribute('href') === '/starter-edit'`);
    await check(`${region}.querySelector('a').textContent === 'one two three four' && !!${region}.querySelector('strong') && !!${region}.querySelector('em')`, 'starter edits the existing link without replacing linked text');
    assert.deepEqual(await readFile(fixtureFile), Buffer.from(JSON.stringify(fixture)), 'draft edit does not save');
    checks++;
    console.log('Starter preview:', await evaluate('location.href'));
  }
  assert.deepEqual(errors, []);
  await cdp('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(path.join(scratch, 'result.png'), Buffer.from(result.data, 'base64')));
  console.log(`Rich-text links: ${checks} browser checks passed; ${path.join(scratch, 'result.png')}`);
} finally {
  socket?.close(); chrome?.kill(); await vite?.close();
  if (fixtureBytes) {
    await writeFile(fixtureFile, fixtureBytes);
    assert.deepEqual(await readFile(fixtureFile), fixtureBytes, 'starter fixture restored byte-for-byte');
  }
}
