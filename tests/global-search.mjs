import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/global-search');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const fields = [{ key: 'title', label: 'Title', type: 'string' }, { key: 'marker', label: 'Marker', type: 'string' }];
const types = ['en', 'fr', undefined].map(locale => ({ name: locale ?? 'shared', title: locale ?? 'Shared', type: 'document', folder: locale ?? 'shared', fields, ...(locale ? { locale } : { shared: true }) }));
const records = types.map(type => ({ id: `${type.name}:home`, type: type.name, slug: 'home', data: { _id: `${type.name}:home`, _type: type.name, title: type.locale ? 'Same title' : 'Shared entry', marker: type.name } }));
const body = { root: { type: 'root', version: 1, children: [], direction: null, format: '', indent: 0 } };
let scope, multilingual = true, singleLocale = false, extraPages = 0;
const writes = [], checks = [], exceptions = [];
const manifest = () => { const content = ({ ...(scope ? { search: { scope } } : {}), ...(multilingual ? { contentLocales: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }] } } : {}), pages: [...Array.from({ length: extraPages }, (_, i) => ({ slug: 'extra-' + i, label: 'Extra ' + i, groups: [], values: {} })), ...['en', 'fr'].map(locale => ({ slug: 'legacy-' + locale, label: 'Legacy ' + locale, locale, groups: [{ id: 'intro', label: 'Intro', fields: [{ key: 'heading', label: 'Heading', type: 'string' }] }], values: { intro: { heading: 'Legacy exact ' + locale } } }))], schema: { objects: [], documents: types }, documents: records, collections: ['en', 'fr'].map(locale => ({ name: 'blog-' + locale, label: 'Blog ' + locale, locale, fields, posts: [{ slug: 'entry', frontmatter: { title: 'Post ' + locale, marker: 'post-' + locale }, body }] })), menus: { maxDepth: 3, entries: [{ slug: 'main', title: 'Shared menu', items: [] }] } });
  if (singleLocale) { content.contentLocales.locales = content.contentLocales.locales.slice(0, 1); content.pages = content.pages.filter(entry => entry.locale !== 'fr'); content.schema.documents = content.schema.documents.filter(entry => entry.locale !== 'fr'); content.documents = content.documents.filter(entry => entry.type !== 'fr'); content.collections = content.collections.filter(entry => entry.locale !== 'fr'); }
  return content;
};
const dictionaries = { en: {}, fr: {} };
for (const locale of Object.keys(dictionaries)) for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
const virtual = { name: 'page-category-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: ['en', 'fr'], defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
const options = { configFile: false, root: scratch, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] }, build: { outDir: path.join(scratch, 'dist'), emptyOutDir: true }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await delay(100); } throw new Error('Timed out: ' + label); }
let vite, chrome, ws, cdp, evaluate;
try {
  await build(options);
  vite = await createServer({ ...options, root: path.join(scratch, 'dist'), plugins: [{ name: 'fixture-backend', configureServer(server) { server.middlewares.use(async (req, res, next) => {
    if (req.url === '/rigel/manifest.json') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest())); }
    else if (req.url.startsWith('/rigel/api/local/') && req.method !== 'GET') { writes.push(req.url); res.statusCode = 500; res.end('Unexpected content write');
    } else next();
  }); } }] });
  await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const profile = path.join(scratch, `chrome-${Date.now()}`);
  chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails); const entry = pending.get(message.id); if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(message.error) : entry.resolve(message.result); } });
  cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 15000); pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params })); });
  evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = expression => until(() => evaluate(expression), expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const textClick = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)}).click()`);
  async function choose(scope, label, text) {
    const selector = `${scope} button[role=combobox]`;
    await evaluate(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => (document.getElementById(node.getAttribute('aria-labelledby'))?.textContent ?? node.getAttribute('aria-label')) === ${JSON.stringify(label)}); if(!node) throw Error('Missing selector '+${JSON.stringify(label)}); node.click();})()`);
    await wait(`!!document.querySelector('[popover]:popover-open')`);
    await textClick('[popover]:popover-open [role=option] span:first-child', text);
  }
  async function check(expression, label) { assert.equal(await evaluate(expression), true, label); checks.push(label); }
  const key = async (key, extra = {}) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, ...extra }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, ...extra }); };
  const screenshot = async name => { const result = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(scratch, name + '.png'), Buffer.from(result.data, 'base64')); };
  async function reload() { await cdp('Page.navigate', { url: origin + '/?run=' + Date.now() }); await wait(`!!document.querySelector('#nav-pages')`); }
  async function search(text) {
    if (!await evaluate(`!!document.querySelector('.palette')`)) await click('.search-trigger');
    await evaluate(`document.querySelector('.palette input').focus(); document.querySelector('.palette input').select()`);
    await key('Backspace', { windowsVirtualKeyCode: 8 });
    if (text) await cdp('Input.insertText', { text });
    await delay(80);
  }
  async function settings() { await key('Escape'); await click('.user-btn'); await textClick('.user-menu button', 'Settings'); await wait(`!!document.querySelector('.settings-modal')`); }
  async function override(text) { await settings(); await textClick('.settings-nav button', 'Content'); await check(`document.querySelectorAll('.settings-pane [role=combobox]').length===2 && !document.querySelector('.settings-pane input[type=radio]')`, 'Content combines editing and search dropdowns without radio buttons'); await choose('.settings-pane', 'Article body editing', 'Sidebar'); await check(`JSON.parse(localStorage.getItem('rigelcms.settings')).userPref.editorExperience==='sidebar'`, 'article editor dropdown persists Sidebar'); await choose('.settings-pane', 'Article body editing', 'Inline preview'); await check(`JSON.parse(localStorage.getItem('rigelcms.settings')).userPref.editorExperience==='inline'`, 'article editor dropdown persists Inline preview'); await choose('.settings-pane', 'Search content languages', text); await click('.settings-head .close'); }
  const hits = `document.querySelectorAll('.palette [role=option]')`;
  const props = async () => { await wait(`!!document.querySelector('.visual-actions button')`); if (await evaluate(`document.querySelector('.visual-actions button').getAttribute('aria-pressed')==='false'`)) await click('.visual-actions button'); };
  const marker = `Array.from(document.querySelectorAll('main input')).some(input=>input.value==='fr')`;
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await reload();
  await click('#nav-pages');
  await check(`document.querySelector('table').textContent.includes('Same title') && !document.querySelector('table').textContent.includes('legacy-fr')`, 'Pages remains current-language filtered');
  await search('Same title');
  await check(`${hits}.length===2`, 'default all finds identical native titles across languages');
  await check(`[...document.querySelectorAll('.search-language')].map(node=>node.textContent).join(',')==='EN,FR' && [...document.querySelectorAll('.search-language')].map(node=>node.getAttribute('aria-label')).join(',')==='English,Français' && [...document.querySelectorAll('.search-language')].every(node=>parseFloat(getComputedStyle(node).marginLeft)>=8)`, 'compact language codes retain full accessible labels and left spacing');
  await screenshot('all-languages');
  await click('#rigel-search-hit-1'); await props(); await wait(marker);
  await check(`document.querySelector('.content-language').dataset.locale==='fr' && ${marker}`, 'foreign result switches language and opens exact native ID');
  await search('Same title'); await click('#rigel-search-hit-0');
  await wait(`document.querySelector('.content-language').dataset.locale==='en'`);
  await props();
  await evaluate(`(()=>{const input=[...document.querySelectorAll('main input')].find(input=>input.value==='en'); input.focus();input.select();})()`);
  await cdp('Input.insertText', { text: 'unsaved marker' });
  await search('Same title'); await click('#rigel-search-hit-1');
  await wait(`!!document.querySelector('.unsaved-dialog')`);
  await textClick('.unsaved-dialog button', 'Keep editing');
  await check(`document.querySelector('.content-language').dataset.locale==='en' && [...document.querySelectorAll('main input')].some(input=>input.value==='unsaved marker')`, 'unsaved cancel preserves locale, exact document and draft');
  assert.equal(writes.length, 0); checks.push('cancel never invokes content Save');
  await search('Same title'); await click('#rigel-search-hit-1'); await wait(`!!document.querySelector('.unsaved-dialog')`); await textClick('.unsaved-dialog button', 'Discard changes'); await props(); await wait(marker);
  await check(`document.querySelector('.content-language').dataset.locale==='fr'`, 'discard follows guarded cross-language target without Save');
  await search('Shared entry'); await check(`${hits}.length===1 && !document.querySelector('.search-language')`, 'shared native document appears exactly once without badge');
  await search('Legacy fr'); await check(`${hits}.length===1`, 'legacy pages indexed'); await click('#rigel-search-hit-0');
  await wait(`[...document.querySelectorAll('main input')].some(input=>input.value==='Legacy exact fr')`);
  await check(`[...document.querySelectorAll('main input')].some(input=>input.value==='Legacy exact fr')`, 'legacy opens exact stored page');
  await search('Post en'); await click('#rigel-search-hit-0'); await wait(`document.querySelector('.content-language').dataset.locale==='en'`);
  await check(`document.querySelector('.titlebar h2')?.textContent.includes('Post en')`, 'post switches locale and opens exact collection/slug');
  await search('Blog fr'); await click('#rigel-search-hit-0'); await wait(`document.querySelector('.content-language').dataset.locale==='fr'`);
  await check(`document.querySelector('table')?.textContent.includes('Post fr')`, 'collection opens exact foreign-language table');
  await search('Shared menu'); await check(`${hits}.length===1`, 'menu indexed once'); await click('#rigel-search-hit-0');
  await check(`document.querySelector('main')?.textContent.includes('Shared menu')`, 'menu opens exact slug');
  await override('Current content language');
  await search('Same title'); await check(`${hits}.length===1 && document.querySelector('.search-language').textContent==='FR'`, 'current-language override applies without reload');
  await search('Shared entry'); await check(`${hits}.length===1`, 'current-language scope retains shared documents once');
  await search('Shared menu'); await check(`${hits}.length===1`, 'current-language scope retains shared menus once');
  await key('Escape'); await reload(); await search('Same title');
  await check(`${hits}.length===1 && document.querySelector('.search-language').textContent==='EN'`, 'override persists reload while content locale returns to developer default');
  await override('Website default (All languages)');
  await search('Same title'); await check(`${hits}.length===2`, 'inherit restores all developer default immediately');
  await check(`!Object.hasOwn(JSON.parse(localStorage.getItem('rigelcms.settings')).userPref,'searchScope')`, 'inherit removes stored override');
  await key('Escape'); scope = 'currentLocale'; await reload(); await search('Same title');
  await check(`${hits}.length===1`, 'currentLocale developer default is honored without override');
  await override('All languages'); await search('Same title'); await check(`${hits}.length===2`, 'all override supersedes currentLocale developer default');
  await key('Escape'); await reload(); await search('Same title'); await check(`${hits}.length===2`, 'all override persists reload');
  await override('Website default (Current content language)'); await search('Same title'); await check(`${hits}.length===1`, 'inherit restores currentLocale developer default immediately');
  await key('Escape'); scope = 'all'; extraPages = 8; await reload(); await search('');
  await check(`${hits}.length===12`, 'palette retains 12-result limit across all languages');
  await search('Same title'); await key('ArrowDown');
  await check(`document.querySelector('.palette input').getAttribute('aria-activedescendant')==='rigel-search-hit-0'`, 'ArrowDown updates accessible active option');
  await key('ArrowDown'); await key('Enter', { text: '\r', windowsVirtualKeyCode: 13 });
  await props(); await wait(marker); await check(`document.querySelector('.content-language').dataset.locale==='fr'`, 'keyboard Enter selects exact foreign result');
  await search('No such result'); await key('Enter', { text: '\r', windowsVirtualKeyCode: 13 }); await check(`${hits}.length===0`, 'empty results Enter is safe'); await key('Escape');
  await check(`!document.querySelector('.palette')`, 'Escape closes palette');
  await settings();
  await check(`[...document.querySelectorAll('.settings-nav button')].map(node=>node.textContent.trim()).join(',')==='Interface,Content,Connection,Media,Advanced'`, 'Interface combines appearance/language and Content combines editor/search');
  for (const name of ['Content', 'Connection', 'Media', 'Advanced', 'Interface']) {
    await textClick('.settings-nav button', name);
    await check(`document.querySelector('.settings-pane').getAttribute('aria-label')===${JSON.stringify(name)} && document.querySelector('.settings-nav [aria-current=true]').textContent.trim()===${JSON.stringify(name)} && [...document.querySelectorAll('.settings-pane > h3')].every(node=>node.textContent!==${JSON.stringify(name)})`, name + ' uses active navigation instead of a duplicate pane title');
  }
  await check(`document.querySelector('.settings-pane').getAttribute('aria-label')==='Interface' && !document.querySelector('.settings-pane > h3') && !!document.querySelector('.settings-pane input[value=fr]') && !!document.querySelector('.settings-pane input[value=dark]') && !document.querySelector('.settings-pane [role=combobox]')`, 'Interface combines theme and UI language without a redundant tab heading');
  await click('.settings-pane input[value=light]');
  await check(`[...document.querySelectorAll('.settings-pane fieldset legend')].map(node=>node.textContent).join(',')==='Theme,Accessibility,Editor interface language'`, 'Interface orders theme, accessibility, then UI language');
  await wait(`document.documentElement.dataset.theme==='light'`);
  await check(`JSON.parse(localStorage.getItem('rigelcms.settings')).theme==='light'`, 'Interface theme applies and persists through the existing preference');
  await screenshot('settings-interface');
  await click('.settings-pane input[value=fr]'); await click('.settings-head .close');
  await search('Same title'); await check(`${hits}.length===2 && document.querySelector('.content-language').dataset.locale==='fr' && [...document.querySelectorAll('.search-language')].map(node=>node.textContent).join(',')==='EN,FR'`, 'interface language changes neither content locale nor global scope and metadata labels');
  await key('Escape'); await click('.user-btn'); await click('.user-menu button'); await click('.settings-pane input[value=en]'); await click('.settings-head .close');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await search('Same title');
  await check(`(()=>{const r=document.querySelector('.palette').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`, 'mobile palette fits viewport');
  await screenshot('mobile-languages'); await key('Escape');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  multilingual = false; await reload(); await search('Same title');
  await check(`${hits}.length===2 && !document.querySelector('.search-language') && !document.querySelector('.content-language')`, 'unconfigured single-language behavior has no badges or selector and no duplicate identities');
  await settings(); await textClick('.settings-nav button', 'Content'); await evaluate(`(()=>{const label=[...document.querySelectorAll('.settings-pane .select-label')].find(node=>node.textContent==='Search content languages');document.querySelector('button[aria-labelledby="'+label.id+'"]').click();})()`);
  await check(`[...document.querySelectorAll('[popover]:popover-open [role=option]')].find(node=>node.textContent.includes('Current content language')).getAttribute('aria-disabled')==='true'`, 'current-language option disabled without configured languages');
  await screenshot('settings-scope'); await click('.settings-head .close');
  multilingual = true; singleLocale = true; await reload(); await search('Same title');
  await check(`${hits}.length===1 && !document.querySelector('.search-language') && !document.querySelector('.content-language')`, 'one configured content language has one exact result with no unnecessary badge or locale selector');
  assert.deepEqual(exceptions, []); assert.equal(writes.length, 0);
  const report = { passed: true, checks: checks.length, results: checks, writes, coverage: 'Production-built full App and native Settings controls, real CDP Chrome, isolated fixture HTTP backend; no consumer or content writes.' };
  await writeFile(path.join(scratch, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('FAILURE STATE', await evaluate?.('document.body.innerText').catch(() => ''), exceptions); throw error; }
finally { ws?.close(); chrome?.kill(); await vite?.close(); }
