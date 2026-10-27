<script lang="ts">
  import type { Component as SvelteComponent } from "svelte";
  import type { BlockData } from "../../extensions";
  import { t } from "../i18n";
  let { component: Component, data, onchange = undefined, report }: { component: SvelteComponent<any>; data: BlockData; onchange?: (data: BlockData) => void; report: (error: unknown) => void } = $props();
  export function update(next: BlockData) { data = next; }
</script>

<svelte:boundary onerror={report}>
  <Component {data} {onchange} />
  {#snippet failed()}<p role="alert">{$t("richtext.loadArticleError")}</p>{/snippet}
</svelte:boundary>
