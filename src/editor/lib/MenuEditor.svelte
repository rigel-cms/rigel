<script lang="ts">
  import { t } from "../i18n";
  import { tick } from "svelte";
  import type { MenuItem } from "../../manifest/menu";
  import { editMenuItem, menuRows, moveMenuItem } from "./menu-tree";
  import ActionDialog from "./ActionDialog.svelte";
  import Icon from "./Icon.svelte";

  let { items, maxDepth, oninput }: { items: MenuItem[]; maxDepth: number; oninput: (items: MenuItem[]) => void } = $props();
  let dragging = $state<string | null>(null);
  let target = $state("");
  let message = $state("");
  let removing = $state<MenuItem | null>(null);
  const rows = $derived(menuRows(items));
  let selectedId = $state<string | null>(null);
  let host: HTMLElement;
  const chain = $derived.by(() => {
    const selected: ReturnType<typeof menuRows> = [];
    let row = rows.find(row => row.item.id === selectedId);
    while (row) {
      selected.unshift(row);
      row = rows.find(parent => parent.item.id === row?.parentId);
    }
    return selected;
  });
  const panes = $derived([null, ...chain]);
  let pointer: { id: string; pointerId: number; x: number; y: number; handle: HTMLButtonElement } | null = null;

  function cancelDrag() {
    const active = pointer;
    pointer = null;
    if (active?.handle.hasPointerCapture(active.pointerId)) active.handle.releasePointerCapture(active.pointerId);
    dragging = null;
    target = "";
  }
  function startDrag(e: PointerEvent, id: string) {
    if (e.button !== 0 || !e.isPrimary) return;
    const handle = e.currentTarget as HTMLButtonElement;
    pointer = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, handle };
    handle.setPointerCapture(e.pointerId);
  }
  function dropAt(x: number, y: number) {
    const list = document.elementFromPoint(x, y)?.closest<HTMLElement>('.menu-list');
    const source = pointer?.handle.closest('.menu-item');
    if (!list || source?.parentElement !== list) return null;
    const siblings = [...list.querySelectorAll<HTMLElement>(':scope > .menu-item')];
    const next = siblings.find(row => y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    const row = next ?? siblings.at(-1);
    if (!row || row === source) return null;
    return { id: row.dataset.menuId!, position: next ? 'before' as const : 'after' as const };
  }
  function dragPointer(e: PointerEvent) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    if (!dragging && Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) < 5) return;
    dragging = pointer.id;
    const drop = dropAt(e.clientX, e.clientY);
    target = drop ? drop.id + drop.position : '';
    if (e.clientY < 48) window.scrollBy(0, -16);
    else if (e.clientY > window.innerHeight - 48) window.scrollBy(0, 16);
  }
  function finishDrag(e: PointerEvent) {
    if (!pointer || e.pointerId !== pointer.pointerId) return;
    const id = dragging;
    const drop = dropAt(e.clientX, e.clientY);
    cancelDrag();
    if (id && drop) move(id, drop.id, drop.position);
  }

  function move(id: string, targetId: string | null, position: "before" | "after" | "inside") {
    try {
      oninput(moveMenuItem(items, id, targetId, position, maxDepth));
      message = $t("fields.menuItemMoved");
    } catch (error) { message = error instanceof Error ? error.message : $t("fields.menuCannotMoveItem"); }
    dragging = null;
    target = "";
  }
  async function open(id: string | null) {
    selectedId = id;
    await tick();
    const pane = host.querySelector<HTMLElement>('.menu-pane:last-child');
    pane?.scrollIntoView({ block: "nearest", inline: "nearest" });
    pane?.querySelector<HTMLElement>('input, .menu-add')?.focus({ preventScroll: true });
  }
  function add(parentId: string | null = null) {
    const parent = rows.find((row) => row.item.id === parentId);
    if (parent && parent.depth >= maxDepth) { message = $t("fields.menuMaximumLevels", { maxDepth }); return; }
    const item: MenuItem = { id: crypto.randomUUID(), label: $t("fields.menuNewItem"), url: "/", children: [] };
    oninput(parentId ? editMenuItem(items, parentId, (p) => ({ ...p, children: [...p.children, item] })) : [...items, item]);
    message = $t("fields.menuItemAdded");
    void open(item.id);
  }
  function remove(item: MenuItem) {
    removing = item;
  }
  function change(id: string, field: "label" | "url", value: string) {
    oninput(editMenuItem(items, id, (item) => ({ ...item, [field]: value })));
  }
</script>

