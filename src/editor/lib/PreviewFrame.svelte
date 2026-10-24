<script lang="ts">
  import { tick, untrack } from "svelte";
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
  let source = $state<{ src?: string; srcdoc?: string; ready: (event: Event) => void; fail: () => void } | null>(null);
  let loading = $state(true);
  let revealed = $state(false);

  $effect(() => {
    const target = new URL(url, location.href);
    void reloadToken;
    const started = performance.now();
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const controller = new AbortController();
    const { signal } = controller;
    source = null;
    loading = true;
    revealed = false;
    untrack(onloading);
    function fail(message = "The prepared page could not be loaded. Check its URL and framing headers.") {
      if (signal.aborted) return;
      controller.abort();
      clearTimeout(timeout);
      loading = false;
      onerror(message);
    }
    const timeout = setTimeout(() => fail("The preview took too long to load. Check its URL and try again."), 20000);
    function wait(ms: number) {
      return new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, ms);
        signal.addEventListener("abort", finish, { once: true });
      });
    }
    async function ready(event: Event) {
      const iframe = event.currentTarget as HTMLIFrameElement;
      const doc = iframe.contentDocument;
      if (signal.aborted) return;
      if (!doc || (target.origin === location.origin && new URL(doc.URL).pathname.replace(/\/$/, "") !== target.pathname.replace(/\/$/, ""))) {
        fail();
        return;
      }
      try {
        if (doc.fonts) await Promise.race([doc.fonts.ready.catch(() => {}), wait(200)]);
        if (signal.aborted) return;
        if (!reducedMotion) await wait(Math.max(0, 500 - (performance.now() - started)));
        if (signal.aborted || iframe !== frame) return;
        onload();
        await tick();
        if (signal.aborted || iframe !== frame) return;
        clearTimeout(timeout);
        loading = false;
        revealed = true;
      } catch (cause) {
        fail(cause instanceof Error ? cause.message : "Preview unavailable");
      }
    }
    const handlers = { ready, fail: () => fail() };
    if (target.origin === location.origin) source = { src: target.href, ...handlers };
    else fetchPreview(target, signal).then(srcdoc => {
      if (!signal.aborted) source = { srcdoc, ...handlers };
    }).catch(cause => {
      fail(cause instanceof Error ? cause.message : "Preview unavailable");
    });
    return () => { controller.abort(); clearTimeout(timeout); };
  });
</script>

<div class="preview-frame" aria-busy={loading}>
  {#if source}
    {#key source}
      <iframe bind:this={frame} {title} sandbox="allow-same-origin" referrerpolicy="no-referrer" src={source.src} srcdoc={source.srcdoc} onload={source.ready} onerror={source.fail} class:revealed inert={!revealed} aria-hidden={!revealed}></iframe>
    {/key}
  {/if}
  {#if loading}
    <div class="preview-loading" role="status"><span class="preview-spinner" aria-hidden="true"></span>Loading preview…</div>
  {/if}
</div>
