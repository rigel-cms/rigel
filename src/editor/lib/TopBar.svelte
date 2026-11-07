<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import SidebarIcon from "./SidebarIcon.svelte";
  import { tick, untrack } from "svelte";
  import type { Manifest } from "../../manifest/types";
  import { searchIndex, type SearchHit } from "../../manifest/search";
  import type { SearchScope } from "../../config";

  type Sel =
    | { kind: "media" }
    | { kind: "menus" }
    | { kind: "menu"; slug: string }
    | { kind: "pages"; category?: string }
    | { kind: "page"; slug: string }
    | { kind: "documents"; type: string }
    | { kind: "document"; type: string; id: string }
    | { kind: "collection"; name: string }
    | { kind: "post"; collection: string; slug: string };

  let {
    manifest,
    sel,
    onselect,
    scope = "all",
    contentLocale,
    onindex,
    oncancelindex,
  }: {
    manifest: Manifest;
    sel: Sel | null;
    onselect: (s: Sel, locale?: string) => void;
    scope?: SearchScope;
    contentLocale?: string;
    onindex?: () => void;
    oncancelindex?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let active = $state(-1);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) { inputEl?.focus(); untrack(() => onindex?.()); }
  });

  const index = $derived(searchIndex(manifest, scope, contentLocale, $t));
  const hits = $derived(index.filter(hit => [hit.label, hit.hint, hit.language ?? ""].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))).slice(0, 12));

  function trigger(h: SearchHit) {
    onselect(h.selection, h.locale);
    open = false;
    query = "";
    active = -1;
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      open = !open;
      query = "";
      active = -1;
    }
    if (e.key === "Escape") open = false;
    if (!open || e.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      active = e.key === "ArrowDown" ? (active + 1) % hits.length : (active <= 0 ? hits.length : active) - 1;
      inputEl?.focus();
      void tick().then(() => document.getElementById(`rigel-search-hit-${active}`)?.scrollIntoView({ block: "nearest" }));
    }
    if (e.key === "Enter" && e.target === inputEl) {
      e.preventDefault();
      const hit = hits[active < 0 ? 0 : active];
      if (hit) trigger(hit);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<button class="search-trigger" aria-label={$t("shell.searchContent")} data-tooltip={$t("shell.searchContentTooltip")} onclick={() => { active = -1; open = true; }}>
  <SidebarIcon name="magnifying-glass" />
  <span class="sidebar-label">{$t("shell.searchPlaceholder")}</span>
  <kbd>⌘K</kbd>
</button>

{#if open}
  <div
    class="palette-backdrop"
    role="presentation"
    onclick={() => (open = false)}
    onkeydown={(e) => e.key === "Escape" && (open = false)}
  >
    <div class="palette" role="dialog" aria-label={$t("shell.searchContent")} onclick={(e) => e.stopPropagation()}>
      <div class="palette-search">
        <Icon name="magnifier" size={20} />
        <input
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls="rigel-search-results"
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && hits[active] ? `rigel-search-hit-${active}` : undefined}
          aria-label={$t("shell.searchPagesCollectionsPosts")}
          placeholder={$t("shell.searchPagesCollectionsPostsPlaceholder")}
          bind:value={query}
          oninput={() => active = -1}
          bind:this={inputEl}
        />
        <kbd>{$t("shell.escapeKeyLowercase")}</kbd>
      </div>
      {#each manifest.collections ?? [] as collection (collection.name)}
        {#if collection.index && collection.index.state !== "complete"}
          <p role="status">{collection.label}: {$t("shell.indexingCollections", { loaded: collection.index.loaded, total: collection.index.total })}</p>
          {#if collection.index.error}<p role="alert">{collection.index.error}</p><button onclick={onindex}>{$t("shell.retryLoading")}</button>{/if}
          {#if collection.index.state === "indexing"}<button onclick={oncancelindex}>{$t("connection.cancel")}</button>{/if}
        {/if}
      {/each}
      <ul id="rigel-search-results" role="listbox" aria-label={$t("shell.searchResults")}>
        {#each hits as h, i (h.id)}
          <li role="presentation">
            <button id={`rigel-search-hit-${i}`} role="option" aria-selected={active === i} onfocus={() => active = i} onclick={() => trigger(h)}>
              <span>{h.label}{#if h.language}<span class="badge search-language" title={h.language} aria-label={h.language}>{h.locale?.slice(0, 2).toUpperCase()}</span>{/if}</span>
              <span class="hint">{h.hint}</span>
            </button>
          </li>
        {:else}
          <li class="empty" role="presentation">{$t(manifest.collections?.some(c => c.index && c.index.state !== "complete") ? "shell.indexIncomplete" : "shell.noResults")}</li>
        {/each}
      </ul>
      <div class="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> {$t("shell.searchNavigate")}</span>
        <span><kbd>↵</kbd> {$t("shell.searchOpen")}</span>
        <span><kbd>{$t("shell.escapeKeyLowercase")}</kbd> {$t("shell.searchClose")}</span>
      </div>
    </div>
  </div>
{/if}
