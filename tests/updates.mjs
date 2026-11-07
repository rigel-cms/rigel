import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/updates');
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const cacheKey = `rigelcms.updates.${version}`;
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const dictionaries = {};
for (const locale of ['en', 'fr', 'es', 'ru', 'zh', 'ja', 'it', 'de', 'nl']) {
  dictionaries[locale] = {};
  for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
}
const virtual = { name: 'update-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: Object.keys(dictionaries), defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
const manifest = { backend: 'local', pages: [{ slug: 'home', label: 'Home', groups: [{ id: 'hero', label: 'Hero', fields: [{ key: 'title', label: 'Title', type: 'string' }] }], values: { hero: { title: 'Original title' } } }], schema: { objects: [], documents: [{ name: 'settings', title: 'Website settings', type: 'document', shared: true, singleton: true, folder: 'src/content/settings', fields: [{ key: 'siteName', label: 'Website name', type: 'string' }] }] }, documents: [{ id: 'settings:site', type: 'settings', slug: 'site', data: { _id: 'settings:site', _type: 'settings', siteName: 'Fixture website' } }] };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await delay(100); } throw Error('Timed out: ' + label); }
let vite, chrome, ws;
let npmVersion = '99.0.0', fail = false, npmCalls = 0, writes = 0, github = false, holdRequest = false, heldRequest;
const exceptions = [], checks = [];
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [{ name: 'read-only-backend', configureServer(server) { server.middlewares.use((req, res, next) => {
    if (req.method !== 'GET') { writes++; res.statusCode = 405; res.end(); }
    else if (req.url === '/rigel/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(github ? { ...manifest, backend: 'github', github: { authOrigin: 'https://auth.example.test', repo: 'fixture/site', branch: 'main', appSlug: 'fixture' } } : manifest)); }
    else next();
  }); } }] });
  await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timed out')); }, 15000); pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params })); });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Fetch.requestPaused') {
      const { requestId, request } = message.params; npmCalls++;
      assert.equal(request.url, 'https://registry.npmjs.org/@rigel-cms%2frigel/latest');
      assert(!Object.keys(request.headers).some(key => /^(authorization|cookie|referer)$/i.test(key)));
      if (holdRequest) { heldRequest = requestId; return; }
      void cdp('Fetch.fulfillRequest', { requestId, responseCode: fail ? 503 : 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(JSON.stringify({ name: '@rigel-cms/rigel', version: npmVersion, repository: { url: 'https://evil.invalid/' } })).toString('base64') });
    }
    const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(message.error) : entry.resolve(message.result); }
  });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = expression => until(() => evaluate(expression), expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const check = async (expression, label) => { assert.equal(await evaluate(expression), true, label); checks.push(label); };
  const reload = async () => { await cdp('Page.navigate', { url: origin + '/?run=' + Date.now() }); await wait(`!!document.querySelector('.welcome')`); };
  const clearCache = () => evaluate(`localStorage.removeItem(${JSON.stringify(cacheKey)})`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Fetch.enable', { patterns: [{ urlPattern: 'https://registry.npmjs.org/*' }] });
  await reload(); await wait(`!!document.querySelector('.update-notice')`);
  await check(`document.querySelector('.update-notice').textContent.includes('Rigel 99.0.0 is available')`, 'new stable release has translated notice');
  await check(`document.querySelector('.update-notice a').href==='https://github.com/rigel-cms/rigel/releases' && document.querySelector('.update-notice a').rel.includes('noreferrer')`, 'release notes use trusted fixed URL');
  await check(`!!localStorage.getItem(${JSON.stringify(cacheKey)})`, 'built App uses installed package version cache key');
  assert.equal(npmCalls, 1);
  await cdp('Page.navigate', { url: origin + '/#/settings/site' });
  await wait(`!!document.querySelector('.document-form')`);
  await check(`!document.querySelector('[data-rigel-version]') && document.querySelector('.save-button').disabled`, 'website settings and sidebar have no scattered version labels or content edits');
  await click('.user-btn');
  await evaluate(`[...document.querySelectorAll('[role=menuitem]')].find(item=>item.textContent.trim()==='Settings').click()`);
  await wait(`!!document.querySelector('.settings-modal')`);
  await check(`JSON.stringify([...document.querySelectorAll('.settings-nav button')].map(button=>button.textContent.trim()))===JSON.stringify(['Interface','Content','Connection','Media','Advanced','About'])`, 'About follows Advanced');
  for (let pane = 0; pane < 5; pane++) {
    await evaluate(`document.querySelectorAll('.settings-nav button')[${pane}].click()`);
    await check(`!document.querySelector('[data-rigel-version]')`, `settings pane ${pane} has no version label`);
  }
  await evaluate(`document.querySelectorAll('.settings-nav button')[5].click()`);
  const aboutLinks = ['https://github.com/rigel-cms/rigel', 'https://rigelcms.dev/', 'https://github.com/rigel-cms/rigel/blob/main/ACKNOWLEDGEMENTS.md', 'https://rigelcms.dev/terms/', 'https://rigelcms.dev/privacy/', 'https://github.com/rigel-cms/rigel/blob/main/LICENSE', 'https://alex.zappa.dev/'];
  await check(`document.querySelectorAll('[data-rigel-version]').length===1 && document.querySelector('.about-brand [data-rigel-version]').textContent===${JSON.stringify('v' + version)} && document.querySelector('.about-brand h3').textContent==='Rigel CMS' && document.querySelector('.about-credit').textContent==='Apache-2.0 license. Crafted by Alex Zappa' && JSON.stringify([...document.querySelectorAll('.settings-pane a')].map(a=>a.href))===${JSON.stringify(JSON.stringify(aboutLinks))}`, 'About header has installed version once and final line has license and author');
  await check(`document.querySelectorAll('.settings-pane.about > p').length===4 && document.querySelector('.settings-pane.about > p').textContent==='Rigel is open source. Explore the source code on GitHub and read the documentation on our website.' && [...document.querySelectorAll('.settings-pane.about > p')].every(p=>p.textContent.length>[...p.querySelectorAll('a')].map(a=>a.textContent).join('').length)`, 'About links appear in contextual prose rather than standalone rows');
  assert.match(await readFile(path.join(root, 'src/editor/styles.css'), 'utf8'), /\.rigel \.settings-pane\.about a,\s*\.rigel \.settings-pane\.about a:visited\s*\{\s*color: var\(--link\)/);
  await evaluate(`document.querySelector('.settings-nav button.active').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' });
  await check(`getComputedStyle(document.activeElement).outlineStyle!=='none'`, 'About inline links retain visible keyboard focus');
  for (const width of [390, 1280]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await check(`document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.settings-pane a,.settings-pane img')].every(el=>{const r=el.getBoundingClientRect();return r.width>0 && r.left>=0 && r.right<=innerWidth}) && document.querySelector('.settings-pane img').naturalWidth>0`, `${width}px ${theme} About logo and links fit`);
      await writeFile(path.join(scratch, `about-${width}-${theme}.png`), Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
  }
  await click('.settings-head .close');
  await reload(); await wait(`!!document.querySelector('.update-notice')`); assert.equal(npmCalls, 1); checks.push('fresh cache makes no network request');
  for (const width of [390, 1280]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 640 });
    for (const theme of ['light', 'dark']) {
      await evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
      await check(`document.documentElement.scrollWidth<=innerWidth && document.querySelector('.update-notice').getBoundingClientRect().right<=innerWidth`, `${width}px ${theme} notice fits`);
      const screenshot = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(scratch, `${width}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
    }
  }
  await evaluate(`document.querySelector('.update-notice button').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: 8 });
  await check(`document.activeElement===document.querySelector('.update-notice a') && getComputedStyle(document.activeElement).outlineStyle!=='none'`, 'keyboard release link has visible focus');
  await click('.update-notice button'); await wait(`!document.querySelector('.update-notice')`);
  await check(`document.activeElement===document.querySelector('.brand')`, 'dismiss restores stable welcome focus');
  await reload(); await delay(150); await check(`!document.querySelector('.update-notice')`, 'dismiss survives reload'); assert.equal(npmCalls, 1);
  npmVersion = '99.0.1'; await clearCache(); await reload(); await wait(`document.querySelector('.update-notice')?.textContent.includes('99.0.1')`); checks.push('newer target reappears');
  for (const locale of Object.keys(dictionaries)) {
    await evaluate(`localStorage.setItem('rigelcms.settings',JSON.stringify({language:${JSON.stringify(locale)}}))`); await reload(); await wait(`!!document.querySelector('.update-notice')`);
    await check(`document.querySelector('.update-notice').textContent.includes(${JSON.stringify(dictionaries[locale]['shell.updateAvailable']?.replace('{version}', '99.0.1'))})`, locale + ' notice translation');
    await click('.user-btn');
    await evaluate(`document.querySelector('button[role=menuitem]').click()`);
    await wait(`!!document.querySelector('.settings-modal')`);
    await evaluate(`document.querySelectorAll('.settings-nav button')[5].click()`);
    await check(`document.querySelector('.settings-nav button.active').textContent.trim()===${JSON.stringify(dictionaries[locale]['shell.about'])} && document.querySelector('.settings-pane').textContent.includes(${JSON.stringify(dictionaries[locale]['shell.createdBy'].replace('{name}', 'Alex Zappa'))}) && document.querySelectorAll('[data-rigel-version]').length===1`, locale + ' About and credit translation');
    await click('.settings-head .close');
  }
  await evaluate(`localStorage.removeItem('rigelcms.settings')`);
  fail = true; await clearCache(); await reload(); await wait(`!!localStorage.getItem(${JSON.stringify(cacheKey)})`);
  await check(`!document.querySelector('.update-notice') && !document.querySelector('[role=alert]')`, 'registry failure stays quiet');
  const failedCalls = npmCalls; await reload(); await delay(150); assert.equal(npmCalls, failedCalls); checks.push('failed attempt cached');
  fail = false; npmVersion = '1.4.0'; await clearCache(); await reload(); await wait(`!!localStorage.getItem(${JSON.stringify(cacheKey)})`);
  await check(`!document.querySelector('.update-notice')`, 'older npm stable never offers prerelease downgrade');
  await click('#nav-pages'); await wait(`!!document.querySelector('.table-link')`); await click('.table-link'); await wait(`[...document.querySelectorAll('input')].some(input=>input.value==='Original title')`);
  await check(`document.querySelector('.save-button').disabled && !document.querySelector('.unsaved-dialog')`, 'normal editor opens unchanged and Save stays explicit');
  github = true; holdRequest = true; await clearCache();
  await cdp('Page.navigate', { url: origin + '/?github' }); await wait(`!!document.querySelector('#github-sign-in')`);
  await until(() => heldRequest, 'held npm request');
  await check(`!document.querySelector('#github-sign-in').disabled && !document.querySelector('.update-notice')`, 'pending npm check never blocks or overlays GitHub sign-in');
  await cdp('Fetch.fulfillRequest', { requestId: heldRequest, responseCode: 503, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' });
  await wait(`!!localStorage.getItem(${JSON.stringify(cacheKey)})`);
  await check(`!document.querySelector('#github-sign-in').disabled && !document.querySelector('[role=alert]')`, 'failed npm check leaves sign-in intact');
  assert.equal(writes, 0); assert.deepEqual(exceptions, []);
  console.log(JSON.stringify({ checks, npmCalls, contentWrites: writes, exceptions, screenshots: scratch }, null, 2));
} finally {
  ws?.close(); chrome?.kill(); await vite?.close();
}
