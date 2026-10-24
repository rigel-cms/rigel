<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Icon from "./Icon.svelte";
  import Select from "./Select.svelte";
  import { getSettings, setSettings } from "./settings";
  import { MEDIA_CATEGORIES, mediaMetadata, mediaAccept, safeMediaName } from "../../media-types";
  import { filterMedia, modifiedMonth, mediaSize, assetFile, type MediaAsset } from "./media-library";
  import { searchImages, importStockImage, importImageUrl, uploadMedia, safeImageUrl, STOCK_PROVIDERS, type StockResult, type StockSource } from "./images";

  let { value = "", altText = "", triggerLabel = "Insert image", onpick, inline = false, toolbar = false, hiddenTrigger = false, onopen, onclose }: {
    value?: string; onpick?: (url: string, alt: string, credit?: StockResult) => void;
    altText?: string; triggerLabel?: string;
    inline?: boolean; toolbar?: boolean; hiddenTrigger?: boolean; onopen?: () => void; onclose?: () => void;
  } = $props();
  let open = $state(false);
  let tab = $state<"library" | "upload" | "url" | StockSource>("library");
  const tabs = ["library", "upload", "url", "picsum", ...Object.keys(STOCK_PROVIDERS)] as (typeof tab)[];
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
  let metaName = $state("");
  let metaTitle = $state("");
  let metaDescription = $state("");
  let metaAlt = $state("");
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
  const needsImport = $derived(!!selected?.file || (!!selected && ((inline && tab === "url") || !selected.url.startsWith("/")) && selected.stock?.source !== "unsplash"));

  async function library() {
    const response = await fetch("/rigel/media.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Media listing unavailable. Start the local dev server or rebuild the site.");
    const data = await response.json();
    assets = (data.assets ?? data.images).filter((asset: MediaAsset) => inline || asset.type?.startsWith("image/"));
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
    if (tab === "url") {
      if (!safeImageUrl(urlInput.trim())) { error = "Enter an image URL starting with https:// or /"; return; }
      const metadata = mediaMetadata(new URL(urlInput.trim(), location.origin).pathname);
      if (metadata && metadata.category !== "Images") { error = "Choose an image URL, not a document or other media file."; return; }
      selected = { url: urlInput.trim() };
      return;
    }
    loading = true; results = []; searched = false;
    try {
      if (tab === "library" || tab === "upload") await library();
      else {
        const found = await searchImages(tab, query);
        if (request === requestId) results = found;
      }
      if (request === requestId) searched = true;
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : "Search failed"; }
    finally { if (request === requestId) loading = false; }
  }
  async function confirm() {
    if (!selected || picking) return;
    const request = ++requestId;
    const choice = selected;
    picking = true; error = "";
    try {
      const url = choice.file ? await uploadMedia(choice.file) : choice.stock ? await importStockImage(choice.stock) : needsImport ? await importImageUrl(choice.url) : choice.url;
      if (!safeImageUrl(url)) throw new Error("Unsafe image URL");
      if (request === requestId) {
        if (inline) {
          await library(); resetFilters(); notice = "Media available in the repository library.";
        } else onpick?.(url, alt, choice.stock);
        close();
      }
    } catch (e) { if (request === requestId) error = e instanceof Error ? e.message : "Photo import failed"; }
    finally { if (request === requestId) picking = false; }
  }
  function upload(file?: File) {
    if (!file || picking) return;
    error = "";
    if (!safeMediaName(file.name) || (!inline && mediaMetadata(file.name)?.category !== "Images") || file.size > 10 * 1024 * 1024) {
      error = "Choose a supported " + (inline ? "file" : "image") + " up to 10 MB with a safe filename."; return;
    }
    releaseFile(); objectURL = URL.createObjectURL(file);
    selected = { url: objectURL, file };
  }
  function close() {
    requestId++; dialog?.close(); open = false; loading = false; picking = false; selected = null; error = "";
    releaseFile(); onclose?.(); trigger?.focus();
  }
  function changeTab(next: typeof tab) {
    alt = altText;
    requestId++; releaseFile(); tab = next; results = []; selected = null; error = ""; searched = false; loading = false;
    if (tab !== "url") void run();
  }
  function launch() { onopen?.(); open = true; urlInput = value; alt = altText; changeTab(inline ? "upload" : "library"); }
</script>

