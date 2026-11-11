import assert from "node:assert/strict";

export async function runRecovery({ cdp, evaluate, wait, click, shot, origin, writes, exceptions, manifest, recoveryBackend, delay }) {
  const records = `Object.keys(localStorage).filter(key=>key.startsWith('rigelcms.drafts.')).map(key=>JSON.parse(localStorage.getItem(key)))`;
  const input = 'main input:not([readonly])';
  const set = (selector, value) => evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const navigate = async hash => { await evaluate(`location.hash=${JSON.stringify(hash)}`); };
  const reload = async () => {
    const previous = await evaluate("performance.timeOrigin");
    await cdp("Page.reload", { ignoreCache: true });
    await wait(`performance.timeOrigin !== ${previous} && !!document.querySelector('#nav-pages')`);
  };
  const discardAndGo = async () => {
    await click('.brand'); await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
    await click('.unsaved-dialog .unsaved-actions button:nth-child(2)');
    await wait(`!document.querySelector('.unsaved-dialog') && !!document.querySelector('.welcome')`);
  };
  await navigate('#/copy/home'); await wait(`!!document.querySelector('${input}')`);
  await set(input, 'Recovered page title');
  await reload();
  await wait(`!!document.querySelector('.recovery-notice')`);
  assert.equal(await evaluate(`document.querySelector('${input}').value`), 'Original title', 'no automatic restore');
  assert.equal(writes.length, 0, 'backups and reload do not write remotely');
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.recovery-notice').scrollWidth <= document.querySelector('.recovery-notice').clientWidth`));
    assert.ok(await evaluate(`[...document.querySelectorAll('.recovery-actions button')].every(button => button.getBoundingClientRect().height === 36)`), 'recovery actions use the shared 36px button size');
    await shot(`recovery-${width}`);
  }
  await click('.recovery-notice .primary');
  await wait(`document.querySelector('${input}').value === 'Recovered page title' && !document.querySelector('.save-button').disabled`);
  assert.equal(writes.length, 0, 'restore is unsaved');
  recoveryBackend.fail = true;
  await click('.save-button'); await wait(`document.querySelector('.save-status').textContent.includes('Save failed') || !!document.querySelector('.toast[data-kind="error"]')`);
  await reload(); await wait(`!!document.querySelector('.recovery-notice')`);
  await click('.recovery-notice .primary');
  recoveryBackend.fail = false;
  await click('.save-button'); await wait(`document.querySelector('.save-status').textContent.includes('Saved')`);
  assert.equal(manifest.pages[0].values.hero.title, 'Recovered page title');
  assert.deepEqual(await evaluate(records), [], 'successful Save clears restored and current backups');
  await reload(); await wait(`!!document.querySelector('${input}')`);
  assert.ok(await evaluate(`!document.querySelector('.recovery-notice')`));

  await set(input, 'Explicit discard'); await delay(550);
  await discardAndGo();
  assert.deepEqual(await evaluate(records), [], 'Discard and leave removes the backup');
  await navigate('#/copy/home'); await wait(`!!document.querySelector('${input}')`);
  await set(input, 'Old backup'); await delay(550);
  manifest.pages[0].values.hero.title = 'Someone else changed this';
  await reload(); await wait(`!!document.querySelector('.recovery-notice [role=status]')`);
  assert.ok(await evaluate(`document.querySelector('.recovery-notice [role=status]').textContent.includes('saved content has changed')`));
  await click('.recovery-notice .outlined');
  assert.equal(await evaluate(`document.querySelector('${input}').value`), 'Someone else changed this', 'discard backup keeps current saved content');
  assert.deepEqual(await evaluate(records), []);

  await navigate('#/settings/site'); await wait(`!!document.querySelector('.document-form input')`);
  await set('.document-form input', 'Unsaved settings'); await delay(550);
  const seed = (await evaluate(records))[0];
  assert.ok(seed);
  await reload(); await wait(`!!document.querySelector('.recovery-notice')`);
  await click('.recovery-notice .primary');
  assert.equal(await evaluate(`document.querySelector('.document-form input').value`), 'Unsaved settings');
  await discardAndGo();

  await navigate('#/menus/main'); await wait(`!!document.querySelector('.menu-details input:not([readonly])')`);
  await set('.menu-details input:not([readonly])', 'Unsaved navigation'); await reload();
  await wait(`!!document.querySelector('.recovery-notice')`); await click('.recovery-notice .primary');
  assert.equal(await evaluate(`document.querySelector('.menu-details input:not([readonly])').value`), 'Unsaved navigation');
  await discardAndGo();

  const body = { root: { type: 'root', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'paragraph', version: 1, direction: null, format: '', indent: 0, children: [{ type: 'text', version: 1, text: 'Recovered article body', format: 0, detail: 0, mode: 'normal', style: '' }] }] } };
  const article = { ...seed, id: 'article-backup', selection: { kind: 'post', collection: 'blog', slug: 'test' }, values: { title: 'Recovered article' }, body };
  const fresh = { ...article, id: 'new-article-backup', selection: { kind: 'post', collection: 'blog', slug: 'new-unsaved-article' }, creating: true, base: { values: null, body: '' } };
  const newDocument = { ...seed, id: 'new-document-backup', selection: { kind: 'document', type: 'settings', id: 'settings:new-settings' }, creating: true, base: { values: null, body: '' }, values: { title: 'Recovered new document' } };
  await evaluate(`localStorage.setItem('rigelcms.drafts.article-backup',${JSON.stringify(JSON.stringify(article))});`);
  await navigate('#/collections/blog/test'); await wait(`!!document.querySelector('.recovery-notice')`);
  await click('.recovery-notice .primary');
  await wait(`document.querySelector('.titlebar h2').textContent === 'Recovered article'`);
  await wait(`document.querySelector('.canvas-stage iframe')?.contentDocument.body.textContent.includes('Recovered article body')`);
  await reload(); await wait(`!!document.querySelector('.recovery-notice')`);
  await click('.recovery-notice .primary'); await discardAndGo();
  for (const record of [fresh, newDocument]) {
    await evaluate(`localStorage.setItem(${JSON.stringify('rigelcms.drafts.' + record.id)},${JSON.stringify(JSON.stringify(record))});`);
    await reload(); await wait(`document.querySelectorAll('.recovery-entry').length === 1`);
    await click('.recovery-entry .outlined'); await wait(`!!document.querySelector('.recovery-notice')`);
    await click('.recovery-notice .primary');
    await wait(`document.querySelector('.save-button') && !document.querySelector('.save-button').disabled`);
    assert.equal(writes.length, 2, 'review and restore new content never save');
    if (record.selection.kind === 'document') assert.equal(await evaluate(`document.querySelector('.document-form input').value`), 'Recovered new document');
    else await wait(`document.querySelector('.titlebar h2').textContent === 'Recovered article'`);
    await discardAndGo();
    assert.deepEqual(await evaluate(records), []);
  }

  await navigate('#/copy/home'); await wait(`!!document.querySelector('${input}')`);
  await set(input, 'Still editing in the original tab'); await delay(550);
  const live = (await evaluate(records))[0];
  const second = await cdp('Target.createTarget', { url: origin + '/#/copy/home' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId: second.targetId, flatten: true });
  const other = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  for (let i = 0; i < 100 && !(await other(`!!document.querySelector('.recovery-notice')`)); i++) await delay(100);
  assert.ok(await other(`!!document.querySelector('.recovery-notice')`));
  await other(`document.querySelector('.recovery-notice .primary').click()`); await delay(550);
  assert.ok((await evaluate(records)).some(record => record.id === live.id), 'restoring a live tab never consumes its backup');
  await other(`document.querySelector('.brand').click()`); await delay(100);
  await other(`document.querySelector('.unsaved-dialog .unsaved-actions button:nth-child(2)').click()`); await delay(150);
  assert.ok((await evaluate(records)).some(record => record.id === live.id), 'discarding the recovered copy leaves the live original recoverable');
  await other(`document.querySelector('.recovery-entry .outlined').click()`); await delay(150);
  await other(`document.querySelector('.recovery-notice .primary').click()`); await delay(150);
  const writesBeforeOtherSave = writes.length;
  await other(`document.querySelector('.save-button').click()`);
  for (let i = 0; i < 100 && !(await other(`document.querySelector('.save-status')?.textContent.includes('Saved')`)); i++) await delay(100);
  assert.ok(await other(`document.querySelector('.save-status')?.textContent.includes('Saved')`));
  assert.equal(writes.length, writesBeforeOtherSave + 1);
  assert.ok((await evaluate(records)).some(record => record.id === live.id), 'saving a recovered copy preserves the live original backup');
  await cdp('Target.closeTarget', { targetId: second.targetId });
  await discardAndGo();

  await navigate('#/copy/home'); await wait(`!!document.querySelector('${input}')`);
  await evaluate(`window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('rigelcms.drafts.'))throw new DOMException('full','QuotaExceededError');return originalSetItem.call(this,key,value)}`);
  await set(input, 'Not lost on quota error');
  await wait(`document.querySelector('[role=alert]')?.textContent.includes('Draft recovery is unavailable')`);
  assert.equal(await evaluate(`document.querySelector('${input}').value`), 'Not lost on quota error');
  await evaluate(`Storage.prototype.setItem=window.originalSetItem`);
  await discardAndGo();
  assert.deepEqual(exceptions, [], 'no browser exceptions');
  console.log('PASS draft recovery: actual reload and pagehide flush, explicit Restore/Discard, failed Save/retry, saved baseline warning, copy/native/menu/article bodies, new pages/posts, mobile, quota error, no implicit content writes.');
}
