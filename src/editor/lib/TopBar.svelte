<script lang="ts">
  import { t } from "../i18n";
  import Icon from "./Icon.svelte";
  import SidebarIcon from "./SidebarIcon.svelte";
  import { tick } from "svelte";
  import type { Manifest } from "../../manifest/types";

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
  }: {
    manifest: Manifest;
    sel: Sel | null;
    onselect: (s: Sel) => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let active = $state(-1);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (open) inputEl?.focus();
  });

  interface Hit {
    label: string;
    hint: string;
    action: () => void;
  }

  const hits = $derived.by((): Hit[] => {
    const q = query.trim().toLowerCase();
    const all: Hit[] = [];
    for (const p of manifest.pages) {
      all.push({
        label: p.label,
        hint: $t("shell.page"),
        action: () => onselect({ kind: "page", slug: p.slug }),
      });
    }
    for (const doc of manifest.documents ?? []) {
      all.push({
        label: String(doc.data.title ?? doc.data.name ?? doc.slug),
        hint: $t("shell.searchItemHint", { name: doc.type, slug: doc.slug }),
        action: () => onselect({ kind: "document", type: doc.type, id: doc.id }),
      });
    }
    for (const c of manifest.collections ?? []) {
      all.push({
        label: c.label,
        hint: $t("shell.collection"),
        action: () => onselect({ kind: "collection", name: c.name }),
      });
      for (const po of c.posts) {
        all.push({
          label: String(po.frontmatter.title ?? po.slug),
          hint: $t("shell.searchItemHint", { name: c.label, slug: po.slug }),
          action: () => onselect({ kind: "post", collection: c.name, slug: po.slug }),
        });
      }
    }
    if (manifest.menus) {
      all.push({ label: $t("shell.menus"), hint: $t("shell.collection"), action: () => onselect({ kind: "menus" }) });
      for (const m of manifest.menus.entries) all.push({ label: m.title, hint: $t("shell.searchMenuHint", { slug: m.slug }), action: () => onselect({ kind: "menu", slug: m.slug }) });
    }
    if (!q) return all.slice(0, 12);
    return all.filter((h) => h.label.toLowerCase().includes(q) || h.hint.toLowerCase().includes(q)).slice(0, 12);
  });

  function trigger(h: Hit) {
    h.action();
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
      <ul id="rigel-search-results" role="listbox" aria-label={$t("shell.searchResults")}>
        {#each hits as h, i (h.hint + h.label)}
          <li role="presentation">
            <button id={`rigel-search-hit-${i}`} role="option" aria-selected={active === i} onfocus={() => active = i} onclick={() => trigger(h)}>
              <span>{h.label}</span>
              <span class="hint">{h.hint}</span>
            </button>
          </li>
        {:else}
          <li class="empty" role="presentation">{$t("shell.noResults")}</li>
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
