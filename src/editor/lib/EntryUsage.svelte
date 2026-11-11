<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import { selectionHash } from "./hash-navigation";
  import type { Manifest } from "../../manifest/types";
  import type { Selection } from "../../manifest/navigation";
  import { entryUsage } from "../../manifest/references";

  let { manifest, target, onload, onselect }: {
    manifest: Manifest;
    target: Selection;
    onload: () => Promise<void>;
    onselect: (entry: ReturnType<typeof entryUsage>["entries"][number]) => void;
  } = $props();
  const result = $derived(entryUsage(manifest, target));
  let loading = $state(false);
  let error = $state(false);
  let details: HTMLDetailsElement;

  async function load() {
    if (loading || result.complete) return;
    loading = true; error = false;
    try { await onload(); }
    catch { error = true; }
    finally { loading = false; }
  }
</script>

<details class="entry-usage" bind:this={details} ontoggle={event => { if (event.currentTarget.open) void load(); }}>
  <summary><span>{$t("shell.linkedFrom")}</span>{#if result.complete || result.entries.length}<span class="hint">{" "}{result.entries.length}{result.complete ? "" : "+"}</span>{/if}<span class="entry-usage-caret"><Icon name="caretDown" size={14} /></span></summary>
  <div class="entry-usage-list" role="region" aria-label={$t("shell.linkedFrom")} aria-busy={loading} tabindex="0">
    {#if target.kind === "post"}<p class="hint">{$t("shell.entryUsageArticlesHint")}</p>{/if}
    {#if loading}<p class="hint" role="status">{$t("media.usageLoading")}</p>{/if}
    {#if error}<p class="error" role="alert">{$t("media.usageError")}</p>
    {:else if !loading && !result.complete}<p class="hint" role="status">{$t("shell.entryUsageIncomplete")}</p>{/if}
    {#if result.entries.length}
      <ul>{#each result.entries as entry}<li><a href={selectionHash(entry.target, entry.locale)} onclick={event => { event.preventDefault(); details.open = false; onselect(entry); }}>{entry.label}</a>{#if entry.group || entry.locale}<span class="hint"> · {[entry.group, entry.locale].filter(Boolean).join(" · ")}</span>{/if}</li>{/each}</ul>
    {:else if result.complete && !loading && !error}<p class="hint" role="status">{$t("media.usageEmpty")}</p>{/if}
    {#if !result.complete && !loading}<button type="button" class="outlined" onclick={load}>{$t("shell.retryLoading")}</button>{/if}
  </div>
</details>

<style>
  .entry-usage { display: block; flex-shrink: 0; min-width: 0; margin-top: 1rem; border-top: 1px solid var(--border-control); }
  summary { display: flex; align-items: center; gap: .375rem; padding: .75rem 0; cursor: pointer; list-style: none; overflow-wrap: anywhere; }
  summary::-webkit-details-marker { display: none; }
  summary::marker { content: ""; }
  .entry-usage-caret { margin-left: auto; display: flex; }
  details[open] .entry-usage-caret { transform: rotate(180deg); }
  summary:focus-visible, .entry-usage-list:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: -3px; }
  .entry-usage-list { box-sizing: border-box; max-height: 240px; overflow: auto; overscroll-behavior: contain; padding: 0 .25rem .75rem; }
  p, ul { margin: 0; }
  ul { list-style: none; padding: 0; }
  li { overflow-wrap: anywhere; }
  li + li, .entry-usage-list > button, p + ul { margin-top: .625rem; }
</style>
