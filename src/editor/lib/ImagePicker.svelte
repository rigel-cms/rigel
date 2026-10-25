<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import Icon from "./Icon.svelte";
  import ActionDialog from "./ActionDialog.svelte";
  import Select from "./Select.svelte";
  import { getSettings, setSettings } from "./settings";
  import { DEFAULT_MAX_FILE_SIZE, MEDIA_CATEGORIES, mediaMetadata, mediaAccept, safeMediaName } from "../../media-types";
  import config from "virtual:rigel-config";
  import { parseEmbedUrl, embedWatchUrl, type EmbedProvider } from "./embeds";
  import type { EmbedData } from "../blocks/embed";
  import type { VideoData } from "../blocks/video";
  import { filterMedia, modifiedMonth, mediaSize, mediaIcon, assetFile, type MediaAsset } from "./media-library";
  import { searchImages, importStockImage, importImageUrl, uploadMedia, safeImageUrl, STOCK_PROVIDERS, type StockResult, type StockSource } from "./images";

  let { value = "", altText = "", triggerLabel = "Insert image", kind = "image", video, onvideo, embed, onembed, onpick, inline = false, toolbar = false, hiddenTrigger = false, onopen, onclose }: {
    video?: VideoData;
    onvideo?: (video: VideoData) => void;
    embed?: EmbedData;
    onembed?: (embed: EmbedData) => void;
    kind?: "image" | "video";
    value?: string; onpick?: (url: string, alt: string, credit?: StockResult) => void;
    altText?: string; triggerLabel?: string;
    inline?: boolean; toolbar?: boolean; hiddenTrigger?: boolean; onopen?: () => void; onclose?: () => void;
  } = $props();
  const id = $props.id();
  const maxFileSize = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  let open = $state(false);
  let tab = $state<"library" | "upload" | "url" | EmbedProvider | StockSource>("library");
  const providerTab = $derived(tab === "youtube" || tab === "vimeo");
  const editing = $derived(!!embed || !!value);
  const stockKeys = $derived(open ? getSettings().apiKeys : null);
  const tabs = $derived((kind === "video" ? ["library", "upload", "url", "youtube", "vimeo"] : ["library", "upload", "url", "picsum", ...Object.keys(STOCK_PROVIDERS).filter(source => stockKeys?.[source as keyof typeof STOCK_PROVIDERS]?.trim())]) as (typeof tab)[]);
  let videoTitle = $state("");
  let privacy = $state(true);
  let muted = $state(false);
  let controls = $state(true);
  let query = $state("");
  let filter = $state("");
  let format = $state("");
  let month = $state("");
  let view = $state<"grid" | "list">(getSettings().userPref.mediaView);
  function setView(next: "grid" | "list") { view = next; setSettings({ userPref: { previewSplit: getSettings().userPref.previewSplit, mediaView: next } }); }
  let librarySelection = $state("");
  let results = $state<StockResult[]>([]);
  let assets = $state<MediaAsset[]>([]);
  let writable = $state(false);
  let folder = $state("");
  let loading = $state(false);
  let picking = $state(false);
  let searched = $state(false);
  let requestId = 0;
  let error = $state("");
  let notice = $state("");
  let urlInput = $state("");
  let alt = $state("");
  let selected = $state<{url: string; stock?: StockResult; file?: File; asset?: MediaAsset} | null>(null);
  const selectedMetadata = $derived(mediaMetadata(selected?.file?.name ?? assetFile(selected?.asset?.url ?? "")));
  let metaName = $state("");
  let metaTitle = $state("");
  let metaDescription = $state("");
  let metaAlt = $state("");
  let confirmDelete = $state(false);
  let deleteTrigger = $state<HTMLButtonElement>();
  let savingMeta = $state(false);
  let metaError = $state("");
  let metaNotice = $state("");
  let trigger: HTMLButtonElement;
  let dialog: HTMLDialogElement;
  let cancel: HTMLButtonElement;
  let objectURL = "";
  const filtered = $derived(filterMedia(assets, filter, format, month));
  const months = $derived([...new Set(assets.map(a => modifiedMonth(a.modified)).filter(Boolean))].sort().reverse());
  function resetFilters() { filter = ""; format = ""; month = ""; }
  function selectAsset(asset: MediaAsset) {
    librarySelection = asset.url; selected = {url: asset.url, asset};
    metaName = asset.name; metaTitle = asset.title ?? ""; metaDescription = asset.description ?? ""; metaAlt = asset.alt ?? "";
    alt = value ? altText : asset.alt ?? "";
    metaError = ""; metaNotice = "";
    if (inline) { tab = "library"; open = true; }
  }
  async function saveMetadata() {
    if (!selected?.asset || savingMeta) return;
    const url = selected.asset.url;
    savingMeta = true; metaError = ""; metaNotice = "";
    try {
      const response = await fetch("/rigel/api/local/media", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, name: metaName.trim() || undefined, title: metaTitle.trim() || undefined, description: metaDescription.trim() || undefined, alt: selected.asset.type?.startsWith("image/") ? metaAlt : undefined }) });
      if (!response.ok) { metaError = `Metadata save failed (${response.status})`; return; }
      await library();
      selected = { url, asset: assets.find(a => a.url === url) };
      metaNotice = "Metadata saved.";
    } catch { metaError = "Metadata save failed"; }
    finally { savingMeta = false; }
  }
  async function deleteFile() {
    if (!selected?.asset || !writable || picking || savingMeta) return;
    const url = selected.asset.url;
    picking = true;
    try {
      const response = await fetch("/rigel/api/local/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      if (!response.ok) throw new Error(`Could not delete file (${response.status}). Try again.`);
      assets = assets.filter(asset => asset.url !== url);
      librarySelection = ""; notice = "File deleted.";
      close();
    } finally { picking = false; }
  }
  const needsImport = $derived(!!selected?.file || (kind !== "video" && !!selected && ((inline && tab === "url") || !selected.url.startsWith("/")) && selected.stock?.source !== "unsplash"));
  const imageImport = $derived(needsImport && kind === "image" && (!selected?.file || mediaMetadata(selected.file.name)?.category === "Images"));
  const metadataImport = $derived(needsImport && (inline || imageImport));
  function selectStock(image: StockResult) {
    selected = { url: image.url, stock: image };
    metaTitle = (image.title ?? "").slice(0, 200); metaDescription = (image.description ?? "").slice(0, 1000);
    alt = (image.alt ?? altText).slice(0, 1000);
  }

  async function library() {
    const response = await fetch("/rigel/media.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Media listing unavailable. Start the local dev server or rebuild the site.");
    const data = await response.json();
    assets = (data.assets ?? data.images).filter((asset: MediaAsset) => inline || asset.type?.startsWith(kind === "video" ? "video/" : "image/"));
    writable = data.writable === true;
    folder = data.folder;
  }
  onMount(() => { if (inline) void run(); });
  onDestroy(() => { requestId++; releaseFile(); });
  $effect(() => {
    if (open && dialog) { dialog.showModal(); cancel?.focus(); }
  });
  function releaseFile() { if (objectURL) URL.revokeObjectURL(objectURL); objectURL = ""; }
  async function run() {
    if (picking) return;
    const request = ++requestId;
    error = "";
    if (providerTab) return;
    if (tab === "url") {
      if (!safeImageUrl(urlInput.trim())) { error = `Enter ${kind === "video" ? "a video" : "an image"} URL starting with https:// or /`; return; }
      const metadata = mediaMetadata(new URL(urlInput.trim(), location.origin).pathname);
      if (kind === "video" && metadata?.category !== "Video") { error = "Choose an MP4, WebM or MOV video URL."; return; }
      if (kind === "image" && metadata && metadata.category !== "Images") { error = "Choose an image URL, not a document or other media file."; return; }
      selected = { url: urlInput.trim() };
      return;
    }
    loading = true; results = []; searched = false;
    try {
      if (tab === "library" || tab === "upload") await library();
      else {
        const found = await searchImages(tab as StockSource, query);
        if (request === requestId) results = found;
      }
      if (request === requestId) searched = true;
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : "Search failed"; }
    finally { if (request === requestId) loading = false; }
  }
  async function confirm() {
    if (providerTab) {
      const ref = parseEmbedUrl(urlInput);
      if (!ref || ref.provider !== tab) { error = `Paste a ${tab === "youtube" ? "YouTube" : "Vimeo"} video URL.`; return; }
      onembed?.({ ...ref, title: videoTitle.trim() || undefined, privacy });
      close();
      return;
    }
    if (!selected || picking) return;
    const request = ++requestId;
    const choice = selected;
    const metadata = metadataImport ? { title: metaTitle.trim(), description: metaDescription.trim(), ...(imageImport ? { alt: alt.trim() } : {}) } : null;
    picking = true; error = "";
    try {
      const url = choice.file ? await uploadMedia(choice.file) : choice.stock ? await importStockImage(choice.stock) : needsImport ? await importImageUrl(choice.url) : choice.url;
      if (!safeImageUrl(url)) throw new Error("Unsafe media URL");
      if (metadata) {
        const saved = await fetch("/rigel/api/local/media", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, ...metadata }) });
        if (!saved.ok) throw new Error(`File uploaded, but metadata could not be saved (${saved.status}). Retry to finish the import.`);
      }
      if (kind === "video" && mediaMetadata(new URL(url, location.origin).pathname)?.category !== "Video") throw new Error("Choose an MP4, WebM or MOV video URL.");
      if (request === requestId) {
        if (inline) {
          await library(); resetFilters(); notice = "Media available in the repository library.";
        } else if (kind === "video") onvideo?.({ src: url, caption: alt.trim() || undefined, muted, controls });
        else onpick?.(url, alt, choice.stock);
        close();
      }
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : "Photo import failed"; }
    finally { if (request === requestId) picking = false; }
  }
  function upload(file?: File) {
    if (!file || picking) return;
    error = "";
    const limit = maxFileSize;
    if (!safeMediaName(file.name) || (!inline && mediaMetadata(file.name)?.category !== (kind === "video" ? "Video" : "Images")) || file.size > limit) {
      error = `Choose a supported ${inline ? "file" : kind} up to ${limit / 1024 / 1024} MB with a safe filename.`; return;
    }
    const type = mediaMetadata(file.name)!.type;
    releaseFile(); objectURL = URL.createObjectURL(new Blob([file], { type: type === "text/plain" ? "text/plain; charset=utf-8" : type }));
    metaTitle = file.name.replace(/\.[^.]+$/, "").slice(0, 200); metaDescription = ""; alt = altText;
    selected = { url: objectURL, file };
  }
  function close() {
    requestId++; confirmDelete = false; dialog?.close(); open = false; loading = false; picking = false; selected = null; error = "";
    releaseFile(); onclose?.(); trigger?.focus();
  }
  function changeTab(next: typeof tab) {
    alt = altText; metaTitle = ""; metaDescription = "";
    requestId++; releaseFile(); tab = next; results = []; selected = null; error = ""; searched = false; loading = false;
    if (next === "youtube" || next === "vimeo") {
      urlInput = embed?.provider === next ? embedWatchUrl(embed) : next === "youtube" ? "https://www.youtube.com/watch?v=dQw4w9WgXcQ" : "https://vimeo.com/861680818";
      videoTitle = embed?.provider === next ? embed.title ?? "" : next === "youtube" ? "Rick Astley - Never Gonna Give You Up (Rickroll)" : "The Rolling Stones - Angry";
      privacy = embed?.provider === next ? embed.privacy : true;
      return;
    }
    urlInput = value;
    if (tab !== "url") void run();
  }
  export function launch() { onopen?.(); open = true; urlInput = value; alt = altText; changeTab(inline ? "upload" : "library"); }
  export function launchVideo(source: "library" | EmbedProvider) { onopen?.(); open = true; muted = video?.muted === true; controls = video?.controls !== false; changeTab(source); }
