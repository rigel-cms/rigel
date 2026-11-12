<script lang="ts">
  import UsagePopover from "./UsagePopover.svelte";
  import type { Manifest } from "../../manifest/types";
  import { mediaUsage, type MediaUsageEntry } from "../../manifest/media-usage";
  import { mediaUsageSnapshot } from "./media-usage-data";
  let { manifest, url, onselect }: { manifest: Manifest; url: string; onselect: (entry: MediaUsageEntry) => void } = $props();
  let result = $state<ReturnType<typeof mediaUsage> | null>(null);
  let error = $state(false);
  $effect(() => {
    const current = manifest, asset = url;
    let active = true;
    result = null; error = false;
    void mediaUsageSnapshot(current, asset).then(next => { if (active) { result = next; error = next.error; } });
    return () => { active = false; };
  });
</script>

<UsagePopover entries={result?.entries ?? null} complete={result?.complete ?? false} {error} {onselect} />
