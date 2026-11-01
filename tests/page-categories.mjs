import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const root = fileURLToPath(new URL('../', import.meta.url));
const scratch = path.join(root, '_temp/page-categories');
await mkdir(scratch, { recursive: true });
await writeFile(path.join(scratch, 'index.html'), '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/main.js"></script></body></html>');
await writeFile(path.join(scratch, 'main.js'), `import { mount } from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; mount(App, {target:document.getElementById('app')});`);
const fields = [{ key: 'title', label: 'Title', type: 'string' }, { key: 'theme', label: 'Theme', type: 'string' }];
const type = (name, category, locale, extra = {}) => ({ name, title: name, type: 'document', folder: name, fields, ...(category ? { category } : {}), ...(locale ? { locale } : {}), initialValue: { theme: name.startsWith('resource') ? 'dark' : 'light' }, ...extra });
const types = [type('pageEn', undefined, 'en'), type('pageFr', undefined, 'fr'), type('articleEn', 'Articles', 'en'), type('articleFr', 'Articles', 'fr'), type('profileEn', 'Articles', 'en'), type('resourceEn', 'Resources', 'en'), type('resourceFr', 'Resources', 'fr'), type('frOnly', 'French only', 'fr'), type('locked', 'Read only', undefined, { creatable: false }), type('singleton', 'Resources', undefined, { singleton: true }), type('shared', 'Globals', undefined, { shared: true })];
const record = (type, slug, title) => ({ id: `${type}:${slug}`, type, slug, data: { _id: `${type}:${slug}`, _type: type, slug, title } });
let records = [record('pageEn', 'home', 'Home EN'), record('pageFr', 'home', 'Home FR'), record('articleEn', 'existing', 'Article EN'), record('articleFr', 'existing', 'Article FR'), record('resourceEn', 'existing', 'Resource EN'), record('resourceFr', 'existing', 'Resource FR'), record('locked', 'existing', 'Locked'), record('singleton', 'existing', 'Singleton page'), record('shared', 'existing', 'Shared')];
let mode = 'categories', failSave = false;
const writes = [], checks = [], exceptions = [];
const manifest = () => ({ backend: 'local', contentLocales: { defaultLocale: 'en', locales: [{ code: 'en', label: 'English' }, { code: 'fr', label: 'Français' }] }, pages: mode === 'categories' ? [{ slug: 'legacy', label: 'Legacy core', groups: [], values: {} }, { slug: 'legacy-article', label: 'Legacy article', category: 'Articles', groups: [], values: {} }] : mode === 'plain' ? [{ slug: 'legacy', label: 'Legacy core', groups: [], values: {} }] : [], schema: { objects: [], documents: mode === 'plain' ? [types[0]] : mode === 'single' ? [types[2]] : types }, documents: records, preview: { documents: Object.fromEntries(types.map(type => [type.name, { url: `/${type.name}/{slug}/` }])) }, sidebar: [{ kind: 'link', target: { kind: 'pages' } }, { kind: 'link', target: { kind: 'documents', type: 'resourceEn' } }] });
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
    else if (req.url.startsWith('/rigel/api/local/documents/') && req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const { data } = JSON.parse(Buffer.concat(chunks));
      const id = decodeURIComponent(req.url.split('/').at(-1));
      if (failSave) { res.statusCode = 422; res.end('Fixture rejected save'); return; }
      assert.equal(data._id, id); assert.equal(data._type, id.split(':')[0]);
      assert(!records.some(record => record.id === id));
      const entry = { id, type: data._type, slug: id.split(':')[1], data };
      await writeFile(path.join(scratch, `${id}.json`), JSON.stringify(data));
      records.push(entry); writes.push(entry); res.end('{}');
    } else if (types.some(type => req.url.startsWith(`/${type.name}/`))) {
      const [name, slug] = req.url.split('/').filter(Boolean); const doc = records.find(record => record.id === `${name}:${slug}`);
      res.setHeader('Content-Type', 'text/html'); res.end(`<html><body><main data-rigel-doc="${doc?.id}"><h1 data-rigel-field="title">${doc?.data.title ?? ''}</h1></main></body></html>`);
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
  const rowTitles = () => evaluate(`[...document.querySelectorAll('.table-link')].map(node=>node.textContent)`);
  const title = text => evaluate(`(()=>{const input=document.querySelector('.action-dialog input');input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  async function back() { await click('.back button'); await wait(`!!document.querySelector('table')`); }
  async function reload() { await cdp('Page.navigate', { url: origin + '/?run=' + Date.now() }); await wait(`!!document.querySelector('#nav-pages')`); await click('#nav-pages'); await wait(`!!document.querySelector('table')`); }
  await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await reload();
  assert.deepEqual(await rowTitles(), ['Home EN', 'Legacy core']); checks.push('Core initially includes uncategorized native and legacy pages only');
  await choose('.titlebar', 'Category', 'All pages');
  await check(`document.querySelector('table').textContent.includes('Article EN') && !document.querySelector('table').textContent.includes('Article FR') && !document.querySelector('table').textContent.includes('Shared')`, 'All pages respects locale and excludes shared records');
  for (const name of ['Article EN', 'Resource EN', 'Legacy article', 'Singleton page']) {
    await textClick('.table-link', name); await wait(`!!document.querySelector('.back button')`);
    await check(`document.querySelector('.back button').textContent === '← Back to Pages'`, name + ' breadcrumb uses actual All pages parent');
    await back(); await check(`document.querySelector('.titlebar button[role=combobox]').textContent.includes('All pages')`, name + ' Back preserves All pages, not document category');
  }
  await choose('.titlebar', 'Category', 'Articles'); await textClick('.table-link', 'Article EN'); await back();
  assert.deepEqual(await rowTitles(), ['Article EN', 'Legacy article']); checks.push('filtered native page Back retains Articles');
  await evaluate(`document.querySelector('.titlebar button[role=combobox]').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End' });
  await wait(`!!document.querySelector('[popover]:popover-open')`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter' });
  await wait(`document.querySelector('.titlebar button[role=combobox]').textContent.includes('Resources')`);
  await check(`document.querySelector('table').textContent.includes('Resource EN') && !document.querySelector('table').textContent.includes('Article EN')`, 'native keyboard category selection filters the table');
  await choose('.titlebar', 'Category', 'Core');
  for (const [category, template, expectedType, expectedTheme] of [['Core', null, 'pageEn', 'light'], ['Articles', 'profileEn', 'profileEn', 'light'], ['Resources', null, 'resourceEn', 'dark']]) {
    const name = `${category} browser draft`, count = writes.length;
    await click('.titlebar .primary'); await wait(`!!document.querySelector('.action-dialog[open]')`); await title(name);
    await choose('.action-dialog', 'Category', category);
    if (template) {
      await click('.action-dialog button[type=submit]'); await wait(`!!document.querySelector('.action-dialog [role=alert]')`);
      assert.equal(writes.length, count); checks.push('ambiguous category requires actual template selection');
      await choose('.action-dialog', 'Template', template);
    }
    await click('.action-dialog button[type=submit]'); await wait(`!document.querySelector('.action-dialog') && !!document.querySelector('.save-button:not(:disabled)')`);
    assert.equal(writes.length, count); checks.push(category + ' creation is unsaved until explicit Save');
    await click('.save-button'); await wait(`document.querySelector('.save-status')?.textContent.trim() === 'Saved'`);
    const saved = writes.at(-1); assert.equal(saved.type, expectedType); assert.equal(saved.data.theme, expectedTheme); assert.equal(saved.data.title, name); assert(!Object.hasOwn(saved.data, 'category'));
    assert.deepEqual(JSON.parse(await readFile(path.join(scratch, `${saved.id}.json`), 'utf8')), saved.data);
    checks.push(category + ' saves selected native type/defaults/identity without category data mutation');
    await back(); await check(`document.querySelector('.titlebar button[role=combobox]').textContent.includes('Core')`, category + ' creation Back retains originating Core filter');
  }
  await reload(); await choose('.titlebar', 'Category', 'All pages');
  await check(`[...document.querySelectorAll('tbody tr')].find(row=>row.textContent.includes('Resources browser draft')).lastElementChild.textContent.trim()==='Resources'`, 'saved selected template reloads in its schema category');
  await textClick('.table-link', 'Resources browser draft');
  await wait(`!!document.querySelector('iframe.revealed')`);
  await check(`document.querySelector('iframe').contentDocument.querySelector('[data-rigel-doc]')?.dataset.rigelDoc==='resourceEn:resources-browser-draft'`, 'saved native type reloads through its configured preview route');
  await back(); await choose('.titlebar', 'Category', 'Resources');
  await click('.titlebar .primary'); await wait(`!!document.querySelector('.action-dialog[open]')`);
  await check(`document.querySelector('.action-dialog button[role=combobox]').textContent.includes('Resources')`, 'new page defaults to table category');
  await click('.action-dialog .action-head button');
  await choose('.content-language', 'Content language', 'Français'); await wait(`!document.querySelector('table')?.textContent.includes('Resource EN')`);
  await choose('.titlebar', 'Category', 'Core'); await click('.titlebar .primary'); await wait(`!!document.querySelector('.action-dialog[open]')`); await title('French browser draft');
  await choose('.action-dialog', 'Category', 'Articles');
  await check(`![...document.querySelectorAll('.action-dialog .select-label')].some(node=>node.textContent==='Template')`, 'French category excludes both English templates');
  await click('.action-dialog button[type=submit]'); await wait(`!document.querySelector('.action-dialog')`);
  failSave = true; await click('.save-button'); await wait(`!!document.querySelector('.save-toast')`);
  await choose('.content-language', 'Content language', 'English'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  await textClick('.unsaved-actions button', 'Keep editing');
  await check(`document.querySelector('.content-language button').textContent.includes('Français') && document.querySelector('.titlebar h2').textContent==='French browser draft'`, 'cancelled locale switch retains locale and unsaved page');
  await choose('.content-language', 'Content language', 'English'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Save and leave');
  await wait(`document.querySelector('.unsaved-dialog')?.textContent.includes('Fixture rejected save')`); checks.push('failed Save keeps locale switch guarded');
  await textClick('.unsaved-actions button', 'Keep editing'); failSave = false; await click('.save-button'); await wait(`document.querySelector('.save-status')?.textContent.trim()==='Saved'`);
  assert.equal(writes.at(-1).type, 'articleFr'); checks.push('French creation uses locale-eligible native document type');
  await back(); await choose('.titlebar', 'Category', 'French only');
  await choose('.content-language', 'Content language', 'English'); await wait(`document.querySelector('.content-language button').textContent.includes('English')`);
  await check(`!document.querySelector('table') || !document.querySelector('table').textContent.includes('French browser draft')`, 'locale-only category safely leaves unavailable selection');
  await click('#nav-pages');
  await check(`document.querySelector('.titlebar button[role=combobox]').textContent.includes('Core')`, 'unavailable locale category resets safely to Core');
  await choose('.titlebar', 'Category', 'All pages'); await textClick('.table-link', 'Article EN'); await back();
  await evaluate(`[...document.querySelectorAll('aside button')].find(node=>node.textContent.trim()==='resourceEn').click()`); await wait(`document.querySelector('.titlebar h2')?.textContent==='resourceEn'`);
  await textClick('.table-link', 'Resource EN'); await back();
  await check(`document.querySelector('.titlebar h2').textContent==='resourceEn'`, 'explicit document-type table Back stays in that table');
  mode = 'plain'; await reload();
  await check(`!document.querySelector('.titlebar button[role=combobox]')`, 'uncategorized schema without category metadata needs no filter');
  await click('.titlebar .primary'); await wait(`!!document.querySelector('.action-dialog')`);
  await check(`!document.querySelector('.action-dialog button[role=combobox]')`, 'single uncategorized template preserves title-only dialog'); await click('.action-head button');
  mode = 'single'; await reload();
  await check(`document.querySelector('table').textContent.includes('Article EN')`, 'category-only site initially shows its existing pages');
  await choose('.titlebar', 'Category', 'Articles'); await click('.titlebar .primary'); await wait(`!!document.querySelector('.action-dialog')`);
  await check(`document.querySelector('.action-dialog button[role=combobox]').textContent.includes('Articles')`, 'single categorized template remains creatable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await check(`document.querySelector('.rigel-modal').scrollWidth <= document.querySelector('.rigel-modal').clientWidth + 1`, 'creation modal fits mobile width');
  await cdp('Page.captureScreenshot', { format: 'png' }).then(result => writeFile(path.join(scratch, 'mobile.png'), Buffer.from(result.data, 'base64')));
  assert.deepEqual(exceptions, []);
  const report = { passed: true, checks: checks.length, results: checks, writes: writes.map(entry => entry.id), coverage: 'Production-built full App in real Chrome; isolated fixture HTTP backend writes scratch JSON only; no host/remote writes.' };
  await writeFile(path.join(scratch, 'results.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) { console.error('FAILURE STATE', await evaluate?.('document.body.innerText').catch(() => ''), exceptions); throw error; }
finally { ws?.close(); chrome?.kill(); await vite?.close(); }
