<script lang="ts">
  import { t } from "../i18n";
  let { tab = $bindable("content"), seo = true }: { tab?: "page" | "content" | "seo"; seo?: boolean } = $props();
  const values = $derived<("page" | "content" | "seo")[]>(seo ? ["page", "content", "seo"] : ["page", "content"]);
  let tabs: HTMLDivElement;
  let height = $state(0);
  $effect(() => {
    const panel = tabs?.parentElement;
    panel?.style.setProperty("--properties-tabs-height", `${height}px`);
    return () => panel?.style.removeProperty("--properties-tabs-height");
  });
  function onkey(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = values.indexOf(tab);
    tab = event.key === "Home" ? values[0] : event.key === "End" ? values[values.length - 1] : values[(index + (event.key === "ArrowRight" ? 1 : values.length - 1)) % values.length];
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus();
  }
</script>

<div class="panel-tabs" role="tablist" aria-label={$t("fields.properties")} bind:this={tabs} bind:offsetHeight={height}>
  {#each values as value}
    <button type="button" role="tab" id={`properties-tab-${value}`} aria-controls={`properties-${value}`} aria-selected={tab === value} tabindex={tab === value ? 0 : -1} data-tab={value} onclick={() => (tab = value)} onkeydown={onkey}>{$t(value === "page" ? "shell.page" : value === "content" ? "fields.content" : "fields.seo")}</button>
  {/each}
</div>
