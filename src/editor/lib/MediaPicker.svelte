<script lang="ts">
  import Icon from "./Icon.svelte";
  import { safePreviewUrl } from "../../preview-urls";
  import { mediaMetadata, mediaLimit } from "../../media-types";
  import { filterMedia, mediaSize, type MediaAsset } from "./media-library";
  import { uploadMedia } from "./images";
  import { parseEmbedUrl, embedProviderLabel, type EmbedProvider, type EmbedRef } from "./embeds";

  let { triggerLabel = "Insert media", onimage, onvideo, onembed }: {
    triggerLabel?: string;
    onimage?: () => void;
    onvideo?: (video: { src: string; caption?: string }) => void;
    onembed?: (embed: EmbedRef & { privacy: boolean; title?: string }) => void;
  } = $props();
  const id = $props.id();

  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let dialog: HTMLDialogElement;
  let fileInput: HTMLInputElement | undefined;
  let panel = $state<"" | "video" | "embed">("");
  let provider = $state<EmbedProvider>("youtube");
  let url = $state("");
  let title = $state("");
  let caption = $state("");
  let privacy = $state(true);
  let error = $state("");
  let busy = $state(false);
  let assets = $state<MediaAsset[]>([]);
  let writable = $state(false);
  let file: File | undefined;
  const videos = $derived(filterMedia(assets, "", "Video", ""));
  const open = $derived(panel !== "");

  $effect(() => {
    if (open && dialog && !dialog.open) dialog.showModal();
  });

  function toggleMenu() {
    if (!menu) return;
    if (menu.matches(":popover-open")) menu.hidePopover();
    else menu.showPopover();
  }
  function pick(choice: "image" | "video" | "youtube" | "vimeo") {
    if (menu?.matches(":popover-open")) menu.hidePopover();
    reset();
    if (choice === "image") { onimage?.(); return; }
    panel = choice === "video" ? "video" : "embed";
    provider = choice === "vimeo" ? "vimeo" : "youtube";
    if (panel === "video") void library();
  }
  function reset() {
    url = ""; title = ""; caption = ""; privacy = true; error = ""; busy = false; file = undefined;
    if (fileInput) fileInput.value = "";
  }
  async function library() {
    try {
      const response = await fetch("/rigel/media.json", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      assets = (data.assets ?? data.images ?? []) as MediaAsset[];
      writable = data.writable === true;
    } catch { /* the listing is optional; upload and URL entry still work */ }
  }
  function chooseAsset(asset: MediaAsset) {
    if (mediaMetadata(asset.name)?.category !== "Video") return;
    url = asset.url; file = undefined; error = "";
  }
  function chooseFile(event: Event) {
    const choice = (event.currentTarget as HTMLInputElement).files?.[0];
    error = "";
    if (!choice) return;
    const metadata = mediaMetadata(choice.name);
    if (!metadata || metadata.category !== "Video") { error = "Choose an MP4, WebM or MOV video."; return; }
    if (choice.size > mediaLimit("Video")) { error = `Video exceeds ${Math.round(mediaLimit("Video") / 1024 / 1024)} MB.`; return; }
    file = choice;
    url = "";
  }
  function close() {
    dialog?.close();
    panel = "";
    reset();
    trigger?.focus();
  }
  function safeMediaUrl(value: string) {
    return safePreviewUrl(value, true) && (value.startsWith("/") || /^https:\/\//i.test(value));
  }
  async function confirm() {
    if (busy) return;
    if (panel === "embed") {
      const ref = parseEmbedUrl(url);
      if (!ref) { error = `Paste a ${provider === "youtube" ? "YouTube" : "Vimeo"} video URL.`; return; }
      if (ref.provider !== provider) { error = `That is a ${embedProviderLabel(ref)} URL.`; return; }
      onembed?.({ ...ref, privacy, title: title.trim() || undefined });
      close();
      return;
    }
    busy = true; error = "";
    try {
      const src = file ? await uploadMedia(file) : url.trim();
      if (!src || !safeMediaUrl(src)) throw new Error("Choose a video file or paste a video URL.");
      if (mediaMetadata(src.split("/").pop() ?? "")?.category !== "Video") throw new Error("Choose a video file or video URL.");
      onvideo?.({ src, caption: caption.trim() || undefined });
      close();
    } catch (cause) { error = cause instanceof Error ? cause.message : "Video could not be added"; }
    finally { busy = false; }
  }
</script>

<button bind:this={trigger} data-media-trigger type="button" aria-label={triggerLabel} data-tooltip={triggerLabel} aria-haspopup="menu" aria-expanded={open} popovertarget={`${id}-media`} onmousedown={event => event.preventDefault()} onclick={event => { event.preventDefault(); toggleMenu(); }}><Icon name="image" size={18} /></button>
<div bind:this={menu} id={`${id}-media`} class="block-menu media-menu" popover role="menu" aria-label="Insert media">
  <button type="button" role="menuitem" onclick={() => pick("image")}><Icon name="image" size={16} />Image</button>
  <button type="button" role="menuitem" onclick={() => pick("video")}><Icon name="filmStrip" size={16} />Video</button>
  <button type="button" role="menuitem" onclick={() => pick("youtube")}><Icon name="youtubeLogo" size={16} />YouTube</button>
  <button type="button" role="menuitem" onclick={() => pick("vimeo")}><Icon name="playCircle" size={16} />Vimeo</button>
</div>

{#if open}
  <dialog bind:this={dialog} class="rigel-modal-backdrop rigel media-insert" aria-label={panel === "video" ? "Add video" : "Add video link"} oncancel={event => { event.preventDefault(); close(); }} onclick={event => { if (event.target === dialog) close(); }}>
    <div class="rigel-modal">
      <div class="media-head"><h2>{panel === "video" ? "Add video" : `Add ${provider === "youtube" ? "YouTube" : "Vimeo"} video`}</h2><button type="button" class="close" aria-label="Close" onclick={close}><Icon name="x" size={14} weight="bold" /></button></div>
      {#if panel === "video"}
        <p class="hint">Upload a file to the repository media folder, or paste a video URL. Files are stored and served like images.</p>
        <label class="media-file">Video file<input type="file" accept=".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime" bind:this={fileInput} onchange={chooseFile} /></label>
        <label>Or video URL<input type="text" bind:value={url} placeholder="/rigel-media/… or https://…" oninput={() => { file = undefined; }} /></label>
        <label>Caption (optional)<input type="text" maxlength="200" bind:value={caption} /></label>
        {#if videos.length}
          <p class="hint">Repository videos</p>
          <div class="media-insert-list" role="group" aria-label="Repository videos">
            {#each videos.slice(0, 8) as asset}
              <button type="button" class="outlined" aria-pressed={url === asset.url} onclick={() => chooseAsset(asset)}>{asset.name}<span>{mediaSize(asset.size)}</span></button>
            {/each}
          </div>
        {/if}
        {#if !writable}<p class="hint">Uploads require the local dev server. GitHub uploads are not connected.</p>{/if}
      {:else}
        <p class="hint">Paste a {provider === "youtube" ? "YouTube" : "Vimeo"} link. The player is embedded without tracking cookies by default.</p>
        <label>Video URL<input type="text" bind:value={url} placeholder={provider === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"} /></label>
        <label>Title for accessibility (optional)<input type="text" maxlength="200" bind:value={title} /></label>
        <label class="inline"><span>Privacy-enhanced (no cookies until play)</span><input type="checkbox" role="switch" class="switch" bind:checked={privacy} /></label>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="media-button-actions">
        <button type="button" class="outlined" disabled={busy} onclick={close}>Cancel</button>
        <button type="button" class="primary" disabled={busy} onclick={confirm}>{busy ? "Adding…" : "Insert"}</button>
      </div>
    </div>
  </dialog>
{/if}
