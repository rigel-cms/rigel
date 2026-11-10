<script lang="ts">
  import UsagePopover from "./UsagePopover.svelte";
  import type { Manifest } from "../../manifest/types";
  import { mediaUsage, type MediaUsageEntry } from "../../manifest/media-usage";
  import { readLocalArticle } from "./local-articles";
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

<UsagePopover entries={result?.entries ?? null} complete={result?.complete ?? false} {error} {onselect} />
