<script lang="ts">
  import { t } from "../i18n";
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import type { Manifest } from "../../manifest/types";
  import type { Selection } from "../../manifest/navigation";
  import { listRemoteHistory, readRemoteRevision, type GitContext, type ContentRevision, type RevisionDraft } from "./github-backend";

  let { context, manifest, selection, dirty, onrestore, onclose }: {
    context: GitContext; manifest: Manifest; selection: Selection; dirty: boolean;
    onrestore: (draft: RevisionDraft) => void; onclose: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  let entries = $state<ContentRevision[]>([]);
  let selected = $state<ContentRevision | null>(null);
  let revision = $state<RevisionDraft | null>(null);
  let loading = $state(false);
  let reading = $state(false);
  let error = $state("");
  let more = $state(false);
  let limited = $state(false);
  let page = 0;
  let generation = 0;
  let active = true;
  let confirming = $state(false);

  async function load() {
    if (loading) return;
    loading = true; error = "";
    try {
      const result = await listRemoteHistory(context, manifest, selection, page + 1);
      if (!active) return;
      entries = [...entries, ...result.entries]; more = result.more; limited = result.limited; page += 1;
    } catch (cause) { if (active) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (active) loading = false; }
  }

  async function preview(entry: ContentRevision) {
    const request = ++generation;
    selected = entry; revision = null; reading = true; error = ""; confirming = false;
    try {
      const result = await readRemoteRevision(context, manifest, selection, entry.sha);
      if (active && request === generation) revision = result;
    } catch (cause) { if (active && request === generation) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (active && request === generation) reading = false; }
  }

  const previewFields = $derived.by(() => {
    if (!revision) return [];
    const definitions = selection.kind === "document" ? manifest.schema?.documents.find(type => type.name === selection.type)?.fields
      : selection.kind === "post" ? manifest.collections?.find(collection => collection.name === selection.collection)?.fields : undefined;
    const text = (value: unknown): string => {
      if (typeof value === "string") return value;
      if (value === null || value === undefined) return "";
      if (Array.isArray(value)) return value.map(text).filter(Boolean).join("\n");
      if (typeof value === "object") {
        const node = value as Record<string, unknown>;
        if (node.root) return text(node.root);
        if (node.children) return text(node.children);
        if (typeof node.text === "string") return node.text;
        return Object.entries(node).filter(([key]) => !key.startsWith("_")).map(([key, value]) => `${key}: ${text(value)}`).join("\n");
      }
      return String(value);
    };
    return Object.entries(revision.values).filter(([key]) => !key.startsWith("_")).map(([key, value]) => ({ label: definitions?.find(field => field.key === key)?.label || key, value: text(value) }))
      .concat(revision.body ? [{ label: $t("shell.content"), value: text(revision.body) }] : []);
  });

  function restore() {
    if (!revision || reading) return;
    if (dirty && !confirming) { confirming = true; return; }
    try { context.assertActive?.(); onrestore(revision); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); confirming = false; }
  }

  onMount(() => {
    dialog.showModal();
    void load();
    return () => { active = false; generation += 1; dialog.close(); };
  });
</script>

<dialog bind:this={dialog} class="rigel rigel-modal-backdrop history-dialog" aria-labelledby="history-title" oncancel={event => { event.preventDefault(); onclose(); }} onclick={event => { if (event.target === dialog) onclose(); }}>
  <section class="rigel-modal settings-modal">
    <header class="settings-head"><h2 id="history-title">{$t("shell.history")}</h2><button class="close" aria-label={$t("connection.close")} onclick={onclose}><Icon name="x" size={14} weight="bold" /></button></header>
    <div class="history-content">
    <p class="hint">{$t("shell.historyDescription")}</p>
    <div class="history-layout">
      <div class="history-list" aria-label={$t("shell.history")}>
        {#each entries as entry (entry.sha)}
          <button class="outlined" class:chosen={selected?.sha === entry.sha} aria-pressed={selected?.sha === entry.sha} onclick={() => preview(entry)}>
            <strong>{entry.message}</strong><span>{entry.author} · <time datetime={entry.date}>{new Date(entry.date).toLocaleString()}</time></span><code>{entry.sha.slice(0, 7)}</code>
          </button>
        {/each}
        {#if loading}<p role="status">{$t("shell.historyLoading")}</p>{:else if !entries.length && !error}<p>{$t("shell.historyEmpty")}</p>{/if}
        {#if more}<button class="outlined" disabled={loading} onclick={load}>{$t("shell.historyMore")}</button>{/if}
        {#if limited}<p class="hint">{$t("shell.historyLimit")}</p>{/if}
        {#if error && !selected}<button class="outlined" disabled={loading} onclick={load}>{$t("shell.retryLoading")}</button>{/if}
      </div>
      <div class="history-preview" aria-busy={reading}>
        {#if reading}<p role="status">{$t("shell.historyLoading")}</p>
        {:else if revision}<dl tabindex="0" aria-label={$t("shell.historyPreview")}>{#each previewFields as field}<dt>{field.label}</dt><dd>{field.value}</dd>{/each}</dl>
        {/if}
      </div>
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if confirming}<p role="alert">{$t("shell.historyReplaceConfirm")}</p>{/if}
    </div>
    <footer>
      <button class="outlined" onclick={() => { if (confirming) confirming = false; else onclose(); }}>{$t("connection.cancel")}</button>
      <button class="primary" disabled={!revision || reading} onclick={restore}>{$t(confirming ? "shell.historyReplace" : "shell.historyRestore")}</button>
    </footer>
  </section>
</dialog>

<style>
  .history-dialog { width: 100%; height: 100%; max-width: none; max-height: none; margin: 0; padding: 1rem; border: 0; color: var(--text); }
  .history-dialog:not([open]) { display: none; }
  .history-dialog::backdrop { background: transparent; }
  .history-dialog .rigel-modal { display: flex; flex-direction: column; width: min(72rem, 100%); max-height: calc(100dvh - 2rem); padding: 0; overflow: hidden; }
  .settings-head, footer { flex-shrink: 0; }
  .history-content { min-height: 0; padding: 1.25rem; overflow: auto; }
  .history-content > p:first-child { margin-top: 0; }
  footer { display: flex; align-items: center; justify-content: space-between; gap: .75rem; padding: 1rem 1.25rem; border-top: 1px solid var(--border); flex-wrap: wrap; }
  .history-layout { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 1rem; }
  .history-list, .history-preview { min-width: 0; max-height: 50dvh; overflow: auto; overscroll-behavior: contain; }
  .history-list > button { display: block; width: 100%; text-align: left; white-space: normal; padding: .75rem; margin-bottom: .5rem; }
  .history-list span { display: block; font-size: .75rem; color: var(--text-muted); margin: .25rem 0; }
  .chosen { border-color: var(--link); background: var(--panel); }
  dl { margin: 0; padding: .75rem; overflow-wrap: anywhere; font-size: .8125rem; border: 1px solid var(--border); }
  dt { font-weight: 600; color: var(--text-muted); margin-bottom: .25rem; }
  dd { margin: 0 0 1rem; white-space: pre-wrap; }
  dd:last-child { margin-bottom: 0; }
  .history-list > button, footer button { min-height: 44px; }
  @media (max-width: 600px) { .history-layout { grid-template-columns: minmax(0, 1fr); } .history-list { max-height: 25dvh; } .history-preview { max-height: 30dvh; } }
</style>
