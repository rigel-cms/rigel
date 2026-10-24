<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { patchPreview, previewUrl, type PreviewConfig, type PreviewTarget } from "../../preview";
  import PreviewFrame from "./PreviewFrame.svelte";
  let { target, config, values, body, isNew = false, devMode = false }: { target: PreviewTarget; config: PreviewConfig; values: Record<string, unknown>; body: "" | import("../../article-body").ArticleBody; isNew?: boolean; devMode?: boolean } = $props();

  const websitePath = $derived(previewUrl(config, target, "website"));
  const key = $derived(`${target.kind}:${target.collection ?? ""}:${target.slug}`);
  let frame: HTMLIFrameElement | undefined = $state();
  let loaded = $state(false);
  let error = $state("");
  let path = $state<string | null>(null);
  $effect(() => {
    void key;
    loaded = false;
    error = "";
    path = untrack(() => previewUrl(config, target, "draft", isNew));
  });
  function patch() {
    if (!loaded || !frame?.contentDocument) return;
    patchPreview(frame.contentDocument, JSON.parse(JSON.stringify(values)), body);
  }
  function onload() {
    try {
      const doc = frame?.contentDocument;
      doc?.addEventListener("contextmenu", event => { if (!devMode) event.preventDefault(); }, true);
      if (!doc) throw new Error("The prepared page could not be loaded.");
      if (!doc.querySelector('[data-rigel-text], [data-rigel-richtext], [data-rigel-image]')) throw new Error("This page has no prepared Rigel anchors.");
      doc.addEventListener("click", event => event.preventDefault(), true);
      doc.addEventListener("submit", event => event.preventDefault(), true);
      loaded = true;
      patch();
    } catch (cause) { error = cause instanceof Error ? cause.message : "Preview unavailable"; }
  }
  $effect(() => { JSON.stringify(values); void body; patch(); });
</script>

<div class="site-preview" aria-label="Website preview">
  <div class="preview-heading">
    <strong>Website preview</strong>
    {#if websitePath}<a class="icon-btn visual-live" href={websitePath} target="_blank" rel="noopener noreferrer" aria-label="Preview on website" data-tooltip="Preview on website"><Icon name="external" size={18} /></a>{/if}
  </div>
  {#if error}<p role="status" class="preview-error">{error}</p>{/if}
  {#if path}
    {#key key}<PreviewFrame bind:frame url={path} title="Live website draft preview" {onload} onloading={() => { loaded = false; error = ""; }} onerror={(message) => { loaded = false; error = message; }} />{/key}
    <small>Prepared template · Scripts, navigation and forms disabled. Unanchored fields and lists are not previewed.</small>
  {:else}
    <p role="status">{target.kind === "menu" ? "Menu preview is not supported." : "No prepared preview URL is mapped to this content."}</p>
  {/if}
</div>