</script>

{#if inline}
  <div class="titlebar"><h2>Media</h2><button bind:this={trigger} type="button" class="primary" onclick={launch}>Upload</button></div>
  <div class="media-library">
    {@render libraryBrowser()}
    {#if notice}<p role="status">{notice}</p>{/if}
    {#if error && !open}<p class="error" role="alert">{error}</p>{/if}
  </div>
{:else if toolbar}
  <button bind:this={trigger} data-image-trigger={kind === "image" ? "" : undefined} type="button" aria-label={triggerLabel} data-tooltip={triggerLabel} hidden={hiddenTrigger} onmousedown={event => event.preventDefault()} onclick={launch}><Icon name="image" size={18} /></button>
{:else}
  <div class="image-field">
    {#if value}<img src={value} alt="" class="preview" />{:else}<div class="preview empty">No image</div>{/if}
    <button bind:this={trigger} type="button" class="outlined" onclick={launch}>Choose…</button>
    {#if value && onpick}<button type="button" class="outlined" aria-label="Remove image" data-tooltip="Remove image" onclick={() => onpick?.("", "")}><Icon name="x" size={14} /></button>{/if}
  </div>
{/if}

{#snippet libraryBrowser()}
  <p class="hint">Repository media: public/{folder || "…"}. {writable ? "Uploads write files immediately on confirmation; content still requires Save." : "Build-time snapshot. Uploads and stock imports require the local dev server; GitHub uploads are not connected."}</p>
  <div class="media-tools">
    <div class="media-views" role="group" aria-label="Media view">
      <button type="button" class="outlined" data-tooltip="Grid view" aria-label="Grid view" aria-pressed={view === "grid"} onclick={() => setView("grid")}><Icon name="squaresFour" size={18} /></button>
      <button type="button" class="outlined" data-tooltip="List view" aria-label="List view" aria-pressed={view === "list"} onclick={() => setView("list")}><Icon name="listBullets" size={18} /></button>
    </div>
    <div class="media-select">
      <Select ariaLabel={inline ? "Media type" : kind === "video" ? "Video format" : "Image format"} value={format} onchange={next => { format = String(next); }} options={inline ? [{ value: "", label: "All media items" }, ...MEDIA_CATEGORIES.map(category => ({ value: category, label: category }))] : kind === "video" ? [{ value: "", label: "All videos" }, { value: "video/mp4", label: "MP4" }, { value: "video/webm", label: "WebM" }, { value: "video/quicktime", label: "MOV" }] : [{ value: "", label: "All images" }, ...["jpeg", "png", "webp", "gif", "avif"].map(format => ({ value: `image/${format}`, label: format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : format.toUpperCase() }))]} />
    </div>
    <div class="media-select">
      <Select ariaLabel="Modified month" data-tooltip="Filesystem modified month (UTC), not upload date" value={month} onchange={next => { month = String(next); }} options={[{ value: "", label: "All modified dates" }, ...months.map(date => ({ value: date, label: new Date(date + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) }))]} />
    </div>
    <button type="button" class="outlined" onclick={() => { tab = "library"; void run(); }} disabled={loading || picking}>Refresh</button>
    {#if filter || format || month}<button type="button" class="outlined" onclick={resetFilters}>Reset filters</button>{/if}
    <input class="media-search" aria-label="Search media" type="search" bind:value={filter} placeholder="Search media…" />
  </div>
  {#if view === "grid"}<div class="grid">
    {#each filtered as asset, index}
      {@const extension = mediaMetadata(assetFile(asset.url))?.extension.toUpperCase() ?? "FILE"}
      <figure><button type="button" class="thumb" aria-label={asset.name} aria-describedby={`${id}-extension-${index}`} data-tooltip={asset.name} aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}>{#if asset.type?.startsWith("image/")}<img src={asset.url} alt={asset.name} loading="lazy" />{:else if asset.type?.startsWith("video/")}<video src={`${asset.url}#t=0.001`} muted preload="metadata" playsinline aria-hidden="true"></video>{:else}<span class="media-file-icon"><Icon name={mediaIcon(assetFile(asset.url))} size={40} /><span>{mediaMetadata(assetFile(asset.url))?.category}</span></span>{/if}<span id={`${id}-extension-${index}`} class="media-extension">{extension}</span></button><figcaption>{asset.name}</figcaption></figure>
    {/each}
  </div>
  {:else}<div class="table-card media-table"><table aria-label="Media library"><thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Modified (UTC)</th></tr></thead><tbody>
    {#each filtered as asset}<tr><td><button type="button" class="table-link media-file" aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}><span class="media-thumbnail" aria-hidden="true">{#if asset.type?.startsWith("image/")}<img src={asset.url} alt="" loading="lazy" />{:else}<Icon name={mediaIcon(assetFile(asset.url))} size={28} />{/if}</span><span>{asset.name}</span></button></td><td>{asset.type?.replace("image/", "").toUpperCase() || "—"}</td><td>{mediaSize(asset.size)}</td><td>{modifiedMonth(asset.modified) ? new Date(asset.modified!).toLocaleDateString(undefined, {timeZone: "UTC"}) : "—"}</td></tr>{/each}
  </tbody></table></div>{/if}
  {#if loading}<p role="status">Loading media…</p>{:else if !filtered.length}<p role="status">{assets.length ? "No media match these filters." : "No media in this folder yet."}</p>{/if}
{/snippet}

{#if open}
  <dialog bind:this={dialog} class="rigel-modal-backdrop rigel image-dialog" class:media-insert={providerTab} aria-label={providerTab ? editing ? "Edit video" : "Add video link" : inline ? "Upload media" : kind === "video" ? "Choose video" : "Choose image"} oncancel={e => { e.preventDefault(); if (!picking) close(); }} onclick={e => { if (e.target === dialog && !picking) close(); }}>
    <div class="rigel-modal image-picker">
      <div class="media-head"><h2>{providerTab ? `${editing ? "Edit" : "Add"} ${tab === "youtube" ? "YouTube" : "Vimeo"} video` : selected ? "Preview media" : inline ? "Upload media" : kind === "video" ? "Choose video" : "Choose image"}</h2><button bind:this={cancel} type="button" class="close" aria-label="Close" disabled={picking} onclick={close}><Icon name="x" size={14} weight="bold" /></button></div>
      {#if selected}
        <div class="media-selection" class:media-editing={(inline && !!selected.asset) || metadataImport}>
          <div class="media-preview">
          {#if kind === "video" || selectedMetadata?.category === "Video"}
            <video src={selected.url} controls={kind === "video" ? controls : true} muted={kind === "video" ? muted : false} preload="metadata" playsinline></video>
          {:else if selectedMetadata?.extension === "pdf" || selectedMetadata?.extension === "txt"}
            <iframe src={`${selected.file ? selected.url : `${selected.url}?preview=1`}${selectedMetadata.extension === "pdf" ? "#navpanes=0&view=FitH" : ""}`} title={selectedMetadata.extension === "pdf" ? "PDF preview" : "Text preview"} sandbox={selectedMetadata.extension === "txt" ? "" : undefined}></iframe>
          {:else if (!selected.file && !selected.asset) || selectedMetadata?.category === "Images"}
            <img src={selected.url} alt="Selected image preview" />
          {:else}
            <div class="media-file-icon"><Icon name={mediaIcon(selected.file?.name ?? assetFile(selected.asset?.url ?? ""))} size={64} /><p>{selectedMetadata?.category} · {mediaSize(selected.file?.size ?? selected.asset?.size)}</p><p>{selectedMetadata?.type}</p></div>
          {/if}
          </div>
          <div class="media-details">
          {#if (inline && selected.asset) || metadataImport}
            <div class="media-meta">
              {#if inline && selected.asset}<label><span>Display name</span><input aria-label="Media display name" type="text" maxlength="120" bind:value={metaName} /></label>{/if}
              {#if imageImport}<label><span>Alt text (leave empty if decorative)</span><input aria-label="Image alt text" type="text" maxlength="1000" disabled={picking} bind:value={alt} /></label>{:else if selected.asset?.type?.startsWith("image/")}<label><span>Alt text</span><textarea aria-label="Media alt text" rows="3" maxlength="1000" bind:value={metaAlt}></textarea></label>{/if}
              <label><span>Title</span><input aria-label={imageImport ? "Image title" : "Media title"} type="text" maxlength="200" disabled={picking} bind:value={metaTitle} /></label>
              <label><span>Description</span><textarea aria-label={imageImport ? "Image description" : "Media description"} rows="3" maxlength="1000" disabled={picking} bind:value={metaDescription}></textarea></label>
              {#if selected.asset}<p class="hint">Author: {selected.asset.author || "Local user"}</p>{:else if selected.file}<p class="hint">{selected.file.name}</p>{/if}
            </div>
          {:else if selected.file}
            <p class="hint">{selected.file.name}</p>
          {:else if !selected.asset}
            <label><span>{kind === "video" ? "Video URL" : "Image URL"}</span><input type="text" readonly value={selected.url} /></label>
          {/if}
          {#if imageImport && !selected.file}<label><span>Image URL</span><input type="text" readonly value={selected.url} /></label>{/if}
          {#if !inline && !imageImport}<label><span>{kind === "video" ? "Caption (optional)" : "Alt text (describe the image; leave empty if decorative)"}</span><input aria-label={kind === "video" ? "Video caption" : undefined} type="text" bind:value={alt} /></label>{/if}
          {#if kind === "video"}
            <label class="inline"><input type="checkbox" role="switch" class="switch" aria-label="Muted" bind:checked={muted} /><span>Muted</span></label>
            <label class="inline"><input type="checkbox" role="switch" class="switch" aria-label="Show controls" bind:checked={controls} /><span>Show controls</span></label>
          {/if}
          {#if selected.stock?.credit}<p class="hint">{selected.stock.credit}</p>{/if}
          {#if needsImport}<p class="hint">Confirmation {selected.file ? "uploads" : "downloads"} this file into the repository media folder. Content still requires Save.</p>{/if}
          </div>
          <div class="media-actions" class:with-media-path={!!selected.asset}>
          {#if metaError || metaNotice}<p class="media-feedback" class:error={!!metaError} role={metaError ? "alert" : "status"}>{metaError || metaNotice}</p>{/if}
          {#if selected.asset}
            <a class="outlined media-download" href={selected.asset.url} download={assetFile(selected.asset.url)}>Download file</a>
            {#if inline && writable}<button bind:this={deleteTrigger} type="button" class="danger-btn" aria-label="Delete file" disabled={picking || savingMeta} onclick={() => { confirmDelete = true; }}>Delete file</button>{/if}
            <pre class="media-path" role="region" aria-label="Media file path" tabindex="0"><code>{selected.asset.url}</code></pre>
          {/if}
          <div class="media-button-actions">
          {#if inline && selected.asset}
            <button type="button" class="outlined" disabled={picking || savingMeta} onclick={close}>Cancel</button>
            <button type="button" class="primary" disabled={picking || savingMeta} onclick={saveMetadata}>{savingMeta ? "Saving…" : "Save"}</button>
          {:else}
            <button type="button" class="outlined" disabled={picking} onclick={() => { selected = null; releaseFile(); }}>Back</button>
            {#if inline && tab === "library"}<button type="button" class="primary" onclick={close}>Done</button>{:else}<button type="button" class="primary" disabled={picking || (needsImport && !writable)} onclick={confirm}>{picking ? kind === "video" ? "Uploading video…" : "Importing photo…" : kind === "video" ? "Use video" : !inline ? "Insert image" : selected.file && mediaMetadata(selected.file.name)?.category !== "Images" ? "Upload file" : "Import image"}</button>{/if}
          {/if}</div>
          </div>
        </div>
      {:else}
        <div class="tabs" aria-label={kind === "video" ? "Video sources" : "Image sources"}>
          {#each tabs.filter(t => !inline || (t !== "library" && t !== "unsplash")) as t}<button type="button" data-source={t} class:active={tab === t} aria-pressed={tab === t} disabled={picking} onclick={() => changeTab(t)}>{t === "youtube" ? "YouTube" : t === "vimeo" ? "Vimeo" : t}</button>{/each}
        </div>
        {#if inline}<p class="hint">Unsplash API photos require hotlinking and are available only when inserting images into content, not as repository uploads.</p>{/if}
        {#if providerTab}
          <p class="hint">Paste a {tab === "youtube" ? "YouTube" : "Vimeo"} link. Privacy-enhanced mode is enabled by default.</p>
          <label><span>Video URL</span><input type="text" bind:value={urlInput} placeholder={tab === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"} /></label>
          <label><span>Title for accessibility (optional)</span><input type="text" maxlength="200" bind:value={videoTitle} /></label>
          <label class="inline"><input type="checkbox" role="switch" class="switch" bind:checked={privacy} /><span>Privacy-enhanced (no cookies until play)</span></label>
          <div class="media-actions media-button-actions">
            <button type="button" class="outlined" onclick={close}>Cancel</button>
            <button type="button" class="primary" onclick={confirm}>{editing ? "Update video" : "Insert"}</button>
          </div>
        {:else if tab === "library"}
          {@render libraryBrowser()}
        {:else if tab === "upload"}
          <p class="hint">Choose a local file, then preview and confirm. Nothing is uploaded until confirmation.</p>
          {#if writable}<label><span>{kind === "video" ? "Upload video (MP4, WebM, MOV)" : inline ? "Upload media (images, audio, video, documents, spreadsheets, archives)" : "Upload image (JPEG, PNG, WebP, GIF, AVIF)"} · {maxFileSize / 1024 / 1024} MB maximum</span><input type="file" accept={kind === "video" ? ".mp4,.webm,.mov" : mediaAccept(!inline)} onchange={e => upload(e.currentTarget.files?.[0])} /></label>{:else}<p role="status">Local uploads require the local dev server. This library is read-only.</p>{/if}
        {:else if tab === "url"}
          <label><span>{kind === "video" ? "Video URL" : "Image URL"}</span><input type="url" bind:value={urlInput} placeholder={kind === "video" ? "https://… or /media/video.mp4" : "https://… or /images/photo.jpg"} /></label>
          <button type="button" class="primary" onclick={run}>Use this URL</button>
        {:else}
          <p class="hint">{tab === "picsum" ? "Placeholder photos from Lorem Picsum (seed, not semantic search)." : tab === "unsplash" ? "Unsplash photos stay linked to Unsplash; selection records a download." : "Import selected photos into the media folder (local dev only)."}</p>
          <div class="search-row"><input aria-label="Search photos" type="search" bind:value={query} placeholder="Search photos…" onkeydown={e => e.key === "Enter" && run()} /><button type="button" class="primary" onclick={run} disabled={loading || picking}>{loading ? "…" : "Search"}</button></div>
          {#if searched && !results.length && !error}<p class="hint" role="status">No photos found. Try another search.</p>{/if}
          <div class="grid">
            {#each results as r (r.url)}
              <figure><button type="button" class="thumb" disabled={picking} onclick={() => selectStock(r)} data-tooltip={r.credit}><img src={r.thumb} alt={r.credit} loading="lazy" /></button><figcaption>{#if r.creditURL?.startsWith("https://")}<a href={r.creditURL} target="_blank" rel="noopener noreferrer">{r.credit}</a>{:else}{r.credit}{/if}</figcaption></figure>
            {/each}
          </div>
        {/if}
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  </dialog>
  {#if confirmDelete && selected?.asset}
    <ActionDialog title={`Delete “${selected.asset.name}”?`} description="This permanently deletes the file and its metadata. This cannot be undone. Any pages using this file will have broken media or links." confirmLabel="Delete file" danger onconfirm={deleteFile} onclose={async () => { confirmDelete = false; await tick(); deleteTrigger?.focus(); }} />
  {/if}
{/if}
