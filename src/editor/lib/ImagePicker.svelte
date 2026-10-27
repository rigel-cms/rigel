<script lang="ts">
  import { locale, t } from "../i18n";
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

  let { value = "", altText = "", triggerLabel, kind = "image", video, onvideo, embed, onembed, onpick, inline = false, toolbar = false, hiddenTrigger = false, onopen, onclose }: {
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
      const response = await fetch("/rigel/api/local/media", { method: "PUT", headers: { "Content-Type": "application/json", "Accept-Language": $locale }, body: JSON.stringify({ url, name: metaName.trim() || undefined, title: metaTitle.trim() || undefined, description: metaDescription.trim() || undefined, alt: selected.asset.type?.startsWith("image/") ? metaAlt : undefined }) });
      if (!response.ok) { metaError = $t("media.metadataSaveFailedStatus", { status: response.status }); return; }
      await library();
      selected = { url, asset: assets.find(a => a.url === url) };
      metaNotice = $t("media.metadataSaved");
    } catch { metaError = $t("media.metadataSaveFailed"); }
    finally { savingMeta = false; }
  }
  async function deleteFile() {
    if (!selected?.asset || !writable || picking || savingMeta) return;
    const url = selected.asset.url;
    picking = true;
    try {
      const response = await fetch("/rigel/api/local/media", { method: "DELETE", headers: { "Content-Type": "application/json", "Accept-Language": $locale }, body: JSON.stringify({ url }) });
      if (!response.ok) throw new Error($t("media.deleteFailed", { status: response.status }));
      assets = assets.filter(asset => asset.url !== url);
      librarySelection = ""; notice = $t("media.fileDeleted");
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
    const response = await fetch("/rigel/media.json", { cache: "no-store", headers: { "Accept-Language": $locale } });
    if (!response.ok) throw new Error($t("media.listingUnavailable"));
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
      if (!safeImageUrl(urlInput.trim())) { error = $t(kind === "video" ? "media.enterVideoUrl" : "media.enterImageUrl"); return; }
      const metadata = mediaMetadata(new URL(urlInput.trim(), location.origin).pathname);
      if (kind === "video" && metadata?.category !== "Video") { error = $t("media.chooseVideoUrl"); return; }
      if (kind === "image" && metadata && metadata.category !== "Images") { error = $t("media.chooseImageUrl"); return; }
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
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : $t("media.searchFailed"); }
    finally { if (request === requestId) loading = false; }
  }
  async function confirm() {
    if (providerTab) {
      const ref = parseEmbedUrl(urlInput);
      if (!ref || ref.provider !== tab) { error = $t("media.pasteVideoUrl", { provider: tab === "youtube" ? "YouTube" : "Vimeo" }); return; }
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
      if (!safeImageUrl(url)) throw new Error($t("media.unsafeMediaUrl"));
      if (metadata) {
        const saved = await fetch("/rigel/api/local/media", { method: "PUT", headers: { "Content-Type": "application/json", "Accept-Language": $locale }, body: JSON.stringify({ url, ...metadata }) });
        if (!saved.ok) throw new Error($t("media.uploadedMetadataFailed", { status: saved.status }));
      }
      if (kind === "video" && mediaMetadata(new URL(url, location.origin).pathname)?.category !== "Video") throw new Error($t("media.chooseVideoUrl"));
      if (request === requestId) {
        if (inline) {
          await library(); resetFilters(); notice = $t("media.availableInLibrary");
        } else if (kind === "video") onvideo?.({ src: url, caption: alt.trim() || undefined, muted, controls });
        else onpick?.(url, alt, choice.stock);
        close();
      }
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : $t("media.photoImportFailed"); }
    finally { if (request === requestId) picking = false; }
  }
  function upload(file?: File) {
    if (!file || picking) return;
    error = "";
    const limit = maxFileSize;
    if (!safeMediaName(file.name) || (!inline && mediaMetadata(file.name)?.category !== (kind === "video" ? "Video" : "Images")) || file.size > limit) {
      error = $t(inline ? "media.chooseSupportedFile" : kind === "video" ? "media.chooseSupportedVideo" : "media.chooseSupportedImage", { limit: limit / 1024 / 1024 }); return;
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
  <div class="titlebar"><h2>{$t("media.heading")}</h2><button bind:this={trigger} type="button" class="primary" onclick={launch}>{$t("media.upload")}</button></div>
  <div class="media-library">
    {@render libraryBrowser()}
    {#if notice}<p role="status">{notice}</p>{/if}
    {#if error && !open}<p class="error" role="alert">{error}</p>{/if}
  </div>
{:else if toolbar}
  <button bind:this={trigger} data-image-trigger={kind === "image" ? "" : undefined} type="button" aria-label={triggerLabel ?? $t("media.insertImage")} data-tooltip={triggerLabel ?? $t("media.insertImage")} hidden={hiddenTrigger} onmousedown={event => event.preventDefault()} onclick={launch}><Icon name="image" size={18} /></button>
{:else}
  <div class="image-field">
    {#if value}<img src={value} alt="" class="preview" />{:else}<div class="preview empty">{$t("media.noImage")}</div>{/if}
    <button bind:this={trigger} type="button" class="outlined" onclick={launch}>{$t("media.choose")}</button>
    {#if value && onpick}<button type="button" class="outlined" aria-label={$t("media.removeImage")} data-tooltip={$t("media.removeImage")} onclick={() => onpick?.("", "")}><Icon name="x" size={14} /></button>{/if}
  </div>
{/if}

{#snippet libraryBrowser()}
  <p class="hint">{$t(writable ? "media.repositoryWritable" : "media.repositorySnapshot", { folder: folder || "…" })}</p>
  <div class="media-tools">
    <div class="media-views" role="group" aria-label={$t("media.view")}>
      <button type="button" class="outlined" data-tooltip={$t("media.gridView")} aria-label={$t("media.gridView")} aria-pressed={view === "grid"} onclick={() => setView("grid")}><Icon name="squaresFour" size={18} /></button>
      <button type="button" class="outlined" data-tooltip={$t("media.listView")} aria-label={$t("media.listView")} aria-pressed={view === "list"} onclick={() => setView("list")}><Icon name="listBullets" size={18} /></button>
    </div>
    <div class="media-select">
      <Select ariaLabel={$t(inline ? "media.type" : kind === "video" ? "media.videoFormat" : "media.imageFormat")} value={format} onchange={next => { format = String(next); }} options={inline ? [{ value: "", label: $t("media.allItems") }, ...MEDIA_CATEGORIES.map(category => ({ value: category, label: $t(`media.category.${category}`) }))] : kind === "video" ? [{ value: "", label: $t("media.allVideos") }, { value: "video/mp4", label: "MP4" }, { value: "video/webm", label: "WebM" }, { value: "video/quicktime", label: "MOV" }] : [{ value: "", label: $t("media.allImages") }, ...["jpeg", "png", "webp", "gif", "avif"].map(format => ({ value: `image/${format}`, label: format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : format.toUpperCase() }))]} />
    </div>
    <div class="media-select">
      <Select ariaLabel={$t("media.modifiedMonth")} data-tooltip={$t("media.modifiedMonthHint")} value={month} onchange={next => { month = String(next); }} options={[{ value: "", label: $t("media.allModifiedDates") }, ...months.map(date => ({ value: date, label: new Date(date + "-01T00:00:00Z").toLocaleDateString($locale, { month: "long", year: "numeric", timeZone: "UTC" }) }))]} />
    </div>
    <button type="button" class="outlined" onclick={() => { tab = "library"; void run(); }} disabled={loading || picking}>{$t("media.refresh")}</button>
    {#if filter || format || month}<button type="button" class="outlined" onclick={resetFilters}>{$t("media.resetFilters")}</button>{/if}
    <input class="media-search" aria-label={$t("media.searchMedia")} type="search" bind:value={filter} placeholder={$t("media.searchMediaPlaceholder")} />
  </div>
  {#if view === "grid"}<div class="grid">
    {#each filtered as asset, index}
      {@const extension = mediaMetadata(assetFile(asset.url))?.extension.toUpperCase() ?? $t("media.fileExtension")}
      <figure><button type="button" class="thumb" aria-label={asset.name} aria-describedby={`${id}-extension-${index}`} data-tooltip={asset.name} aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}>{#if asset.type?.startsWith("image/")}<img src={asset.url} alt={asset.name} loading="lazy" />{:else if asset.type?.startsWith("video/")}<video src={`${asset.url}#t=0.001`} muted preload="metadata" playsinline aria-hidden="true"></video>{:else}<span class="media-file-icon"><Icon name={mediaIcon(assetFile(asset.url))} size={40} /><span>{mediaMetadata(assetFile(asset.url))?.category ? $t(`media.category.${mediaMetadata(assetFile(asset.url))!.category}`) : ""}</span></span>{/if}<span id={`${id}-extension-${index}`} class="media-extension">{extension}</span></button><figcaption>{asset.name}</figcaption></figure>
    {/each}
  </div>
  {:else}<div class="table-card media-table"><table aria-label={$t("media.library")}><thead><tr><th scope="col">{$t("media.file")}</th><th scope="col">{$t("media.fileType")}</th><th scope="col">{$t("media.size")}</th><th scope="col">{$t("media.modifiedUtc")}</th></tr></thead><tbody>
    {#each filtered as asset}<tr><td><button type="button" class="table-link media-file" aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}><span class="media-thumbnail" aria-hidden="true">{#if asset.type?.startsWith("image/")}<img src={asset.url} alt="" loading="lazy" />{:else}<Icon name={mediaIcon(assetFile(asset.url))} size={28} />{/if}</span><span>{asset.name}</span></button></td><td>{asset.type?.replace("image/", "").toUpperCase() || "—"}</td><td>{mediaSize(asset.size)}</td><td>{modifiedMonth(asset.modified) ? new Date(asset.modified!).toLocaleDateString($locale, {timeZone: "UTC"}) : "—"}</td></tr>{/each}
  </tbody></table></div>{/if}
  {#if loading}<p role="status">{$t("media.loading")}</p>{:else if !filtered.length}<p role="status">{$t(assets.length ? "media.noMatches" : "media.emptyFolder")}</p>{/if}
{/snippet}

{#if open}
  <dialog bind:this={dialog} class="rigel-modal-backdrop rigel image-dialog" class:media-insert={providerTab} aria-label={$t(providerTab ? editing ? "media.editVideo" : "media.addVideoLink" : inline ? "media.uploadMedia" : kind === "video" ? "media.chooseVideo" : "media.chooseImage")} oncancel={e => { e.preventDefault(); if (!picking) close(); }} onclick={e => { if (e.target === dialog && !picking) close(); }}>
    <div class="rigel-modal image-picker">
      <div class="media-head"><h2>{providerTab ? $t(editing ? "media.editProviderVideo" : "media.addProviderVideo", { provider: tab === "youtube" ? "YouTube" : "Vimeo" }) : $t(selected ? "media.previewMedia" : inline ? "media.uploadMedia" : kind === "video" ? "media.chooseVideo" : "media.chooseImage")}</h2><button bind:this={cancel} type="button" class="close" aria-label={$t("media.close")} disabled={picking} onclick={close}><Icon name="x" size={14} weight="bold" /></button></div>
      {#if selected}
        <div class="media-selection" class:media-editing={(inline && !!selected.asset) || metadataImport}>
          <div class="media-preview">
          {#if kind === "video" || selectedMetadata?.category === "Video"}
            <video src={selected.url} controls={kind === "video" ? controls : true} muted={kind === "video" ? muted : false} preload="metadata" playsinline></video>
          {:else if selectedMetadata?.extension === "pdf" || selectedMetadata?.extension === "txt"}
            <iframe src={`${selected.file ? selected.url : `${selected.url}?preview=1`}${selectedMetadata.extension === "pdf" ? "#navpanes=0&view=FitH" : ""}`} title={$t(selectedMetadata.extension === "pdf" ? "media.pdfPreview" : "media.textPreview")} sandbox={selectedMetadata.extension === "txt" ? "" : undefined}></iframe>
          {:else if (!selected.file && !selected.asset) || selectedMetadata?.category === "Images"}
            <img src={selected.url} alt={$t("media.selectedImagePreview")} />
          {:else}
            <div class="media-file-icon"><Icon name={mediaIcon(selected.file?.name ?? assetFile(selected.asset?.url ?? ""))} size={64} /><p>{selectedMetadata?.category ? $t(`media.category.${selectedMetadata.category}`) : ""} · {mediaSize(selected.file?.size ?? selected.asset?.size)}</p><p>{selectedMetadata?.type}</p></div>
          {/if}
          </div>
          <div class="media-details">
          {#if (inline && selected.asset) || metadataImport}
            <div class="media-meta">
              {#if inline && selected.asset}<label><span>{$t("media.displayName")}</span><input aria-label={$t("media.mediaDisplayName")} type="text" maxlength="120" bind:value={metaName} /></label>{/if}
              {#if imageImport}<label><span>{$t("media.decorativeAlt")}</span><input aria-label={$t("media.imageAlt")} type="text" maxlength="1000" disabled={picking} bind:value={alt} /></label>{:else if selected.asset?.type?.startsWith("image/")}<label><span>{$t("media.alt")}</span><textarea aria-label={$t("media.mediaAlt")} rows="3" maxlength="1000" bind:value={metaAlt}></textarea></label>{/if}
              <label><span>{$t("media.title")}</span><input aria-label={$t(imageImport ? "media.imageTitle" : "media.mediaTitle")} type="text" maxlength="200" disabled={picking} bind:value={metaTitle} /></label>
              <label><span>{$t("media.description")}</span><textarea aria-label={$t(imageImport ? "media.imageDescription" : "media.mediaDescription")} rows="3" maxlength="1000" disabled={picking} bind:value={metaDescription}></textarea></label>
              {#if selected.asset}<p class="hint">{$t("media.author", { author: selected.asset.author || $t("media.localUser") })}</p>{:else if selected.file}<p class="hint">{selected.file.name}</p>{/if}
            </div>
          {:else if selected.file}
            <p class="hint">{selected.file.name}</p>
          {:else if !selected.asset}
            <label><span>{$t(kind === "video" ? "media.videoUrl" : "media.imageUrl")}</span><input type="text" readonly value={selected.url} /></label>
          {/if}
          {#if imageImport && !selected.file}<label><span>{$t("media.imageUrl")}</span><input type="text" readonly value={selected.url} /></label>{/if}
          {#if !inline && !imageImport}<label><span>{$t(kind === "video" ? "media.captionOptional" : "media.descriptiveAlt")}</span><input aria-label={kind === "video" ? $t("media.videoCaption") : undefined} type="text" bind:value={alt} /></label>{/if}
          {#if kind === "video"}
            <label class="inline"><input type="checkbox" role="switch" class="switch" aria-label={$t("media.muted")} bind:checked={muted} /><span>{$t("media.muted")}</span></label>
            <label class="inline"><input type="checkbox" role="switch" class="switch" aria-label={$t("media.showControls")} bind:checked={controls} /><span>{$t("media.showControls")}</span></label>
          {/if}
          {#if selected.stock?.credit}<p class="hint">{selected.stock.credit}</p>{/if}
          {#if needsImport}<p class="hint">{$t(selected.file ? "media.confirmUpload" : "media.confirmDownload")}</p>{/if}
          </div>
          <div class="media-actions" class:with-media-path={!!selected.asset}>
          {#if metaError || metaNotice}<p class="media-feedback" class:error={!!metaError} role={metaError ? "alert" : "status"}>{metaError || metaNotice}</p>{/if}
          {#if selected.asset}
            <a class="outlined media-download" href={selected.asset.url} download={assetFile(selected.asset.url)}>{$t("media.downloadFile")}</a>
            {#if inline && writable}<button bind:this={deleteTrigger} type="button" class="danger-btn" aria-label={$t("media.deleteFile")} disabled={picking || savingMeta} onclick={() => { confirmDelete = true; }}>{$t("media.deleteFile")}</button>{/if}
            <pre class="media-path" role="region" aria-label={$t("media.filePath")} tabindex="0"><code>{selected.asset.url}</code></pre>
          {/if}
          <div class="media-button-actions">
          {#if inline && selected.asset}
            <button type="button" class="outlined" disabled={picking || savingMeta} onclick={close}>{$t("media.cancel")}</button>
            <button type="button" class="primary" disabled={picking || savingMeta} onclick={saveMetadata}>{$t(savingMeta ? "media.saving" : "media.save")}</button>
          {:else}
            <button type="button" class="outlined" disabled={picking} onclick={() => { selected = null; releaseFile(); }}>{$t("media.back")}</button>
            {#if inline && tab === "library"}<button type="button" class="primary" onclick={close}>{$t("media.done")}</button>{:else}<button type="button" class="primary" disabled={picking || (needsImport && !writable)} onclick={confirm}>{$t(picking ? kind === "video" ? "media.uploadingVideo" : "media.importingPhoto" : kind === "video" ? "media.useVideo" : !inline ? "media.insertImage" : selected.file && mediaMetadata(selected.file.name)?.category !== "Images" ? "media.uploadFile" : "media.importImage")}</button>{/if}
          {/if}</div>
          </div>
        </div>
      {:else}
        <div class="tabs" aria-label={$t(kind === "video" ? "media.videoSources" : "media.imageSources")}>
          {#each tabs.filter(source => !inline || (source !== "library" && source !== "unsplash")) as source}<button type="button" data-source={source} class:active={tab === source} aria-pressed={tab === source} disabled={picking} onclick={() => changeTab(source)}>{source === "youtube" ? "YouTube" : source === "vimeo" ? "Vimeo" : source === "library" || source === "upload" || source === "url" ? $t(`media.source.${source}`) : source}</button>{/each}
        </div>
        {#if inline}<p class="hint">{$t("media.unsplashUploadsHint")}</p>{/if}
        {#if providerTab}
          <p class="hint">{$t("media.providerLinkHint", { provider: tab === "youtube" ? "YouTube" : "Vimeo" })}</p>
          <label><span>{$t("media.videoUrl")}</span><input type="text" bind:value={urlInput} placeholder={tab === "youtube" ? "https://www.youtube.com/watch?v=…" : "https://vimeo.com/…"} /></label>
          <label><span>{$t("media.accessibleTitle")}</span><input type="text" maxlength="200" bind:value={videoTitle} /></label>
          <label class="inline"><input type="checkbox" role="switch" class="switch" bind:checked={privacy} /><span>{$t("media.privacyEnhanced")}</span></label>
          <div class="media-actions media-button-actions">
            <button type="button" class="outlined" onclick={close}>{$t("media.cancel")}</button>
            <button type="button" class="primary" onclick={confirm}>{$t(editing ? "media.updateVideo" : "media.insert")}</button>
          </div>
        {:else if tab === "library"}
          {@render libraryBrowser()}
        {:else if tab === "upload"}
          <p class="hint">{$t("media.localFileHint")}</p>
          {#if writable}<label><span>{$t(kind === "video" ? "media.uploadVideoLimit" : inline ? "media.uploadMediaLimit" : "media.uploadImageLimit", { limit: maxFileSize / 1024 / 1024 })}</span><input type="file" accept={kind === "video" ? ".mp4,.webm,.mov" : mediaAccept(!inline)} onchange={e => upload(e.currentTarget.files?.[0])} /></label>{:else}<p role="status">{$t("media.readOnlyUploads")}</p>{/if}
        {:else if tab === "url"}
          <label><span>{$t(kind === "video" ? "media.videoUrl" : "media.imageUrl")}</span><input type="url" bind:value={urlInput} placeholder={$t(kind === "video" ? "media.videoUrlPlaceholder" : "media.imageUrlPlaceholder")} /></label>
          <button type="button" class="primary" onclick={run}>{$t("media.useUrl")}</button>
        {:else}
          <p class="hint">{$t(tab === "picsum" ? "media.picsumHint" : tab === "unsplash" ? "media.unsplashHint" : "media.stockImportHint")}</p>
          <div class="search-row"><input aria-label={$t("media.searchPhotos")} type="search" bind:value={query} placeholder={$t("media.searchPhotosPlaceholder")} onkeydown={e => e.key === "Enter" && run()} /><button type="button" class="primary" onclick={run} disabled={loading || picking}>{loading ? "…" : $t("media.search")}</button></div>
          {#if searched && !results.length && !error}<p class="hint" role="status">{$t("media.noPhotos")}</p>{/if}
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
    <ActionDialog title={$t("media.deleteTitle", { name: selected.asset.name })} description={$t("media.deleteDescription")} confirmLabel={$t("media.deleteFile")} danger onconfirm={deleteFile} onclose={async () => { confirmDelete = false; await tick(); deleteTrigger?.focus(); }} />
  {/if}
{/if}