{#if inline}
  <div class="titlebar"><h2>Media</h2><button bind:this={trigger} type="button" class="primary" onclick={launch}>Upload</button></div>
  <div class="media-library">
    {@render libraryBrowser()}
    {#if notice}<p role="status">{notice}</p>{/if}
    {#if error && !open}<p class="error" role="alert">{error}</p>{/if}
  </div>
{:else if toolbar}
  <button bind:this={trigger} data-image-trigger type="button" aria-label={triggerLabel} data-tooltip={triggerLabel} hidden={hiddenTrigger} onmousedown={event => event.preventDefault()} onclick={launch}><Icon name="image" size={18} /></button>
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
      <Select ariaLabel={inline ? "Media type" : "Image format"} value={format} onchange={next => { format = String(next); }} options={inline ? [{ value: "", label: "All media items" }, ...MEDIA_CATEGORIES.map(category => ({ value: category, label: category }))] : [{ value: "", label: "All images" }, ...["jpeg", "png", "webp", "gif", "avif"].map(format => ({ value: `image/${format}`, label: format === "jpeg" ? "JPEG" : format === "webp" ? "WebP" : format.toUpperCase() }))]} />
    </div>
    <div class="media-select">
      <Select ariaLabel="Modified month" data-tooltip="Filesystem modified month (UTC), not upload date" value={month} onchange={next => { month = String(next); }} options={[{ value: "", label: "All modified dates" }, ...months.map(date => ({ value: date, label: new Date(date + "-01T00:00:00Z").toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" }) }))]} />
    </div>
    <button type="button" class="outlined" onclick={() => { tab = "library"; void run(); }} disabled={loading || picking}>Refresh</button>
    {#if filter || format || month}<button type="button" class="outlined" onclick={resetFilters}>Reset filters</button>{/if}
    <input class="media-search" aria-label="Search media" type="search" bind:value={filter} placeholder="Search media…" />
  </div>
  {#if view === "grid"}<div class="grid">
    {#each filtered as asset}
      <figure><button type="button" class="thumb" aria-label={asset.name} data-tooltip={asset.name} aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}>{#if asset.type?.startsWith("image/")}<img src={asset.url} alt={asset.name} loading="lazy" />{:else}<span class="media-file-icon"><Icon name="listBullets" size={40} /><span>{mediaMetadata(asset.name)?.category} · {mediaMetadata(asset.name)?.extension.toUpperCase()}</span></span>{/if}</button><figcaption>{asset.name}</figcaption></figure>
    {/each}
  </div>
  {:else}<div class="table-card media-table"><table aria-label="Media library"><thead><tr><th scope="col">File</th><th scope="col">Type</th><th scope="col">Size</th><th scope="col">Modified (UTC)</th></tr></thead><tbody>
    {#each filtered as asset}<tr><td><button type="button" class="table-link media-file" aria-pressed={librarySelection === asset.url} onclick={() => selectAsset(asset)}>{#if asset.type?.startsWith("image/")}<img src={asset.url} alt="" loading="lazy" />{:else}<Icon name="listBullets" size={28} />{/if}<span>{asset.name}</span></button></td><td>{asset.type?.replace("image/", "").toUpperCase() || "—"}</td><td>{mediaSize(asset.size)}</td><td>{modifiedMonth(asset.modified) ? new Date(asset.modified!).toLocaleDateString(undefined, {timeZone: "UTC"}) : "—"}</td></tr>{/each}
  </tbody></table></div>{/if}
  {#if loading}<p role="status">Loading media…</p>{:else if !filtered.length}<p role="status">{assets.length ? "No media match these filters." : "No media in this folder yet."}</p>{/if}
{/snippet}

{#if open}
  <dialog bind:this={dialog} class="rigel-modal-backdrop rigel image-dialog" aria-label={inline ? "Upload media" : "Choose image"} oncancel={e => { e.preventDefault(); if (!picking) close(); }} onclick={e => { if (e.target === dialog && !picking) close(); }}>
    <div class="rigel-modal image-picker">
      <div class="media-head"><h2>{selected ? "Preview media" : inline ? "Upload media" : "Choose image"}</h2><button bind:this={cancel} type="button" class="close" aria-label="Close" disabled={picking} onclick={close}><Icon name="x" size={14} weight="bold" /></button></div>
      {#if selected}
        <div class="media-selection" class:media-editing={inline && !!selected.asset}>
          <div class="media-preview">
          {#if (!selected.file && !selected.asset) || mediaMetadata(selected.file?.name ?? (selected.asset ? assetFile(selected.asset.url) : ""))?.category === "Images"}<img src={selected.url} alt="Selected image preview" />{:else}<div class="media-file-icon"><Icon name="listBullets" size={64} /><p>{mediaMetadata(selected.file?.name ?? (selected.asset ? assetFile(selected.asset.url) : ""))?.category} · {mediaSize(selected.file?.size ?? selected.asset?.size)}</p><p>{selected.asset?.type ?? mediaMetadata(selected.file?.name ?? "")?.type}</p></div>{/if}
          </div>
          <div class="media-details">
          {#if inline && selected.asset}
            <div class="media-meta">
              <label>Display name<input aria-label="Media display name" type="text" maxlength="120" bind:value={metaName} /></label>
              {#if selected.asset.type?.startsWith("image/")}<label>Alt text<textarea aria-label="Media alt text" rows="3" maxlength="1000" bind:value={metaAlt}></textarea></label>{/if}
              <label>Title<input aria-label="Media title" type="text" maxlength="200" bind:value={metaTitle} /></label>
              <label>Description<textarea aria-label="Media description" rows="3" maxlength="1000" bind:value={metaDescription}></textarea></label>
              <p class="hint">Author: {selected.asset.author || "Local user"}</p>
              {#if metaError}<p class="error" role="alert">{metaError}</p>{/if}
              {#if metaNotice}<p role="status">{metaNotice}</p>{/if}
            </div>
          {:else if selected.file}
            <p class="hint">{selected.file.name}</p>
          {:else if !selected.asset}
            <label>Image URL<input type="text" readonly value={selected.url} /></label>
          {/if}
          {#if !inline}<label>Alt text (describe the image; leave empty if decorative)<input type="text" bind:value={alt} /></label>{/if}
          {#if selected.stock?.credit}<p class="hint">{selected.stock.credit}</p>{/if}
          {#if needsImport}<p class="hint">Confirmation downloads this file into the repository media folder. Content still requires Save.</p>{/if}
          </div>
          <div class="media-actions" class:with-media-path={!!selected.asset}>
          {#if selected.asset}
            <a class="outlined media-download" href={selected.asset.url} download={assetFile(selected.asset.url)}>Download file</a>
            <pre class="media-path" role="region" aria-label="Media file path" tabindex="0"><code>{selected.asset.url}</code></pre>
          {/if}
          <div class="media-button-actions">
          {#if inline && selected.asset}
            <button type="button" class="outlined" disabled={picking || savingMeta} onclick={close}>Cancel</button>
            <button type="button" class="primary" disabled={picking || savingMeta} onclick={saveMetadata}>{savingMeta ? "Saving…" : "Save"}</button>
          {:else}
            <button type="button" class="outlined" disabled={picking} onclick={() => { selected = null; releaseFile(); }}>Back</button>
            {#if inline && tab === "library"}<button type="button" class="primary" onclick={close}>Done</button>{:else}<button type="button" class="primary" disabled={picking || (needsImport && !writable)} onclick={confirm}>{picking ? "Importing photo…" : !inline ? "Insert image" : selected.file && mediaMetadata(selected.file.name)?.category !== "Images" ? "Upload file" : "Import image"}</button>{/if}
          {/if}</div>
          </div>
        </div>
      {:else}
        <div class="tabs" aria-label="Image sources">
          {#each tabs.filter(t => !inline || (t !== "library" && t !== "unsplash")) as t}<button type="button" class:active={tab === t} aria-pressed={tab === t} disabled={picking} onclick={() => changeTab(t)}>{t}</button>{/each}
        </div>
        {#if inline}<p class="hint">Unsplash API photos require hotlinking and are available only when inserting images into content, not as repository uploads.</p>{/if}
        {#if tab === "library"}
          {@render libraryBrowser()}
        {:else if tab === "upload"}
          <p class="hint">Choose a local file, then preview and confirm. Nothing is uploaded until confirmation.</p>
          {#if writable}<label>{inline ? "Upload media (images, audio, video, documents, spreadsheets, archives; 10 MB)" : "Upload image (JPEG, PNG, WebP, GIF, AVIF; 10 MB)"}<input type="file" accept={mediaAccept(!inline)} onchange={e => upload(e.currentTarget.files?.[0])} /></label>{:else}<p role="status">Local uploads require the local dev server. This library is read-only.</p>{/if}
        {:else if tab === "url"}
          <label>Image URL<input type="url" bind:value={urlInput} placeholder="https://… or /images/photo.jpg" /></label>
          <button type="button" class="primary" onclick={run}>Use this URL</button>
        {:else}
          <p class="hint">{tab === "picsum" ? "Placeholder photos from Lorem Picsum (seed, not semantic search)." : tab === "unsplash" ? "Unsplash photos stay linked to Unsplash; selection records a download." : "Import selected photos into the media folder (local dev only)."}</p>
          <div class="search-row"><input aria-label="Search photos" type="search" bind:value={query} placeholder="Search photos…" onkeydown={e => e.key === "Enter" && run()} /><button type="button" class="primary" onclick={run} disabled={loading || picking}>{loading ? "…" : "Search"}</button></div>
          {#if searched && !results.length && !error}<p class="hint" role="status">No photos found. Try another search.</p>{/if}
          <div class="grid">
            {#each results as r (r.url)}
              <figure><button type="button" class="thumb" disabled={picking} onclick={() => selected = {url: r.url, stock: r}} data-tooltip={r.credit}><img src={r.thumb} alt={r.credit} loading="lazy" /></button><figcaption>{#if r.creditURL?.startsWith("https://")}<a href={r.creditURL} target="_blank" rel="noopener noreferrer">{r.credit}</a>{:else}{r.credit}{/if}</figcaption></figure>
            {/each}
          </div>
        {/if}
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  </dialog>
{/if}
