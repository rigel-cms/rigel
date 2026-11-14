<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import type { MediaUsageEntry } from "../../manifest/media-usage";
  import { selectionHash } from "./hash-navigation";

  let { entries, complete, loading = false, error = false, labelKey = "media.usedIn", incompleteKey = "media.usageIncomplete", onopen, onselect }: {
    entries: MediaUsageEntry[] | null;
    complete: boolean;
    loading?: boolean;
    error?: boolean;
    labelKey?: string;
    incompleteKey?: string;
    onopen?: () => void;
    onselect: (entry: MediaUsageEntry) => void;
  } = $props();
  const id = $props.id();
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let open = $state(false);
  let placement = $state("");

  function position() {
    if (!menu?.matches(":popover-open")) return;
    const view = trigger.ownerDocument.defaultView!;
    const rect = trigger.getBoundingClientRect(), bounds = trigger.closest(".image-picker")?.getBoundingClientRect() ?? new DOMRect(0, 0, view.innerWidth, view.innerHeight);
    const width = Math.min(336, bounds.width - 40), maxHeight = Math.min(240, bounds.height - 40);
    const height = Math.min(menu.scrollHeight + 2, maxHeight);
    const top = rect.bottom + height + 4 <= bounds.bottom - 20 ? rect.bottom + 4 : rect.top - height - 4;
    placement = `width:${width}px;max-height:${maxHeight}px;left:${Math.max(bounds.left + 20, Math.min(rect.right - width, bounds.right - width - 20))}px;top:${Math.max(bounds.top + 20, top)}px`;
  }

  function close() {
    menu.hidePopover();
    trigger.focus({ preventScroll: true });
  }

  $effect(() => {
    if (!open) return;
    position();
    const view = trigger.ownerDocument.defaultView!;
    const observer = new ResizeObserver(position);
    observer.observe(menu); observer.observe(trigger);
    view.addEventListener("resize", position); view.addEventListener("scroll", position, true);
    return () => { observer.disconnect(); view.removeEventListener("resize", position); view.removeEventListener("scroll", position, true); };
  });
</script>

<button bind:this={trigger} type="button" class="outlined usage-trigger" aria-expanded={open} aria-controls={`${id}-usage`} popovertarget={`${id}-usage`} onkeydown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
  {$t(labelKey)} {#if entries && (complete || entries.length)}<span class="usage-count">{entries.length}{complete ? "" : "+"}</span>{/if}<span class:expanded={open}><Icon name="caretDown" size={14} /></span>
</button>
<div bind:this={menu} id={`${id}-usage`} class="media-usage" popover="auto" role="region" aria-label={$t(labelKey)} aria-busy={loading} style={placement} ontoggle={event => { open = event.currentTarget.matches(":popover-open"); if (open) onopen?.(); }} onkeydown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
  {#if loading || !entries}<p class="hint" role="status">{$t("media.usageLoading")}</p>{/if}
  {#if error}<p class="error" role="alert">{$t("media.usageError")}</p>
  {:else if entries && !loading && !complete}<p class="hint" role="status">{$t(incompleteKey)}</p>{/if}
  {#if entries?.length}
    <ul>{#each entries as entry}<li><a href={selectionHash(entry.target, entry.locale)} onclick={event => { event.preventDefault(); close(); onselect(entry); }}>{entry.label}</a>{#if entry.group || entry.locale}<span class="hint"> · {[entry.group, entry.locale].filter(Boolean).join(" · ")}</span>{/if}</li>{/each}</ul>
  {:else if entries && complete && !loading && !error}<p class="hint" role="status">{$t("media.usageEmpty")}</p>{/if}
  {#if onopen && entries && !complete && !loading}<button type="button" class="outlined" onclick={onopen}>{$t("shell.retryLoading")}</button>{/if}
</div>

<style>
  .usage-trigger { display: inline-flex; align-items: center; gap: .375rem; margin-left: auto; }
  .usage-trigger:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
  .usage-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .expanded { transform: rotate(180deg); }
  .media-usage { box-sizing: border-box; position: fixed; inset: auto; margin: 0; padding: .75rem; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border-control); background: var(--panel); color: var(--text); font: inherit; box-shadow: var(--shadow-lg); }
  .media-usage::backdrop { background: transparent; }
  .media-usage p { margin: 0; }
  .media-usage > button { margin-top: .5rem; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { overflow-wrap: anywhere; }
  li > .hint { margin-left: .25rem; }
  li + li { margin-top: .625rem; }
</style>
