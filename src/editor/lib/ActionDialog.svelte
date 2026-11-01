<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";
  import { untrack } from "svelte";
  import type { DocumentDef } from "../../schema/types";
  let { title, description, confirmLabel, fieldLabel, danger = false, templates, templateCategory, onconfirm, onclose }: {
    title: string; description: string; confirmLabel: string; fieldLabel?: string; danger?: boolean;
    templates?: DocumentDef[]; templateCategory?: string;
    onconfirm: (value: string, type?: string) => void | Promise<void>; onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let cancel: HTMLButtonElement;
  let input: HTMLInputElement;
  let value = $state("");
  let busy = $state(false);
  let error = $state("");
  let category = $state(untrack(() => templateCategory ?? ""));
  let selectedTemplate = $state("");
  const categories = $derived([...new Set((templates ?? []).map(type => type.category ?? ""))].sort());
  const candidates = $derived((templates ?? []).filter(type => (type.category ?? "") === category));
  const template = $derived(candidates.length === 1 ? candidates[0].name : selectedTemplate);
  $effect(() => {
    dialog.showModal();
    (fieldLabel ? input : cancel).focus();
    return () => dialog.close();
  });
  async function submit() {
    if (busy) return;
    busy = true;
    error = "";
    try {
      if (templates && !candidates.some(type => type.name === template)) throw new Error($t("shell.chooseTemplate"));
      await onconfirm(value.trim(), template); onclose();
    }
    catch (cause) { error = cause instanceof Error ? cause.message : $t("connection.actionFailed"); }
    finally { busy = false; }
  }
</script>

<dialog bind:this={dialog} class="rigel rigel-modal-backdrop action-dialog" aria-labelledby="action-title" aria-describedby="action-description" oncancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onclose(); }} onkeydown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) onclose(); } }}>
  <form class="rigel-modal" onsubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div class="action-head"><h2 id="action-title">{title}</h2><button type="button" class="icon-btn" aria-label={$t("connection.cancel")} disabled={busy} onclick={onclose}><Icon name="x" size={16} /></button></div>
    <p id="action-description">{description}</p>
    {#if fieldLabel}<label><span>{fieldLabel}</span><input type="text" bind:this={input} bind:value required disabled={busy} /></label>{/if}
    {#if templates}
      {#if categories.some(category => category !== "")}
        <Select label={$t("shell.category")} value={category} options={categories.map(value => ({ value, label: value || $t("shell.coreCategory") }))} disabled={busy} onchange={(value) => { if (typeof value === "string") { category = value; selectedTemplate = ""; error = ""; } }} />
      {/if}
      {#if candidates.length > 1}
        <Select label={$t("shell.template")} value={selectedTemplate} options={[{ value: "", label: $t("shell.chooseTemplate"), disabled: true }, ...candidates.map(type => ({ value: type.name, label: type.title }))]} disabled={busy} onchange={(value) => { if (typeof value === "string") selectedTemplate = value; }} />
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="action-actions">
      <button type="button" bind:this={cancel} disabled={busy} onclick={onclose}>{$t("connection.cancel")}</button>
      <button type="submit" class:primary={!danger} class:danger-btn={danger} disabled={busy}>{busy ? $t("connection.working") : confirmLabel}</button>
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
  .action-head h2 { min-width: 0; overflow-wrap: anywhere; }
  .action-actions { justify-content: flex-end; flex-wrap: wrap; margin-top: 1.5rem; }
  .action-actions button[type=button] { padding: 0.4375rem 0.75rem; border: 1px solid var(--border-control); border-radius: 0; background: var(--panel); color: var(--text); font: inherit; font-size: 0.8125rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: wait; }
</style>
