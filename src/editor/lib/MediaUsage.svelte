<script lang="ts">
  import UsagePopover from "./UsagePopover.svelte";
  import type { Manifest } from "../../manifest/types";
  import { mediaUsage, type MediaUsageEntry } from "../../manifest/media-usage";
  import { mediaUsageSnapshot } from "./media-usage-data";
  let { manifest, url, onselect }: { manifest: Manifest; url: string; onselect: (entry: MediaUsageEntry) => void } = $props();
  let result = $state<ReturnType<typeof mediaUsage> | null>(null);
  let error = $state(false);
  let loading = $state(false);
  let controller = new AbortController();
  $effect(() => {
    manifest; url;
    controller = new AbortController();
    result = null; error = false; loading = false;
    return () => { controller.abort(); };
  });
  async function load() {
    if (loading || result?.complete) return;
    const request = controller;
    loading = true;
    const next = await mediaUsageSnapshot(manifest, url, request.signal);
    if (request.signal.aborted) return;
    result = next; error = next.error; loading = false;
  }
</script>

<UsagePopover entries={result?.entries ?? null} complete={result?.complete ?? false} {loading} {error} onopen={load} {onselect} />
