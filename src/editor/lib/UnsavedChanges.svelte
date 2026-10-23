<script lang="ts">
  import Icon from "./Icon.svelte";
  let { busy, error, onsave, ondiscard, oncancel }: { busy: boolean; error: string; onsave: () => void; ondiscard: () => void; oncancel: () => void } = $props();
  let dialog: HTMLDialogElement;
  let cancel: HTMLButtonElement;
  $effect(() => {
    dialog.showModal();
    cancel.focus();
    return () => dialog.close();
  });
</script>

<dialog bind:this={dialog} class="rigel rigel-modal-backdrop unsaved-dialog" aria-labelledby="unsaved-title" aria-describedby="unsaved-description" oncancel={(event) => { event.preventDefault(); if (!busy) oncancel(); }}>
  <div class="rigel-modal">
    <div class="unsaved-head">
      <h2 id="unsaved-title">Unsaved changes</h2>
      <button type="button" class="icon-btn" aria-label="Keep editing" disabled={busy} onclick={oncancel}><Icon name="x" size={16} /></button>
    </div>
    <p id="unsaved-description">You have unsaved changes. Save before leaving, or discard this draft?</p>
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="unsaved-actions">
      <button type="button" bind:this={cancel} disabled={busy} onclick={oncancel}>Keep editing</button>
      <button type="button" disabled={busy} onclick={ondiscard}>Discard changes</button>
      <button type="button" class="primary" disabled={busy} onclick={onsave}>{busy ? 'Saving…' : 'Save and leave'}</button>
    </div>
  </div>
</dialog>

<style>
  .unsaved-dialog { box-sizing: border-box; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 1rem; border: none; color: var(--text); }
  .unsaved-dialog .rigel-modal { box-sizing: border-box; }
  .unsaved-dialog:not([open]) { display: none; }
  .unsaved-dialog::backdrop { background: transparent; }
  .unsaved-head, .unsaved-actions { display: flex; align-items: center; gap: 0.75rem; }
  .unsaved-head { justify-content: space-between; }
  .unsaved-actions { justify-content: flex-end; flex-wrap: wrap; margin-top: 1.5rem; }
  .unsaved-actions button:not(.primary) { padding: 0.4375rem 0.75rem; border: 1px solid var(--border-control); border-radius: 0; background: var(--panel); color: var(--text); font: inherit; font-size: 0.8125rem; cursor: pointer; }
</style>
