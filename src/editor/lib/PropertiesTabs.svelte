<script lang="ts">
  import { t } from "../i18n";
  let { tab = $bindable("content") }: { tab?: "content" | "seo" } = $props();
  function onkey(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    tab = event.key === "Home" ? "content" : event.key === "End" ? "seo" : tab === "content" ? "seo" : "content";
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus();
  }
</script>

<div class="panel-tabs" role="tablist" aria-label={$t("fields.properties")}>
  {#each ["content", "seo"] as value}
    <button type="button" role="tab" id={`properties-tab-${value}`} aria-controls={`properties-${value}`} aria-selected={tab === value} tabindex={tab === value ? 0 : -1} data-tab={value} onclick={() => (tab = value as "content" | "seo")} onkeydown={onkey}>{$t(value === "content" ? "fields.content" : "fields.seo")}</button>
  {/each}
</div>
