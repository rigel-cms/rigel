<script lang="ts">
  import Icon from "./Icon.svelte";
  let { title, description, confirmLabel, fieldLabel, danger = false, onconfirm, onclose }: {
    title: string; description: string; confirmLabel: string; fieldLabel?: string; danger?: boolean;
    onconfirm: (value: string) => void | Promise<void>; onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let cancel: HTMLButtonElement;
  let input: HTMLInputElement;
  let value = $state("");
  let busy = $state(false);
  let error = $state("");
  $effect(() => {
    dialog.showModal();
    (fieldLabel ? input : cancel).focus();
    return () => dialog.close();
  });
  async function submit() {
    if (busy) return;
    busy = true;
    error = "";
    try { await onconfirm(value.trim()); onclose(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "The action could not be completed. Try again."; }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} class="rigel rigel-modal-backdrop action-dialog" aria-labelledby="action-title" aria-describedby="action-description" oncancel={(event) => { event.preventDefault(); if (!busy) onclose(); }}>
  <form class="rigel-modal" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div class="action-head"><h2 id="action-title">{title}</h2><button type="button" class="icon-btn" aria-label="Cancel" disabled={busy} onclick={onclose}><Icon name="x" size={16} /></button></div>
    <p id="action-description">{description}</p>
    {#if fieldLabel}<label><span>{fieldLabel}</span><input type="text" bind:this={input} bind:value required disabled={busy} /></label>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="action-actions">
      <button type="button" bind:this={cancel} disabled={busy} onclick={onclose}>Cancel</button>
      <button type="submit" class:primary={!danger} class:danger-btn={danger} disabled={busy}>{busy ? 'Working…' : confirmLabel}</button>
    </div>
  </form>
</dialog>

<style>
  .action-dialog { box-sizing: border-box; width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 1rem; border: none; color: var(--text); }
  .action-dialog .rigel-modal { box-sizing: border-box; }
  .action-dialog:not([open]) { display: none; }
  .action-dialog::backdrop { background: transparent; }
  .action-head, .action-actions { display: flex; align-items: center; gap: 0.75rem; }
  .action-head { justify-content: space-between; }
  .action-actions { justify-content: flex-end; flex-wrap: wrap; margin-top: 1.5rem; }
  .action-actions button[type=button] { padding: 0.4375rem 0.75rem; border: 1px solid var(--border-control); border-radius: 0; background: var(--panel); color: var(--text); font: inherit; font-size: 0.8125rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: wait; }
</style>
