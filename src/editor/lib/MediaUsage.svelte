<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import type { Manifest } from "../../manifest/types";
  import { mediaUsage, type MediaUsageEntry } from "../../manifest/media-usage";
  import { readLocalArticle } from "./local-articles";
  import { selectionHash } from "./hash-navigation";

  const id = $props.id();
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let open = $state(false);
  let placement = $state("");

  function position() {
    if (!menu?.matches(":popover-open")) return;
    const rect = trigger.getBoundingClientRect(), bounds = trigger.closest(".image-picker")!.getBoundingClientRect();
    const width = Math.min(336, bounds.width - 40), maxHeight = Math.min(240, bounds.height - 40);
    const height = Math.min(menu.scrollHeight + 2, maxHeight);
    const top = rect.bottom + height + 4 <= bounds.bottom - 20 ? rect.bottom + 4 : rect.top - height - 4;
    placement = `width:${width}px;max-height:${maxHeight}px;left:${Math.max(bounds.left + 20, Math.min(rect.left, bounds.right - width - 20))}px;top:${Math.max(bounds.top + 20, top)}px`;
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

  let { manifest, url, onselect }: { manifest: Manifest; url: string; onselect: (entry: MediaUsageEntry) => void } = $props();
  let result = $state<ReturnType<typeof mediaUsage> | null>(null);
  let error = $state(false);
  $effect(() => {
    const current = manifest, asset = url;
    let active = true;
    result = null; error = false;
    async function load() {
      const snapshot: Manifest = { ...current, collections: current.collections?.map(collection => ({ ...collection, posts: collection.posts.map(post => ({ ...post })) })) };
      try {
        if (!current.backend) for (const collection of snapshot.collections ?? []) for (const post of collection.posts) {
          if (!active) return;
          const article = await readLocalArticle(collection.name, post.slug);
          post.frontmatter = article.frontmatter; post.body = article.body;
        }
        if (active) result = mediaUsage(snapshot, asset);
      } catch {
        if (active) { result = mediaUsage(snapshot, asset); error = true; }
      }
    }
    void load();
    return () => { active = false; };
  });
</script>

<button bind:this={trigger} type="button" class="outlined usage-trigger" aria-expanded={open} aria-controls={`${id}-usage`} popovertarget={`${id}-usage`} onkeydown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
  {$t("media.usedIn")} {#if result}<span class="usage-count">{result.entries.length}</span>{/if}<span class:expanded={open}><Icon name="caretDown" size={14} /></span>
</button>
<div bind:this={menu} id={`${id}-usage`} class="media-usage" popover="auto" role="region" aria-label={$t("media.usedIn")} style={placement} ontoggle={event => { open = event.currentTarget.matches(":popover-open"); }} onkeydown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
  {#if !result}<p class="hint" role="status">{$t("media.usageLoading")}</p>
  {:else}
    {#if error}<p class="error" role="alert">{$t("media.usageError")}</p>
    {:else if !result.complete}<p class="hint" role="status">{$t("media.usageIncomplete")}</p>{/if}
    {#if result.entries.length}
      <ul>{#each result.entries as entry}<li><a href={selectionHash(entry.target, entry.locale)} onclick={event => { event.preventDefault(); onselect(entry); }}>{entry.label}</a>{#if entry.group || entry.locale}<span class="hint"> · {[entry.group, entry.locale].filter(Boolean).join(" · ")}</span>{/if}</li>{/each}</ul>
    {:else if result.complete && !error}<p class="hint" role="status">{$t("media.usageEmpty")}</p>{/if}
  {/if}
</div>

<style>
  .usage-trigger { display: inline-flex; align-items: center; gap: .375rem; margin-left: auto; }
  .usage-trigger:focus-visible { outline: 3px solid var(--focus-ring); outline-offset: 2px; }
  .usage-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .expanded { transform: rotate(180deg); }
  .media-usage { position: fixed; inset: auto; margin: 0; padding: .75rem; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--border-control); background: var(--panel); color: var(--text); font: inherit; box-shadow: var(--shadow-lg); }
  .media-usage::backdrop { background: transparent; }
  .media-usage p { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { overflow-wrap: anywhere; }
  li + li { margin-top: .625rem; }
  @media (pointer: coarse) { .usage-trigger { min-height: var(--button-size); } }
</style>