<svelte:window onpointermove={dragPointer} onpointerup={finishDrag} onpointercancel={cancelDrag} onkeydown={(event) => { if (event.key === 'Escape' && pointer) { cancelDrag(); message = $t('fields.menuMoveCancelled'); } }} />
<section class="menu-editor" aria-label={$t("fields.menuItems")} bind:this={host}>
  <nav class="menu-path" aria-label={$t("fields.menuPath")}>
    <button type="button" data-menu-path="" onclick={() => open(null)}>{$t("fields.menuItems")}</button>
    {#each chain as row}
      <Icon name="caretRight" size={12} />
      <button type="button" data-menu-path={row.item.id} aria-current={row.item.id === selectedId ? 'step' : undefined} onclick={() => open(row.item.id)}>{row.item.label || $t("fields.menuUntitledItem")}</button>
    {/each}
  </nav>
  <p class="menu-message" role="status" aria-live="polite">{message}</p>
  <div class="menu-panes">
    {#each panes as parent, index (parent?.item.id ?? '')}
      <section class="menu-pane" class:active={index === panes.length - 1} data-menu-parent={parent?.item.id ?? ''} aria-label={parent ? $t("fields.menuItemDetails", { label: parent.item.label || $t("fields.menuUntitledItem") }) : $t("fields.menuItems")}>
        <div class="menu-pane-head">
          <h3>{parent?.item.label || $t(parent ? "fields.menuUntitledItem" : "fields.menuItems")}</h3>
          {#if parent}
            <details class="menu-actions">
              <summary aria-label={$t("fields.menuItemActions", { label: parent.item.label })}><Icon name="dotsThreeOutlineVertical" /></summary>
              <div>
                <button type="button" disabled={!parent.previous} onclick={() => parent.previous && move(parent.item.id, parent.previous, 'before')}>{$t("fields.menuUp")}</button>
                <button type="button" disabled={!parent.next} onclick={() => parent.next && move(parent.item.id, parent.next, 'after')}>{$t("fields.menuDown")}</button>
                <button type="button" disabled={!parent.previous || parent.depth + Math.max(...menuRows([parent.item]).map(row => row.depth)) > maxDepth} onclick={() => parent.previous && move(parent.item.id, parent.previous, 'inside')}>{$t("fields.menuIndent")}</button>
                <button type="button" disabled={!parent.parentId} onclick={() => parent.parentId && move(parent.item.id, parent.parentId, 'after')}>{$t("fields.menuOutdent")}</button>
                <button type="button" class="menu-remove" onclick={() => remove(parent.item)}>{$t("fields.remove")}</button>
              </div>
            </details>
          {/if}
        </div>
        {#if parent}
          <div class="menu-fields">
            <label><span>{$t("fields.menuLabel")}</span><input type="text" aria-label={$t("fields.menuLabelFor", { id: parent.item.id })} value={parent.item.label} oninput={event => change(parent.item.id, 'label', event.currentTarget.value)} /></label>
            <label><span>{$t("fields.menuUrl")}</span><input type="text" aria-label={$t("fields.menuUrlFor", { id: parent.item.id })} value={parent.item.url} placeholder={$t("fields.menuUrlPlaceholder")} oninput={event => change(parent.item.id, 'url', event.currentTarget.value)} /></label>
            <label class="inline"><input type="checkbox" role="switch" class="switch" checked={parent.item.newTab ?? false} onchange={event => oninput(editMenuItem(items, parent.item.id, item => ({ ...item, newTab: event.currentTarget.checked })))} /><span>{$t("fields.menuOpenInNewTab")}</span></label>
          </div>
          <h4>{$t("fields.menuGroupItems")}</h4>
        {/if}
        <div class="menu-list">
          {#each (parent ? parent.item.children : items) as item (item.id)}
            <div class="menu-item" class:is-dragging={dragging === item.id} class:drop-before={target === item.id + 'before'} class:drop-after={target === item.id + 'after'} class:selected={chain[index]?.item.id === item.id} data-menu-id={item.id} data-parent-id={parent?.item.id ?? ''} data-depth={index + 1}>
              <button type="button" class="menu-drag" aria-label={$t("fields.menuDragItem", { label: item.label })} onpointerdown={event => startDrag(event, item.id)} onlostpointercapture={cancelDrag}><Icon name="listBullets" /></button>
              <button type="button" class="menu-open" aria-label={$t("fields.menuOpenItem", { label: item.label || $t("fields.menuUntitledItem") })} aria-expanded={chain[index]?.item.id === item.id} onclick={() => open(item.id)}>
                <span><span class="menu-label">{item.label || $t("fields.menuUntitledItem")}</span><span class="menu-url">{item.url}</span></span>
                {#if item.children.length}<span class="menu-count">{item.children.length}</span>{/if}
                <Icon name="caretRight" size={12} />
              </button>
            </div>
          {:else}
            <p class="menu-empty">{$t(parent ? "fields.menuEmptyGroup" : "fields.menuEmpty")}</p>
          {/each}
        </div>
        <button type="button" class="menu-add" disabled={!!parent && parent.depth >= maxDepth} onclick={() => add(parent?.item.id ?? null)}><Icon name="plus" />{$t(parent ? "fields.menuAddChild" : "fields.addItem")}</button>
        {#if parent && parent.depth >= maxDepth}<p class="hint">{$t("fields.menuMaximumLevelsHint", { maxDepth })}</p>{/if}
      </section>
    {/each}
  </div>
</section>
{#if removing}
  <ActionDialog title={$t("fields.menuRemoveTitle", { label: removing.label })} description={$t("fields.menuRemoveDescription")} confirmLabel={$t("fields.remove")} danger onconfirm={() => {
    if (removing) {
      const parentId = rows.find(row => row.item.id === removing?.id)?.parentId ?? null;
      oninput(editMenuItem(items, removing.id, () => null));
      void open(parentId);
    }
    message = $t("fields.menuItemRemoved");
  }} onclose={() => { removing = null; }} />
{/if}

<style>
  .menu-editor { padding: 0; border: 0; background: transparent; box-shadow: none; min-width: 0; }
  .menu-path { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem; margin-bottom: 1rem; }
  .menu-message, .menu-empty, .menu-url, .menu-count { color: var(--text-2); font-size: 0.8125rem; }
  .menu-message:empty { display: none; }
  .menu-panes { display: flex; overflow-x: auto; align-items: stretch; border: 1px solid var(--border-control); }
  .menu-pane { flex: 1 0 280px; min-width: 0; margin: 0; padding: 1rem; border: 0; border-right: 1px solid var(--border-subtle); box-shadow: none; }
  .menu-pane:last-child { border-right: 0; }
  .menu-pane-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 1rem; }
  .menu-pane-head h3 { margin: 0; overflow-wrap: anywhere; }
  .menu-fields { display: grid; gap: 1rem; margin-bottom: 1.5rem; }
  .menu-fields label { min-width: 0; margin: 0; }
  .menu-pane h4 { margin: 0 0 0.75rem; font-size: 0.8125rem; color: var(--text-2); }
  .menu-list { display: grid; gap: 0.5rem; }
  .menu-item { display: flex; position: relative; min-width: 0; border: 1px solid var(--border-control); }
  .menu-item.selected { border-color: var(--accent); background: var(--accent-soft); }
  .menu-item.is-dragging { border-style: dashed; }
  .menu-editor button, .menu-actions summary { padding: 0.5rem; min-height: 36px; border: 0; border-radius: 0; background: transparent; color: var(--text); font: inherit; font-size: 0.8125rem; cursor: pointer; }
  .menu-editor button:hover:not(:disabled), .menu-actions summary:hover { background: var(--surface-raised); }
  .menu-editor button:disabled { opacity: 0.45; cursor: not-allowed; }
  .menu-editor .menu-open { flex: 1; display: flex; align-items: center; gap: 0.5rem; text-align: left; min-width: 0; min-height: 56px; padding-inline: 0.25rem 0.75rem; }
  .menu-open > span:first-child { flex: 1; min-width: 0; }
  .menu-label, .menu-url { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-label { margin-bottom: 0.25rem; }
  .menu-drag { cursor: grab !important; touch-action: none; user-select: none; flex-shrink: 0; }
  .menu-drag:active { cursor: grabbing !important; }
  .menu-editor .menu-add { display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%; margin-top: 0.75rem; border: 1px solid var(--border-control); }
  .menu-actions { position: relative; flex-shrink: 0; }
  .menu-actions summary { display: flex; align-items: center; list-style: none; }
  .menu-actions summary::-webkit-details-marker { display: none; }
  .menu-actions > div { position: absolute; right: 0; top: 100%; z-index: 3; display: grid; min-width: 140px; padding: 0.25rem; border: 1px solid var(--border-control); background: var(--panel); box-shadow: var(--shadow-sm); }
  .menu-actions button { text-align: left; }
  .menu-actions .menu-remove { color: var(--danger); }
  .menu-item.drop-before::before, .menu-item.drop-after::after { content: ""; position: absolute; left: -1px; right: -1px; height: 3px; background: var(--accent); pointer-events: none; }
  .menu-item.drop-before::before { top: -6px; }
  .menu-item.drop-after::after { bottom: -6px; }
  @media (max-width: 700px) {
    .menu-panes { display: block; overflow: visible; }
    .menu-pane { display: none; border: 0; }
    .menu-pane.active { display: block; }
    .menu-path { gap: 0; }
    .menu-editor button, .menu-actions summary { min-height: 44px; }
  }
</style>
