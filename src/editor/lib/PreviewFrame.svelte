<script lang="ts">
  import { untrack } from "svelte";
  import { fetchPreview } from "./preview-frame";

  let { url, title, frame = $bindable(), reloadToken = 0, onload, onloading, onerror }: {
    url: string;
    title: string;
    frame?: HTMLIFrameElement;
    reloadToken?: number;
    onload: () => void;
    onloading: () => void;
    onerror: (message: string) => void;
  } = $props();
  let source = $state<{ src?: string; srcdoc?: string } | null>(null);

  $effect(() => {
    const target = new URL(url, location.href);
    void reloadToken;
    source = null;
    untrack(onloading);
    const controller = new AbortController();
    if (target.origin === location.origin) source = { src: target.href };
    else fetchPreview(target, controller.signal).then(srcdoc => {
      if (!controller.signal.aborted) source = { srcdoc };
    }).catch(cause => {
      if (!controller.signal.aborted) onerror(cause instanceof Error ? cause.message : "Preview unavailable");
    });
    return () => controller.abort();
  });

  function ready() {
    const doc = frame?.contentDocument;
    if (!doc || (source?.src && new URL(doc.URL).pathname.replace(/\/$/, "") !== new URL(source.src).pathname.replace(/\/$/, ""))) {
      onerror("The prepared page could not be loaded. Check its URL and framing headers.");
      return;
    }
    onload();
  }
</script>

{#if source}
  {#key source}
  <iframe bind:this={frame} {title} sandbox="allow-same-origin" referrerpolicy="no-referrer" src={source.src} srcdoc={source.srcdoc} onload={ready}></iframe>
  {/key}
{/if}
