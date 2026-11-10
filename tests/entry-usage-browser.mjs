import assert from "node:assert/strict";

export async function runEntryUsage({ cdp, evaluate, wait, click, shot, origin, writes, exceptions }) {
  const go = async hash => { await evaluate(`location.hash=${JSON.stringify(hash)}`); };
  await go('#/author/alex');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Alex'`);
  await wait(`!!document.querySelector('.entry-usage .usage-trigger')`);
  assert.equal(await evaluate(`document.querySelector('.entry-usage .usage-trigger').textContent.trim()`), 'Used in 3');
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), true, 'checking usage does not dirty content');
  await click('.entry-usage .usage-trigger');
  await wait(`document.querySelector('.entry-usage .media-usage').matches(':popover-open')`);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.entry-usage a')].map(a=>[a.textContent,a.getAttribute('href')])`), [
    ['Landing', '#/pages/landing?locale=en'], ['Accueil', '#/pageFr/accueil?locale=fr'], ['Test post', '#/collections/blog/test?locale=en'],
  ]);
  assert.ok(await evaluate(`document.querySelector('main').lastElementChild.matches('.entry-usage')`), 'Used in is after all editor sections');
  assert.equal(await evaluate(`document.querySelector('.entry-usage .usage-trigger').getBoundingClientRect().height`), 36, 'matches image usage button sizing');
  await evaluate(`document.querySelector('.entry-usage .usage-trigger').focus()`);
  for (const open of [false, true]) {
    await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await wait(`document.querySelector('.entry-usage .media-usage').matches(':popover-open') === ${open}`);
  }
  await evaluate(`document.querySelector('.entry-usage a').focus()`);
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(`!document.querySelector('.entry-usage .media-usage').matches(':popover-open')`);
  assert.ok(await evaluate(`document.activeElement.matches('.entry-usage .usage-trigger')`), 'Escape returns focus to Used in');
  await click('.entry-usage .usage-trigger');
  for (const width of [1280, 390]) {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('.entry-usage').scrollWidth <= document.querySelector('.entry-usage').clientWidth`), 'usage fits the viewport');
    await wait(`(()=>{const r=document.querySelector('.entry-usage .media-usage').getBoundingClientRect();return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight})()`);
    await shot(`entry-usage-${width}`);
    await evaluate(`{const list=document.querySelector('.entry-usage ul');for(let i=list.children.length;i<1000;i++){const row=list.firstElementChild.cloneNode(true);row.dataset.stressRow='';list.append(row)}}`);
    await wait(`(()=>{const p=document.querySelector('.entry-usage .media-usage');return p.getBoundingClientRect().height <= 240 && p.scrollHeight > p.clientHeight})()`);
    assert.ok(await evaluate(`(()=>{const p=document.querySelector('.entry-usage .media-usage');p.scrollTop=p.scrollHeight;return p.scrollTop > 0 && p.getBoundingClientRect().bottom <= innerHeight})()`), '1,000 usage rows stay capped at 240px with internal scrolling');
    await shot(`entry-usage-1000-${width}`);
    await evaluate(`document.querySelectorAll('.entry-usage [data-stress-row]').forEach(row=>row.remove());document.querySelector('.entry-usage .media-usage').scrollTop=0`);
  }
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('.document-form input').value='Changed author';document.querySelector('.document-form input').dispatchEvent(new Event('input',{bubbles:true}))`);
  await click('.entry-usage a');
  await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  assert.ok(await evaluate(`document.querySelector('.titlebar h2').textContent === 'Changed author'`));
  await click('.unsaved-dialog .unsaved-actions button:first-child');
  await wait(`!document.querySelector('.unsaved-dialog')`);
  assert.equal(await evaluate(`document.querySelector('.document-form input').value`), 'Changed author', 'Keep editing preserves the draft');
  await click('.entry-usage .usage-trigger');
  await click('.entry-usage a');
  await wait(`!!document.querySelector('.unsaved-dialog[open]')`);
  await click('.unsaved-dialog .unsaved-actions button:nth-child(2)');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Landing'`);
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), true);
  assert.ok(await evaluate(`!!document.querySelector('.visual-editor.with-panel') && document.querySelector('#properties-tab-page')?.getAttribute('aria-selected') === 'true'`), 'pages open their properties on Page');
  await click('#properties-tab-content');
  assert.equal(await evaluate(`document.querySelector('#properties-tab-content').getAttribute('aria-selected')`), 'true');
  await click('.visual-actions button[aria-pressed]');
  assert.ok(await evaluate(`!document.querySelector('.visual-editor.with-panel')`), 'editors can close properties');
  await go('#/pageFr/accueil?locale=fr');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Accueil'`);
  await wait(`!!document.querySelector('.visual-editor.with-panel') && document.querySelector('#properties-tab-page')?.getAttribute('aria-selected') === 'true'`);
  assert.equal(await evaluate(`document.querySelector('.save-button').disabled`), true, 'opening Page settings is not a content edit');
  await go('#/author/alex?locale=en');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Alex'`);
  await click('.entry-usage .usage-trigger');
  await click('.entry-usage a[href*="accueil"]');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Accueil'`);
  assert.equal(await evaluate(`new URLSearchParams(location.hash.split('?')[1]).get('locale')`), 'fr', 'cross-locale backlinks change the content locale');
  await go('#/author/alex?locale=fr');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Alex'`);
  await click('.entry-usage .usage-trigger');
  await click('.entry-usage a[href*="collections"]');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Test post' && document.querySelector('.save-button').disabled`);
  assert.ok(await evaluate(`!document.querySelector('.entry-usage')`), 'articles cannot be reference targets');
  await go('#/author/unused?locale=en');
  await wait(`document.querySelector('.titlebar h2')?.textContent === 'Unused author'`);
  await click('.entry-usage .usage-trigger');
  await wait(`document.querySelector('.entry-usage [role=status]')?.textContent.includes('No references')`);
  assert.equal(await evaluate(`document.querySelectorAll('.entry-usage a').length`), 0);
  assert.equal(writes.length, 0, 'usage and guarded navigation never save or publish');
  assert.deepEqual(exceptions, []);
  console.log('PASS entry usage: document/article backlinks, counts, locales, unsaved guard, empty state and mobile');
}
