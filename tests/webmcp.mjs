import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
let origin = process.env.RIGEL_TEST_ORIGIN;
const scratch = path.join(root, '_temp');
await mkdir(scratch, { recursive: true });
let vite;
if (!origin) {
  const fixture = await mkdtemp(path.join(scratch, 'webmcp-site-'));
  await writeFile(path.join(fixture, 'index.html'), '<div id="app"></div><script type="module" src="/main.js"></script>');
  await writeFile(path.join(fixture, 'main.js'), `import {mount,unmount} from 'svelte'; import App from '/src/editor/App.svelte'; import '/src/editor/styles.css'; const app=mount(App,{target:document.getElementById('app')}); window.unmountEditor=()=>unmount(app);`);
  const dictionaries = { en: {}, fr: {} };
  for (const locale of Object.keys(dictionaries)) for (const file of await readdir(path.join(root, 'src/editor/i18n', locale))) if (file.endsWith('.json')) Object.assign(dictionaries[locale], JSON.parse(await readFile(path.join(root, 'src/editor/i18n', locale, file), 'utf8')));
  const virtual = { name: 'webmcp-fixture-config', resolveId(id) { if (id.startsWith('virtual:rigel-')) return '\0' + id; }, load(id) { if (id.startsWith('\0virtual:rigel-')) return 'export default ' + JSON.stringify(id.endsWith('config') ? { backend: 'local', languages: ['en', 'fr'], defaultLanguage: 'en' } : id.endsWith('i18n') ? dictionaries : []); } };
  vite = await createServer({ configFile: false, root: fixture, publicDir: false, logLevel: 'error', plugins: [virtual, svelte()], resolve: { alias: { '/src': path.join(root, 'src') }, dedupe: ['svelte'] }, server: { host: '127.0.0.1', port: 0, fs: { allow: [root] } } });
  await vite.listen();
  origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
}
const profile = await mkdtemp(path.join(scratch, 'webmcp-browser-'));
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--enable-experimental-web-platform-features', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) { for (let i = 0; i < 100; i++) { const result = await fn(); if (result) return result; await delay(100); } throw new Error('Timed out: ' + label); }
let ws, inspect;
const exceptions = [];
try {
  assert.equal((await fetch(origin + '/rigel/')).status, 200, 'Start a site serving the current Rigel source first');
  const port = await until(async () => { try { return (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; } catch { return false; } }, 'Chrome');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  ws = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data);
    if (result.method === 'Runtime.exceptionThrown') exceptions.push(result.params.exceptionDetails);
    const request = pending.get(result.id);
    if (request) { pending.delete(result.id); clearTimeout(request.timer); result.error ? request.reject(result.error) : request.resolve(result.result); }
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id; const timer = setTimeout(() => { pending.delete(key); reject(new Error(method + ' timed out')); }, 15000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => { const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  inspect = () => evaluate(`({text:document.body.innerText, tools:[...tools.keys()],writes})`);
  const wait = expression => until(() => evaluate(expression), expression);
  const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const textClick = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(text)}).click()`);
  await cdp('Runtime.enable'); await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `
    (() => { if(window !== top) return;
    const mode = new URL(location.href).searchParams.get('fixture');
    if(mode === 'missing') { Object.defineProperty(crypto, 'randomUUID', {value:undefined}); Object.defineProperty(document,'modelContext',{value:undefined}); }
    window.tools = new Map(); window.retired = []; window.writes = [];
    if(mode !== 'missing' && mode !== 'native') Object.defineProperty(document, 'modelContext', {value: {
      async registerTool(tool, {signal}) { await Promise.resolve(); if(signal.aborted) return; tools.set(tool.name, tool); signal.addEventListener('abort', () => { if(tools.get(tool.name) === tool) tools.delete(tool.name); retired.push(tool); }, {once:true}); }
    }});
    window.run = async (name, input = {}, signal = new AbortController().signal) => tools.get(name).execute(input, {signal});
    const config = {repo:'fixture/repository',branch:'drafts',publishBranch:'main',appSlug:'fixture',authOrigin:'https://auth.invalid',repoRoot:'',copyDir:'src/copy',collections:[]};
    const type = {name:'page',title:'Page',type:'document',folder:'pages',fields:[{key:'title',label:'Title',type:'string',required:true},{key:'seo',label:'SEO',type:'object',fields:[{key:'description',label:'Description',type:'text'}]},{key:'password',label:'Password',type:'password'},{key:'cards',label:'Cards',type:'array',items:[{type:'object',fields:[{key:'caption',label:'Caption',type:'string'},{key:'image',label:'Image',type:'image'}]}]}]};
    const doc = {id:'page:home',type:'page',slug:'home',data:{_id:'page:home',_type:'page',title:'Native page',seo:{description:'Original SEO'},password:'not-exposed',cards:[{_key:'kOne',caption:'Old card',image:'/image.png'}]}};
    const manifest = {contentLocales:{defaultLocale:'en',locales:[{code:'en',label:'English'},{code:'fr',label:'Français'}]},pages:[{slug:'home',label:'Home',groups:[{id:'hero',label:'Hero',fields:[{key:'title',label:'Title',type:'string'}]}],values:{hero:{title:'Original title'}}}], ...(mode === 'schema' ? {schema:{documents:[type],objects:[]},documents:[doc]} : {}), ...(mode.startsWith('github') ? {backend:'github',github:config} : mode === 'demo' ? {backend:'demo'} : {})};
    if (mode === 'broad' || mode === 'native') {
      const body = {root:{type:'root',version:1,children:[{type:'paragraph',version:1,children:[{type:'text',version:1,text:'Original article',format:0}]}]}};
      manifest.collections = ['blog','news'].map(name => ({name,label:name,fields:[{key:'title',label:'Title',type:'string',required:true},{key:'tags',label:'Tags',type:'tags'},{key:'description',label:'Description',type:'markdown'},{key:'date',label:'Date',type:'date'}],posts:[{slug:'hello',frontmatter:{title:name+' article',tags:['original'],description:'**Intro**',date:'2026-11-01'},body}]}));
      manifest.preview = {draftUrl:'https://preview.invalid',collections:{blog:{url:'/blog/{slug}',new:'/webmcp-preview'}}};
      manifest.menus = {maxDepth:2,entries:[{slug:'main',title:'Main menu',items:[]}]};
      manifest.pages.push({slug:'site',label:'Site copy',shared:true,groups:[{id:'footer',label:'Footer',fields:[{key:'body',label:'Body',type:'markdown'},{key:'links',label:'Links',type:'list',item:{fields:[{key:'label',label:'Label',type:'string'}]}}]}],values:{footer:{body:'Footer copy',links:[{label:'Old link'}]}}});
    }
    window.access = 'ready'; window.clockOffset = 0;
    window.open = url => { const popup = {closed:false,close(){this.closed=true}}; setTimeout(() => { const event = new MessageEvent('message',{origin:'https://auth.invalid',data:{type:'rigel:auth',provider:'github',nonce:new URL(url).searchParams.get('nonce'),access_token:'ghu_fixture_not_a_real_credential',expires_in:3600}}); Object.defineProperty(event,'source',{value:popup}); window.dispatchEvent(event); }, 50); return popup; };
    const now = Date.now.bind(Date); Date.now = () => now() + clockOffset;
    if(mode.startsWith('github') && mode !== 'github-unverified') localStorage.setItem('rigelcms.session',JSON.stringify({version:1,scope:JSON.stringify([config.authOrigin,config.repo,config.branch,config.appSlug]),accessToken:'ghu_fixture_not_a_real_credential',expiresAt:Date.now()+(mode === 'github-short' ? 33000 : 3600000)}));
    else localStorage.removeItem('rigelcms.session');
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = init?.method ?? 'GET';
      if(!['GET','HEAD','OPTIONS'].includes(method)) { writes.push(url.pathname); if(window.allowSave && url.pathname === '/rigel/api/local/save') { await new Promise(resolve => { window.releaseSave=resolve; }); return new Response('{}'); } throw Error('Unexpected persistence'); }
      const json = value => Promise.resolve(new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));
      if(url.pathname === '/webmcp-preview') { await new Promise(resolve => {window.releasePreview=resolve;}); return new Response('<main><h1 data-rigel-text="title"></h1><article data-rigel-richtext="$body"></article></main>',{headers:{'Content-Type':'text/html'}}); }
      if(url.pathname === '/rigel/manifest.json') return json(manifest);
      if(url.hostname === 'api.github.com') {
        if(access === 'network') throw Error('Verification failed');
        if(url.pathname === '/user') return json({login:'fixture',avatar_url:'fixture-avatar',html_url:'https://github.com/fixture'});
        if(url.pathname === '/user/installations') return json({installations:[{id:1,app_slug:'fixture',account:{login:'fixture'},permissions:{contents:'write'}}]});
        if(url.pathname.endsWith('/repositories')) return json({repositories:[{id:1,full_name:config.repo,default_branch:'main',permissions:{push:access === 'ready'}}]});
        if(url.pathname.endsWith('/git/ref/heads/drafts')) return json({object:{sha:'a'.repeat(40)}});
        if(url.pathname.includes('/git/trees/')) return json({truncated:false,tree:[{path:'src/copy/home.ts',type:'blob',mode:'100644',sha:'b'.repeat(40)}]});
        if(url.pathname.includes('/git/blobs/')) return json({sha:'b'.repeat(40),encoding:'base64',content:btoa('export default defineCopy({values:{hero:{title:"Original title"}}});')});
        throw Error('Unexpected GitHub GET: '+url.pathname);
      }
      return originalFetch(input,init);
    }; })();
  ` });
  async function load(mode) {
    await cdp('Page.navigate', { url: origin + '/rigel/?fixture=' + mode });
    await wait(`!!document.querySelector('#nav-pages')`);
    await click('#nav-pages'); await wait(`!!document.querySelector('.table-link')`);
    await textClick('.table-link', mode === 'schema' ? 'Native page' : 'Home');
    await wait(`!!document.querySelector('.save-button')`);
  }
  const read = () => evaluate(`run('rigel_read_draft')`);
  const update = (context, field, value) => evaluate(`run('rigel_update_field',${JSON.stringify({ context, path: field, value })})`);
  await load('local');
  await wait(`tools.size === 5`);
  let snapshot = await read();
  assert.equal(snapshot.fields[0].value, 'Original title');
  await update(snapshot.context, 'hero.title', 'Agent draft');
  assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input:not([readonly])').value`), 'Agent draft');
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), false);
  await assert.rejects(() => update(snapshot.context, 'hero.title', 'Stale'), /draft changed/);
  const beforeHumanEdit = (await read()).context;
  await evaluate(`(()=>{const input=document.querySelector('#rigel-editor-pane input:not([readonly])');input.value='Human draft';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  assert.equal((await read()).fields[0].value, 'Human draft');
  await assert.rejects(() => update(beforeHumanEdit, 'hero.title', 'Overwrite human'), /draft changed/);
  await evaluate(`(()=>{const input=document.querySelector('#rigel-editor-pane input:not([readonly])');input.value='Agent draft';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('#nav-pages'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  await assert.rejects(read, /busy|dialog/i);
  await textClick('.unsaved-actions button', 'Keep editing');
  assert.equal((await read()).fields[0].value, 'Agent draft');
  assert.deepEqual(await evaluate('writes'), []);
  await click('.back button');
  await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Discard changes');
  await textClick('.table-link', 'Home');
  assert.equal((await read()).fields[0].value, 'Original title');
  const beforeLocale = (await read()).context;
  await click('.content-language button[role=combobox]');
  await wait(`!!document.querySelector('[popover]:popover-open')`);
  await textClick('[popover]:popover-open [role=option] span:first-child', 'Français');
  assert.equal((await read()).locale, 'fr');
  await assert.rejects(() => update(beforeLocale, 'hero.title', 'Wrong locale'), /draft changed/);
  await load('schema'); await wait(`tools.size === 5`);
  snapshot = await read(); assert(!JSON.stringify(snapshot).includes('not-exposed'));
  await update(snapshot.context, 'seo.description', 'Agent SEO');
  assert.equal((await read()).fields.find(field => field.path === 'seo.description').value, 'Agent SEO');
  await update((await read()).context, 'title', 'Agent native title');
  assert.equal(await evaluate(`document.querySelector('.titlebar h2').textContent`), 'Agent native title');
  await assert.rejects(async () => update((await read()).context, 'password', 'leak'), /Unsupported field/);
  await assert.rejects(async () => update((await read()).context, 'title', ''), /required/);
  await update((await read()).context, 'cards', [{_key:'kOne',caption:'New card',image:'/next.png'},{_key:'kTwo',caption:'Added card',image:'/added.png'}]);
  await update((await read()).context, 'cards.kTwo.caption', 'Nested card');
  assert.equal((await read()).fields.find(field => field.path === 'cards').value[1].caption, 'Nested card');
  await assert.rejects(async () => update((await read()).context, 'cards', [{_key:'kOne',password:'blocked'}]), /Unknown|secret/i);
  assert.deepEqual(await evaluate('writes'), []);
  await load('broad');
  const catalog = await evaluate(`run('rigel_list_content')`);
  assert.equal(catalog.entries.length, 5);
  assert(!JSON.stringify(catalog).includes('Original article'));
  const selectEntry = async target => evaluate(`run('rigel_select_content',${JSON.stringify({context:(await evaluate(`run('rigel_list_content')`)).context,selection:target})})`);
  await selectEntry({kind:'post',collection:'blog',slug:'hello'});
  await wait(`typeof releasePreview === 'function'`);
  await assert.rejects(read, /busy|loading/i);
  await evaluate('releasePreview()');
  await wait(`document.querySelector('.canvas-stage')?.dataset.ready === 'true'`);
  await wait(`tools.has('rigel_read_draft')`);
  snapshot = await read();
  assert.equal(snapshot.selection.kind, 'post');
  assert(JSON.stringify(snapshot.body).includes('Original article'));
  await update(snapshot.context, 'tags', ['agent']);
  await evaluate(`run('rigel_replace_article_body', {context:${JSON.stringify((await read()).context)},format:'markdown',value:'# Agent article\\n\\nNew **body**'})`);
  assert(JSON.stringify((await read()).body).includes('Agent article'));
  assert.equal(await evaluate(`document.querySelector('.visual-editor iframe').contentDocument.querySelector('article').textContent.includes('Agent article')`), true);
  await evaluate(`document.querySelector('.visual-editor iframe').contentDocument.body.insertAdjacentHTML('beforeend','<dialog open>Link dialog</dialog>')`);
  await assert.rejects(read, /busy|dialog/i);
  await evaluate(`document.querySelector('.visual-editor iframe').contentDocument.querySelector('dialog').remove()`);
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), false);
  assert.deepEqual(await evaluate('writes'), []);
  const navigation = await selectEntry({kind:'post',collection:'news',slug:'hello'});
  assert.equal(navigation.pendingConfirmation, true);
  await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  await assert.rejects(read, /busy|dialog/i);
  await textClick('.unsaved-actions button', 'Discard changes');
  assert.equal((await read()).selection.collection, 'news');
  await update((await read()).context, 'title', 'News draft');
  await click('#nav-menus'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Discard changes');
  await textClick('.table-link', 'Main menu');
  await update((await read()).context, 'items', [{id:'home',label:'Agent home',url:'/',children:[]}]);
  assert((await evaluate('document.body.innerText')).includes('Agent home'));
  await click('[data-page="site"]'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`); await textClick('.unsaved-actions button', 'Discard changes');
  await update((await read()).context, 'footer.body', '**Shared draft**');
  await update((await read()).context, 'footer.links', [{label:'New link'}]);
  assert.equal((await read()).fields.find(field => field.path === 'footer.links').value[0].label, 'New link');
  assert.deepEqual(await evaluate('writes'), []);
  await load('github'); await wait(`tools.size === 5`);
  snapshot = await read();
  await update(snapshot.context, 'hero.title', 'GitHub unsaved');
  await click('.user-btn'); await click('#github-sign-out');
  await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  await textClick('.unsaved-actions button', 'Keep editing');
  assert.equal((await read()).fields[0].value, 'GitHub unsaved');
  await evaluate(`clockOffset = 3600000`);
  await assert.rejects(read, /expired/);
  await wait(`tools.size === 0`);
  assert.equal(await evaluate(`document.querySelector('#rigel-editor-pane input:not([readonly])').value`), 'GitHub unsaved');
  assert.deepEqual(await evaluate('writes'), []);
  await load('github'); await wait(`tools.size === 5`);
  await evaluate(`window.oldRead = tools.get('rigel_read_draft'); access = 'readonly'`);
  await click('.user-btn'); await click('.github-reconnect');
  await wait(`tools.size === 0`);
  await assert.rejects(() => evaluate(`oldRead.execute({}, {signal:new AbortController().signal})`));
  await load('github'); await wait(`tools.size === 5`);
  await click('.user-btn'); await click('#github-sign-out');
  await wait(`!!document.querySelector('#github-sign-in') && tools.size === 0`);
  await load('github-short'); await wait(`tools.size === 5`);
  await wait(`tools.size === 0`);
  assert.equal(await evaluate(`localStorage.getItem('rigelcms.session')`), null);
  await cdp('Page.navigate', {url:origin + '/rigel/?fixture=github-unverified'});
  await wait(`!!document.querySelector('#github-sign-in:not(:disabled)')`);
  assert.equal(await evaluate('tools.size'), 0);
  await click('#github-sign-in'); await wait(`!!document.querySelector('#nav-pages')`);
  await click('#nav-pages'); await textClick('.table-link', 'Home'); await wait(`tools.size === 5`);
  await evaluate(`window.oldRead = tools.get('rigel_read_draft'); access = 'network'`);
  await click('.user-btn'); await click('.github-reconnect');
  await wait(`document.querySelector('.github-session')?.textContent.includes('Unable to reach GitHub')`);
  assert.equal(await evaluate('tools.size'), 0);
  await assert.rejects(() => evaluate(`oldRead.execute({}, {signal:new AbortController().signal})`));
  assert.deepEqual(await evaluate('writes'), []);
  if (vite) {
    await load('local'); await wait(`tools.size === 5`);
    await update((await read()).context, 'hero.title', 'Save explicitly');
    assert.deepEqual(await evaluate('writes'), []);
    await evaluate(`window.allowSave = true`);
    await click('.save-button'); await wait(`typeof releaseSave === 'function'`);
    await assert.rejects(read, /busy/);
    assert.deepEqual(await evaluate('writes'), ['/rigel/api/local/save']);
    await evaluate(`releaseSave()`);
    await wait(`document.querySelector('.save-status')?.textContent.trim() === 'Saved'`);
    assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), true);
    assert.equal((await read()).fields[0].value, 'Save explicitly');
    await evaluate(`window.oldRead=tools.get('rigel_read_draft'); unmountEditor()`);
    await wait(`tools.size === 0`);
    await assert.rejects(() => evaluate(`oldRead.execute({}, {signal:new AbortController().signal})`));
  }
  await load('demo'); assert.equal(await evaluate('tools.size'), 0);
  await load('missing'); assert.equal(await evaluate('tools.size'), 0);
  await load('native');
  const nativeApi = await evaluate(`typeof document.modelContext?.getTools === 'function' && typeof document.modelContext?.executeTool === 'function'`);
  if (nativeApi) {
    await wait(`document.modelContext.getTools().then(tools=>tools.filter(tool=>tool.name.startsWith('rigel_')).length===5)`);
    const nativeRun = async (name, input = {}) => {
      const result = await evaluate(`(async()=>{const tool=(await document.modelContext.getTools()).find(tool=>tool.name===${JSON.stringify(name)});return document.modelContext.executeTool(tool,${JSON.stringify(input)});})()`);
      return typeof result === 'string' ? JSON.parse(result) : result;
    };
    const nativeCatalog = await nativeRun('rigel_list_content');
    assert.equal(nativeCatalog.entries.length, 5);
    const nativeDraft = await nativeRun('rigel_read_draft');
    assert.equal(nativeDraft.selection.kind, 'page');
    await nativeRun('rigel_update_field', {context:nativeDraft.context,path:'hero.title',value:'Native Chrome draft'});
    assert.equal((await nativeRun('rigel_read_draft')).fields[0].value, 'Native Chrome draft');
    await assert.rejects(() => nativeRun('rigel_update_field', {context:nativeDraft.context,path:'hero.title',value:'Stale native write'}));
    const nativeSelect = async selection => nativeRun('rigel_select_content', {context:(await nativeRun('rigel_list_content')).context,selection});
    assert.equal((await nativeSelect({kind:'post',collection:'news',slug:'hello'})).pendingConfirmation, true);
    await textClick('.unsaved-actions button', 'Discard changes');
    let current = await nativeRun('rigel_read_draft');
    assert.equal(current.selection.collection, 'news');
    await nativeRun('rigel_replace_article_body', {context:current.context,format:'markdown',value:'# Native article\n\nFull body draft'});
    assert(JSON.stringify((await nativeRun('rigel_read_draft')).body).includes('Native article'));
    await nativeSelect({kind:'menu',slug:'main'}); await textClick('.unsaved-actions button', 'Discard changes');
    current = await nativeRun('rigel_read_draft');
    await nativeRun('rigel_update_field', {context:current.context,path:'items',value:[{id:'native',label:'Native menu draft',url:'/',children:[]}]});
    assert.equal((await nativeRun('rigel_read_draft')).fields.find(field=>field.path==='items').value[0].label, 'Native menu draft');
    await nativeSelect({kind:'page',slug:'site'}); await textClick('.unsaved-actions button', 'Discard changes');
    await nativeRun('rigel_update_field', {context:(await nativeRun('rigel_read_draft')).context,path:'footer.body',value:'**Native shared draft**'});
    assert.equal((await nativeRun('rigel_read_draft')).fields.find(field=>field.path==='footer.body').value, '**Native shared draft**');
    assert.deepEqual(await evaluate('writes'), []);
    const screenshot = await cdp('Page.captureScreenshot', {format:'png'});
    await writeFile(path.join(scratch,'webmcp-native.png'), Buffer.from(screenshot.data,'base64'));
    if (vite) { await evaluate('unmountEditor()'); await wait(`document.modelContext.getTools().then(tools=>!tools.some(tool=>tool.name.startsWith('rigel_')))`); }
    console.log('PASS: native Chrome discovery/read/unsaved page, article-body, menu and shared edits, stale token, guarded selection and unmount; network fixture mocked, native WebMCP API not mocked. Browser: ' + (await cdp('Browser.getVersion')).product);
  } else console.log('SKIP: native Chrome WebMCP discovery/execution API unavailable in this build.');
  assert.deepEqual(exceptions, []);
  const report = {passed:true,browser:(await cdp('Browser.getVersion')).product,nativeWebMCP:nativeApi,toolPersistenceRequests:0,scenarios:['local/schema/SEO/structured fields','blog/news metadata and article body','menus/shared copy','catalog/selection/unsaved confirmation','preview loading and iframe dialogs','stale context/locale/human edits','GitHub login/expiry/access loss/logout','demo/absent API',...(vite?['explicit UI Save/save busy/unmount']:[])]};
  await writeFile(path.join(scratch,'webmcp-results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS: WebMCP full App pages/schema/SEO/structured fields, blog/news/body, menus/shared, catalog/selection, stale/locale/human edits, preview loading/iframe dialogs, discard, GitHub login/expiry/access loss/logout, demo/absent API${vite ? ', save-busy/explicit Save/unmount' : ''}; zero tool persistence requests. Main scenarios mock the native API; native execution is reported separately. Artifacts: _temp/webmcp-results.json, _temp/webmcp-native.png (when native API available).`);
} catch (error) {
  console.error(await inspect?.().catch(() => null), exceptions);
  throw error;
} finally {
  ws?.close(); chrome.kill(); await vite?.close();
}
