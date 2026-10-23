import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = process.cwd(), scratch = path.join(root, '_temp/persistent-login');
const results = [], exceptions = [], writes = [], requests = [];
const config = { repo: 'fixture/repository', branch: 'drafts', publishBranch: 'main', appSlug: 'fixture', authOrigin: 'https://auth.invalid', repoRoot: '', copyDir: 'src/copy', collections: [] };
const sessionKey = 'rigelcms.session';
const token = 'ghu_fixture_not_a_real_credential';
const head = 'a'.repeat(40), blob = 'b'.repeat(40);
let mode = 'ready', vite, chrome, ws, origin, port, profile;
let id = 0;
const pending = new Map();
const delay = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label) { for (let i = 0; i < 150; i++) { const r = await fn(); if (r) return r; await delay(100); } throw Error('Timeout: ' + label); }
function cdp(method, params = {}) { return new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); }); }
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }
const click = s => evaluate(`document.querySelector(${JSON.stringify(s)}).click()`);
const textClick = (scope, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
const wait = s => until(() => evaluate(s), s);
const stored = () => evaluate(`localStorage.getItem('${sessionKey}')`);
const editor = () => wait(`!!document.querySelector('.user-btn')`);
const signedOut = () => wait(`!!document.querySelector('#github-sign-in:not(:disabled)') && !document.querySelector('.user-btn')`);
const blueprint = () => ({ backend: 'github', github: config, pages: [{ slug: 'home', label: 'Home', groups: [{ id: 'hero', label: 'Hero', fields: [{ key: 'title', label: 'Title', type: 'string' }] }], values: { hero: { title: 'Build-time stale' } } }] });
const record = (changes = {}) => ({ version: 1, scope: JSON.stringify([config.authOrigin, config.repo, config.branch, config.appSlug]), accessToken: token, expiresAt: Date.now() + 3600000, ...changes });
async function seed(value) { await evaluate(`localStorage.setItem('${sessionKey}',${JSON.stringify(typeof value === 'string' ? value : JSON.stringify(value))})`); }
async function reload() { const previous = await evaluate('window.instance'); await cdp('Page.reload'); await wait(`window.instance && window.instance!==${JSON.stringify(previous)}`); }
async function login() { await click('#github-sign-in'); await editor(); }
async function edit() {
  await click('#nav-pages'); await click('.table-link');
  await wait(`!!document.querySelector('#rigel-editor-pane input[type=text]')`);
  assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value`), 'Fresh from GitHub');
  await evaluate(`(()=>{const e=document.querySelector('#rigel-editor-pane input[type=text]');e.value='Unsaved draft';e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await wait(`!document.querySelector('.save-button').disabled`);
}
async function connectSocket() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails);
    if (m.method === 'Fetch.requestPaused') void respond(m.params).catch(e => { exceptions.push(String(e)); });
    const entry = pending.get(m.id); if (entry) { pending.delete(m.id); m.error ? entry.reject(m.error) : entry.resolve(m.result); }
  });
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `window.instance=crypto.randomUUID();window.logins=0;window.open=(url)=>{window.logins++;const popup={closed:false,close(){this.closed=true}};setTimeout(()=>{const event=new MessageEvent('message',{origin:'https://auth.invalid',data:{type:'rigel:auth',provider:'github',nonce:new URL(url).searchParams.get('nonce'),access_token:'${token}',expires_in:3600}});Object.defineProperty(event,'source',{value:popup});window.dispatchEvent(event)},10);return popup};` });
}
async function launch() {
  await rm(path.join(profile, 'DevToolsActivePort'), { force: true });
  chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  await until(async () => { try { await connectSocket(); return true; } catch { return false; } }, 'CDP');
}
async function stopChrome() {
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  void cdp('Browser.close').catch(() => {}); await exited; ws.close();
}
async function respond(p) {
  const url = new URL(p.request.url);
  const fulfill = (body, responseCode = 200, headers = {}) => cdp('Fetch.fulfillRequest', { requestId: p.requestId, responseCode, responseHeaders: Object.entries({ 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...headers }).map(([name, value]) => ({ name, value })), body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(p.request.method)) { writes.push(url.pathname); return fulfill({}, 405); }
  if (p.request.method === 'OPTIONS') return fulfill('', 200, { 'Access-Control-Allow-Headers': 'authorization,x-github-api-version,content-type', 'Access-Control-Allow-Methods': 'GET' });
  if (url.origin === origin) return cdp('Fetch.continueRequest', { requestId: p.requestId });
  if (url.hostname === 'avatars.githubusercontent.com') return fulfill('', 200);
  if (url.origin !== 'https://api.github.com') { exceptions.push('Unexpected external request: ' + url.origin); return fulfill({}, 403); }
  requests.push(url.pathname);
  assert.equal(p.request.headers.Authorization ?? p.request.headers.authorization, `Bearer ${token}`);
  if (mode === 'network') return cdp('Fetch.failRequest', { requestId: p.requestId, errorReason: 'InternetDisconnected' });
  if (mode === 'invalid' || (mode === 'backend-invalid' && url.pathname.includes('/repos/'))) return fulfill({}, 401);
  if (mode === 'rate') return fulfill({}, 403, { 'x-ratelimit-remaining': '0' });
  if (mode === 'repo-error' && url.pathname.includes('/repos/')) return fulfill({}, 404);
  if (url.pathname === '/user') return fulfill({ login: 'verified-fixture', name: 'Verified User', avatar_url: 'https://avatars.githubusercontent.com/u/123', html_url: 'https://github.com/fixture' });
  if (url.pathname === '/user/installations') return fulfill({ installations: [{ id: 1, app_slug: 'fixture', account: { login: 'fixture' }, permissions: { contents: 'write' } }] });
  if (url.pathname === '/user/installations/1/repositories') return fulfill({ repositories: [{ id: 1, full_name: config.repo, default_branch: 'main', permissions: { push: mode !== 'readonly' } }] });
  if (url.pathname.endsWith('/git/ref/heads/drafts')) return fulfill({ object: { sha: head } });
  if (url.pathname.endsWith('/git/trees/' + head)) return fulfill({ truncated: false, tree: [{ path: 'src/copy/home.ts', type: 'blob', mode: '100644', sha: blob }] });
  if (url.pathname.endsWith('/git/blobs/' + blob)) return fulfill({ sha: blob, encoding: 'base64', content: Buffer.from('export default defineCopy({values:{hero:{title:"Fresh from GitHub"}}});').toString('base64') });
  exceptions.push('Unexpected API request: ' + url.pathname); return fulfill({}, 404);
}

try {
  await mkdir(scratch, { recursive: true });
  await writeFile(path.join(scratch, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
  await writeFile(path.join(scratch, 'main.js'), `import {mount} from 'svelte';import App from '/src/editor/App.svelte';import '/src/editor/styles.css';mount(App,{target:document.getElementById('app')});`);
  const options = { configFile: false, root: scratch, logLevel: 'warn', plugins: [svelte()], resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
  await build(options);
  vite = await createServer({ ...options, build: undefined, root: path.join(scratch, 'dist'), plugins: [{ name: 'manifest', configureServer(server) { server.middlewares.use((req, res, next) => { if (!['GET', 'HEAD'].includes(req.method)) { writes.push(req.url); res.statusCode = 405; res.end(); } else if (req.url === '/storage-tab') { res.setHeader('Content-Type', 'text/html'); res.end(`<script>localStorage.removeItem('${sessionKey}')</script>`); } else if (req.url === '/rigel/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(blueprint())); } else next(); }); } }] });
  await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  profile = path.join(scratch, 'chrome-' + Date.now()); await launch();
  await cdp('Page.navigate', { url: origin }); await signedOut(); await login();
  const original = JSON.parse(await stored()); assert.equal(original.accessToken, token); assert.equal(original.version, 1); assert.deepEqual(Object.keys(original).sort(), ['accessToken', 'expiresAt', 'scope', 'version']); results.push('popup login persists only scoped access token and absolute expiry');
  const before = requests.length; await reload(); await editor(); assert.equal(await evaluate('window.logins'), 0); assert.equal(JSON.parse(await stored()).expiresAt, original.expiresAt); assert(requests.slice(before).includes('/user')); assert(requests.slice(before).some(p => p.includes('/git/blobs/'))); results.push('refresh restores without popup, reverifies identity/permissions and fresh remote content');
  await stopChrome(); await launch(); await cdp('Page.navigate', { url: origin }); await editor(); assert.equal(await evaluate('window.logins'), 0); assert.equal(JSON.parse(await stored()).expiresAt, original.expiresAt); results.push('browser close/reopen preserves original expiry');
  await edit(); await click('.user-btn'); await click('#github-sign-out'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Keep editing'); assert(await stored()); assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value`), 'Unsaved draft'); results.push('cancelled dirty signout retains session and draft');
  await click('.user-btn'); await click('#github-sign-out'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Discard changes'); await signedOut(); assert.equal(await stored(), null); await reload(); await signedOut(); results.push('confirmed signout removes persistent login, reload stays signed out');
  for (const [label, value] of [['expired', record({ expiresAt: Date.now() - 1 })], ['malformed JSON', '{'], ['invalid token', record({ accessToken: 'not-a-token' })], ['overlong lifetime', record({ expiresAt: Date.now() + 90000000 })], ['config mismatch', record({ scope: 'another-repository' })]]) {
    await seed(value); const count = requests.length; await reload(); await signedOut(); assert.equal(await stored(), null); assert.equal(requests.length, count); assert.equal(await evaluate('window.logins'), 0); results.push(label + ' is cleared without auth/network');
  }
  for (const failure of ['rate', 'network', 'repo-error', 'readonly', 'invalid', 'backend-invalid']) {
    mode = failure; await seed(record()); await reload(); await signedOut();
    if (failure.endsWith('invalid')) assert.equal(await stored(), null); else assert(await stored());
    assert.equal(await evaluate('window.logins'), 0); results.push(failure + (failure.endsWith('invalid') ? ' credentials cleared' : ' failure retains credentials but denies editor'));
    if (!failure.endsWith('invalid')) {
      const expiry = JSON.parse(await stored()).expiresAt;
      mode = 'ready'; await click('#github-check-access'); await editor(); assert.equal(await evaluate('window.logins'), 0); assert.equal(JSON.parse(await stored()).expiresAt, expiry);
    }
  }
  mode = 'ready'; await seed(record({ expiresAt: Date.now() + 32000 })); await reload(); await editor(); await edit();
  await wait(`document.querySelector('.github-session')?.textContent.includes('expired')`); assert.equal(await stored(), null); assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value`), 'Unsaved draft'); results.push('active expiry clears credentials without dropping draft');
  await click('.github-session button'); await wait(`!document.querySelector('.github-session')`);
  const otherTab = await cdp('Target.createTarget', { url: origin + '/storage-tab' });
  await wait(`!!document.querySelector('.github-session')`); assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value`), 'Unsaved draft');
  await cdp('Target.closeTarget', { targetId: otherTab.targetId });
  await click('.save-button'); await wait(`document.body.textContent.includes('Connect GitHub and verify')`); assert.equal(writes.length, 0);
  await click('.github-session button'); await wait(`!document.querySelector('.github-session')`); assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value`), 'Unsaved draft'); results.push('cross-tab signout disables writes, reconnect preserves unsaved draft');
  await evaluate(`document.querySelector('#rigel-editor-pane input[type=text]').value='Fresh from GitHub';document.querySelector('#rigel-editor-pane input[type=text]').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('.user-btn'); await textClick('.user-menu button', 'Settings'); await wait(`!!document.querySelector('.settings-modal')`); await textClick('.settings-nav button', 'Advanced'); await textClick('.settings-pane button', 'Erase All Data'); await wait(`!!document.querySelector('.action-dialog[open]')`); await textClick('.action-dialog button', 'Erase data'); await signedOut(); assert.equal(await stored(), null); results.push('erase browser data clears persistent login');
  const blocked = await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `for(const method of ['getItem','setItem','removeItem'])Storage.prototype[method]=()=>{throw new DOMException('Blocked','SecurityError')}` });
  await reload(); await signedOut(); await login(); await edit(); assert.equal(writes.length, 0); await cdp('Page.removeScriptToEvaluateOnNewDocument', { identifier: blocked.identifier }); results.push('storage denied gracefully degrades to memory-only login');
  assert.deepEqual(exceptions, []); assert.deepEqual(writes, []);
  const report = { passed: true, checks: results.length, results, exceptions, writes, coverage: 'Production-built full App, real popup/access verification/backend, Chrome persisted profile restart; fake popup and CDP-mocked GitHub GETs only; no real credentials or remote writes.' };
  await writeFile(path.join(scratch, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('FAILURE STATE', await evaluate('document.body.innerText').catch(() => ''), { requests, exceptions, writes }); throw error; } finally { ws?.close(); chrome?.kill(); await vite?.close(); }
