<script lang="ts">
  import UsagePopover from "./UsagePopover.svelte";
  import type { Manifest } from "../../manifest/types";
  import { entryUsage } from "../../manifest/references";

  let { manifest, docId, onload, onselect }: {
    manifest: Manifest;
    docId: string;
    onload: () => Promise<void>;
    onselect: (entry: ReturnType<typeof entryUsage>["entries"][number]) => void;
  } = $props();
  const result = $derived(entryUsage(manifest, docId));
  let loading = $state(false);
  let error = $state(false);

  async function load() {
    if (loading || result.complete) return;
    loading = true; error = false;
    try { await onload(); }
    catch { error = true; }
    finally { loading = false; }
  }
</script>

<div class="entry-usage">
  <UsagePopover entries={result.entries} complete={result.complete} {loading} {error} incompleteKey="shell.entryUsageIncomplete" onopen={load} {onselect} />
</div>
