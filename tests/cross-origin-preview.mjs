import assert from 'node:assert/strict';
import { createServer as httpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/cross-origin-preview');
await mkdir(scratch, { recursive: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 200; i++) { const result = await fn(); if (result) return result; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
const requests = [];
let failure = '';
let writes = 0;
const article = JSON.parse(await readFile(path.join(root, 'tests/fixtures/site/src/content/blog/first-post.json'), 'utf8'));
const html = `<!doctype html><html><head><base href="https://wrong.invalid/"><meta http-equiv="refresh" content="0;url=https://wrong.invalid/"><link rel="stylesheet" href="/styles.css"><style>body { min-height: 2000px }</style><script>parent.previewScriptRan = true</script></head><body onload="parent.previewScriptRan=true"><h1 data-rigel-doc="page:about" data-rigel-text="title">Deployed title</h1><h2 data-rigel-text="intro.title">Deployed copy</h2><div data-rigel-richtext="$body"><p>Deployed body</p></div><img src="/pixel.svg" data-rigel-image="image" onerror="parent.previewScriptRan=true"><a href="/escape/">Leave preview</a><form action="/escape/"><button>Submit</button></form><iframe src="/escape/"></iframe><object data="/escape/"></object><template data-rigel-item-template=""><p data-rigel-text="items.__item__.title"></p></template></body></html>`;
function fixture(req, res) {
  requests.push({ url: req.url, headers: req.headers });
  if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end('h1 { color: rgb(12, 34, 56) }'); return; }
  if (req.url === '/pixel.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'); return; }
  if (failure !== 'cors') res.setHeader('Access-Control-Allow-Origin', '*');
  if (failure === 'redirect') { res.writeHead(302, { Location: '/redirected/' }); res.end(); return; }
  if (failure === '404') { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('Missing route'); return; }
  res.setHeader('Content-Type', failure === 'type' ? 'text/plain' : 'text/html');
  res.end(failure === 'anchors' ? '<html><body><h1>Unprepared but visible</h1></body></html>' : sameOrigin ? html.replace(/<base[^>]+>|<meta[^>]+>/g, '') : html);
}
const remote = httpServer(fixture);
await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
const draftOrigin = `http://127.0.0.1:${remote.address().port}`;
let sameOrigin = false;
function manifest() {
  return {
    pages: [{ slug: 'copy', label: 'Copy fixture', groups: [{ id: 'intro', label: 'Intro', fields: [{ key: 'title', label: 'Copy title', type: 'string' }] }], values: { intro: { title: 'Saved copy' } } }],
    schema: { objects: [], documents: [{ name: 'page', title: 'Pages', type: 'document', folder: 'content/pages', fields: [{ key: 'title', label: 'Title', type: 'string' }] }] },
    documents: [{ id: 'page:about', type: 'page', slug: 'about', data: { title: 'Saved title', image: '/pixel.svg' } }],
    collections: [{ name: 'blog', label: 'Blog', fields: [{ key: 'title', label: 'Title', type: 'string' }], posts: [{ slug: 'first-post', ...article }] }],
    preview: { liveUrl: 'https://sunnypixels.io', ...(sameOrigin ? {} : { draftUrl: draftOrigin }), documents: { page: { url: '/page/{slug}/' } }, pages: { copy: '/copy/' }, collections: { blog: { url: '/blog/{slug}/', new: '/preview/blog/' } } },
  };
}
await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; mount(App, { target: document.getElementById('app') });`);
const options = {
  configFile: false, root: scratch, logLevel: 'warn', plugins: [svelte()],
  resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] },
  build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true },
  server: { host: '127.0.0.1', port: 0, fs: { allow: [root] }, watch: { ignored: ['**/_temp/**'] } },
};
let vite, chrome, ws;
const exceptions = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [{ name: 'preview-fixture', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/rigel/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest())); }
      else if (req.url?.startsWith('/rigel/api/local/')) { writes++; res.end('{}'); }
      else if (/^\/(?:page|copy|blog|preview)\//.test(req.url ?? '')) fixture(req, res);
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
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    const entry = pending.get(message.id); if (entry) { pending.delete(message.id); message.error ? entry.reject(message.error) : entry.resolve(message.result); }
  });
  function cdp(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }); }
  async function evaluate(expression) {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const button = text => evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const input = (selector, text) => evaluate(`{const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true }));}`);
  const wait = (expression, label) => until(() => evaluate(expression), label);
  async function open() {
    await cdp('Page.navigate', { url: origin });
    await wait(`!!document.querySelector('#nav-pages')`, 'editor navigation');
  }
  async function page() { await click('#nav-pages'); await evaluate(`[...document.querySelectorAll('main tbody tr')].find(row => [...row.querySelectorAll('td')].some(td => td.textContent.trim() === 'about')).querySelector('button').click()`); }
  const frameDoc = `document.querySelector('iframe')?.contentDocument`;
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await open();
  await evaluate(`sessionStorage.setItem('preview-test-token','never-send-this'); document.cookie='preview-test-cookie=never-send-this; path=/'; localStorage.setItem('rigelcms.settings',JSON.stringify({userPref:{editorExperience:'inline'}}))`);
  await open();
  await page();
  await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`, 'cross-origin prepared visual editor');
  assert.equal(await evaluate(`document.querySelector('.visual-live').href`), 'https://sunnypixels.io/page/about/');
  assert.equal(await evaluate(`${frameDoc}.querySelector('h1').textContent`), 'Saved title');
  assert.equal(await evaluate(`${frameDoc}.baseURI`), `${draftOrigin}/page/about/`);
  assert.equal(await evaluate(`${frameDoc}.querySelector('template').content.querySelector('p').dataset.rigelText`), 'items.__item__.title');
  await wait(`${frameDoc}.defaultView.getComputedStyle(${frameDoc}.querySelector('h1')).color === 'rgb(12, 34, 56)'`, 'remote CSS');
  await wait(`${frameDoc}.querySelector('img').naturalWidth === 8`, 'remote image');
  assert.equal(await evaluate(`!!window.previewScriptRan`), false);
  assert.equal(await evaluate(`${frameDoc}.querySelectorAll('script,iframe,object,form,[onload],[onerror]').length`), 0);
  assert.equal(await evaluate(`${frameDoc}.querySelectorAll('base').length`), 1);
  assert.equal(await evaluate(`${frameDoc}.querySelectorAll('meta[http-equiv="refresh"]').length`), 0);
  assert.equal(await evaluate(`document.querySelector('iframe').getAttribute('sandbox')`), 'allow-same-origin');
  await evaluate(`window.originalPreviewDoc=${frameDoc}; ${frameDoc}.defaultView.scrollTo(0,150)`);
  const count = requests.length;
  await input('[data-schema-path="title"] input', 'Unsaved cross-origin title');
  await wait(`${frameDoc}.querySelector('h1').textContent === 'Unsaved cross-origin title'`, 'unsaved patch');
  assert.equal(await evaluate(`${frameDoc} === window.originalPreviewDoc`), true);
  assert.equal(await evaluate(`${frameDoc}.defaultView.scrollY`), 150);
  await evaluate(`${frameDoc}.querySelector('h1').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}))`);
  await wait(`!!document.querySelector('.inline-editor')`, 'inline text edit');
  await input('.inline-editor', 'Inline draft');
  await wait(`${frameDoc}.querySelector('h1').textContent === 'Inline draft'`, 'inline draft patch');
  await evaluate(`document.querySelector('.inline-editor').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await evaluate(`${frameDoc}.querySelector('a').click()`);
  await delay(250);
  assert.equal(await evaluate(`${frameDoc} === window.originalPreviewDoc`), true);
  assert.equal(requests.length, count, 'text editing must not refetch HTML/assets or navigate');
  assert.equal(writes, 0, 'no autosave');
  await cdp('Page.captureScreenshot').then(r => writeFile(path.join(scratch, 'cross-origin.png'), Buffer.from(r.data, 'base64')));
  await click('.brand'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`, 'unsaved guard');
  await button('Keep editing'); await wait(`!document.querySelector('.unsaved-dialog[open]')`, 'keep editing');
  assert.equal(await evaluate(`${frameDoc}.querySelector('h1').textContent`), 'Inline draft');
  await click('.brand'); await button('Discard changes');
  await wait(`!!document.querySelector('.welcome')`, 'discard navigation');
  await page(); await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`, 'page reopened');
  assert.equal(await evaluate(`${frameDoc}.querySelector('h1').textContent`), 'Saved title');
  await input('[data-schema-path="title"] input', 'Explicit saved title');
  await click('.save-button'); await wait(`document.querySelector('.save-button')?.disabled`, 'explicit Save settled');
  assert.equal(writes, 1, 'only explicit Save writes');
  assert(requests.every(r => !r.headers.authorization && !r.headers.referer), 'remote receives no token or referrer');
  assert(requests.filter(r => r.url.startsWith('/page/')).every(r => !r.headers.cookie), 'HTML fetch omits cookies');
  await click('.brand'); await click('#nav-pages'); await button('Copy fixture');
  await wait(`${frameDoc}?.querySelector('h2')?.textContent === 'Saved copy'`, 'legacy SitePreview cross-origin');
  assert.equal(await evaluate(`document.querySelector('.visual-live').href`), 'https://sunnypixels.io/copy/');
  await input('main input[type="text"]', 'Unsaved copy');
  await wait(`${frameDoc}.querySelector('h2').textContent === 'Unsaved copy'`, 'legacy unsaved patch');
  await click('.brand'); await button('Discard changes');
  await click('[data-collection="blog"]'); await button(article.frontmatter.title);
  await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`, 'article cross-origin');
  assert.equal(await evaluate(`document.querySelector('.visual-live').href`), 'https://sunnypixels.io/blog/first-post/');
  const articleRequests = requests.length;
  await evaluate(`${frameDoc}.querySelector('[data-rigel-richtext="$body"] p').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))`);
  await wait(`${frameDoc}.querySelector('[data-rigel-richtext="$body"]')?.getAttribute('contenteditable') === 'true'`, 'inline article body editor');
  await cdp('Input.insertText', { text: 'Unsaved inline body ' });
  await wait(`${frameDoc}.querySelector('[data-rigel-richtext="$body"]').textContent.includes('Unsaved inline body')`, 'inline body typing');
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), false);
  assert.equal(requests.length, articleRequests, 'inline body must not refetch the page');
  assert.equal(writes, 1, 'inline body does not autosave');
  await click('.brand'); await button('Discard changes');
  await click('[data-collection="blog"]'); await button('Add new');
  await input('.action-dialog input', 'New remote article'); await button('Create draft');
  await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`, 'new article template');
  assert.equal(await evaluate(`${frameDoc}.baseURI`), `${draftOrigin}/preview/blog/`);
  assert.equal(await evaluate(`document.querySelector('.visual-live').href`), 'https://sunnypixels.io/blog/new-remote-article/');
  assert.equal(writes, 1, 'new article preview does not write');
  await click('.brand'); await button('Discard changes');
  for (const [mode, message] of [['cors','CORS'], ['404','HTTP 404'], ['type','did not return HTML'], ['redirect','redirects'], ['anchors','isn’t set up for live editing']]) {
    failure = mode; await page();
    await wait(`document.querySelector('.visual-error')?.textContent.includes(${JSON.stringify(message)})`, `${mode} error`);
    if (mode === 'anchors') assert.equal(await evaluate(`${frameDoc}.querySelector('h1').textContent`), 'Unprepared but visible');
    await click('.brand');
  }
  failure = ''; sameOrigin = true;
  await open(); await page();
  await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`, 'same-origin default');
  assert.equal(await evaluate(`document.querySelector('iframe').hasAttribute('srcdoc')`), false);
  assert.equal(await evaluate(`${frameDoc}.querySelector('h1').textContent`), 'Saved title');
  await input('[data-schema-path="title"] input', 'Same-origin unsaved');
  await wait(`${frameDoc}.querySelector('h1').textContent === 'Same-origin unsaved'`, 'same-origin patch');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  await cdp('Page.captureScreenshot').then(r => writeFile(path.join(scratch, 'preview.png'), Buffer.from(r.data, 'base64')));
  console.log('PASS: built editor with actual two-origin HTML, CSS and images; schema/legacy/article/new-entry previews; inline text/body; unsaved patch identity/scroll; Save/guards; credential-free HTML fetch; sandbox/sanitization; CORS/HTTP/type/redirect/anchors errors; same-origin defaults.');
} finally {
  ws?.close(); chrome?.kill(); await vite?.close(); await new Promise(resolve => remote.close(resolve));
}
