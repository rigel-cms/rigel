<script lang="ts">
  let { tab = $bindable("content") }: { tab?: "content" | "seo" } = $props();
  function onkey(event: KeyboardEvent) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    tab = event.key === "Home" ? "content" : event.key === "End" ? "seo" : tab === "content" ? "seo" : "content";
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)?.focus();
  }
</script>

<div class="panel-tabs" role="tablist" aria-label="Properties">
  {#each ["content", "seo"] as value}
    <button type="button" role="tab" id={`properties-tab-${value}`} aria-controls={`properties-${value}`} aria-selected={tab === value} tabindex={tab === value ? 0 : -1} data-tab={value} onclick={() => (tab = value as "content" | "seo")} onkeydown={onkey}>{value === "content" ? "Content" : "SEO"}</button>
  {/each}
</div>
