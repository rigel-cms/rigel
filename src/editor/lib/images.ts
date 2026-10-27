import { getSettings, setSettings } from "./settings";
import { translate, locale } from "../i18n";
import { get } from "svelte/store";
import { DEFAULT_MAX_FILE_SIZE, mediaMetadata, safeMediaName, storedMediaFile } from "../../media-types";
import config from "virtual:rigel-config";
export function getKeys(): StockKeys { return getSettings().apiKeys; }
export function setKeys(keys: StockKeys) { setSettings({ apiKeys: keys }); }

export const STOCK_PROVIDERS = {
  pexels: { label: "Pexels", keyURL: "https://www.pexels.com/api/new/", pattern: "[a-zA-Z0-9]{56}", get placeholder() { return translate("media.pexelsKeyPlaceholder"); } },
  pixabay: { label: "Pixabay", keyURL: "https://pixabay.com/api/docs/#api_key", pattern: "[0-9]+-[a-f0-9]{25}", get placeholder() { return translate("media.pixabayKeyPlaceholder"); } },
  unsplash: { label: "Unsplash", keyURL: "https://unsplash.com/oauth/applications", pattern: "[a-zA-Z0-9_-]{40,}", get placeholder() { return translate("media.unsplashKeyPlaceholder"); } },
} as const;

export type StockSource = "picsum" | keyof typeof STOCK_PROVIDERS;
export type StockKeys = Partial<Record<keyof typeof STOCK_PROVIDERS, string>>;

export interface StockResult {
  source: StockSource;
  id?: string;
  url: string;
  thumb: string;
  credit: string;
  creditURL?: string;
  title?: string;
  description?: string;
  alt?: string;
}

export function picsum(query: string): StockResult[] {
  const seed = (query || "rigel").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return Array.from({ length: 8 }, (_, i) => {
    const s = `${seed}-${i}`;
    return {
      source: "picsum",
      url: `https://picsum.photos/seed/${s}/1200/800`,
      thumb: `https://picsum.photos/seed/${s}/300/200`,
      credit: `Lorem Picsum · seed ${s}`,
    };
  });
}

export async function unsplash(query: string, key: string): Promise<StockResult[]> {
  const r = await fetch(
    query ? `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=24` : "https://api.unsplash.com/photos?per_page=24",
    { headers: { Authorization: `Client-ID ${key}` } },
  );
  if (!r.ok) throw new Error(translate("media.providerStatus", { provider: "Unsplash", status: r.status }));
  const data = await r.json();
  return (query ? data.results ?? [] : data).map((p: Record<string, any>) => ({
    source: "unsplash",
    id: String(p.id),
    url: p.urls?.regular ?? p.urls?.full,
    thumb: p.urls?.small,
    credit: `${p.user?.name ?? "?"} / Unsplash`,
    creditURL: `https://unsplash.com/photos/${encodeURIComponent(p.id)}?utm_source=rigel-cms&utm_medium=referral`,
  }));
}

export async function pexels(query: string, key: string): Promise<StockResult[]> {
  const r = await fetch(
    query ? `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=24` : "https://api.pexels.com/v1/curated?per_page=24",
    { headers: { Authorization: key } },
  );
  if (!r.ok) throw new Error(translate("media.providerStatus", { provider: "Pexels", status: r.status }));
  const data = await r.json();
  return (data.photos ?? []).map((p: Record<string, any>) => ({
    source: "pexels",
    url: p.src?.large2x ?? p.src?.large ?? p.src?.original,
    thumb: p.src?.medium,
    credit: `${p.photographer ?? "?"} / Pexels`,
    creditURL: p.url,
    title: typeof p.alt === "string" ? p.alt : "",
    description: typeof p.alt === "string" ? p.alt : "",
    alt: typeof p.alt === "string" ? p.alt : "",
  }));
}

export async function pixabay(query: string, key: string): Promise<StockResult[]> {
  const params = new URLSearchParams({ key, image_type: "photo", safesearch: "true", per_page: "24" });
  if (query) params.set("q", query);
  else params.set("editors_choice", "true");
  const r = await fetch(`https://pixabay.com/api/?${params}`);
  if (!r.ok) throw new Error(translate("media.providerStatus", { provider: "Pixabay", status: r.status }));
  const data = await r.json();
  return (data.hits ?? []).map((p: Record<string, any>) => ({
    source: "pixabay",
    url: p.largeImageURL,
    thumb: p.webformatURL,
    credit: `${p.user ?? "?"} / Pixabay`,
    creditURL: p.pageURL,
    title: typeof p.tags === "string" ? p.tags : "",
    description: typeof p.tags === "string" ? p.tags : "",
    alt: typeof p.tags === "string" ? p.tags : "",
  }));
}

export async function searchImages(
  source: StockSource,
  query: string,
): Promise<StockResult[]> {
  query = query.trim();
  if (source === "picsum") return picsum(query);
  const keys = getKeys();
  if (source === "pixabay") {
    if (!keys.pixabay) throw new Error(translate("media.pixabayKeyRequired"));
    return pixabay(query, keys.pixabay);
  }
  if (source === "unsplash") {
    if (!keys.unsplash) throw new Error(translate("media.unsplashKeyRequired"));
    return unsplash(query, keys.unsplash);
  }
  if (source === "pexels") {
    if (!keys.pexels) throw new Error(translate("media.pexelsKeyRequired"));
    return pexels(query, keys.pexels);
  }
  throw new Error(translate("media.unknownStockProvider"));
}

export async function importStockImage(image: StockResult): Promise<string> {
  const url = new URL(image.url);
  const hosts = {
    picsum: ["picsum.photos"], unsplash: ["images.unsplash.com"],
    pexels: ["images.pexels.com"], pixabay: ["pixabay.com", "cdn.pixabay.com"],
  };
  if (url.protocol !== "https:" || url.username || url.password || !hosts[image.source]?.includes(url.hostname)) {
    throw new Error(translate("media.unexpectedStockUrl"));
  }
  if (image.source === "unsplash") {
    const key = getKeys().unsplash;
    if (!key || !image.id) throw new Error(translate("media.unsplashPhotoMissing"));
    const tracked = await fetch(`https://api.unsplash.com/photos/${encodeURIComponent(image.id)}/download`, {
      headers: { Authorization: "Client-" + "ID " + key },
    });
    if (!tracked.ok) throw new Error(translate("media.unsplashTrackingFailed", { status: tracked.status }));
    return image.url;
  }
  return importImageUrl(image.url);
}

export async function importImageUrl(value: string): Promise<string> {
  if (!safeImageUrl(value)) throw new Error(translate("media.unsafeImageUrl"));
  if (!value.startsWith("/") && new URL(value).protocol !== "https:") throw new Error(translate("media.remoteRequiresHttps"));
  if (!value.startsWith("/") && new URL(value).hostname === "images.unsplash.com") throw new Error(translate("media.unsplashHotlinkRequired"));
  let response: Response;
  try { response = await fetch(value, { credentials: "omit", referrerPolicy: "no-referrer" }); }
  catch { throw new Error(translate("media.imageDownloadFailed")); }
  if (!response.ok) throw new Error(translate("media.photoDownloadFailed", { status: response.status }));
  const limit = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (Number(response.headers.get("Content-Length")) > limit) throw new Error(translate("media.photoLimitExceeded", { limit: limit / 1024 / 1024 }));
  const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type ?? "")) throw new Error(translate("media.chooseImageFormat"));
  if (!response.body) throw new Error(translate("media.emptyDownload"));
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error(translate("media.photoLimitExceeded", { limit: limit / 1024 / 1024 })); }
      chunks.push(new Uint8Array(chunk));
    }
  } finally { reader.releaseLock(); }
  return uploadImage(new Blob(chunks, { type }));
}

export function safeImageUrl(value: string): boolean {
  if (!value || /[\s\u0000-\u001f\u007f\\]/.test(value) || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://rigel.invalid");
    return (value.startsWith("/") || /^https?:\/\//i.test(value)) && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function currentAuthor(): string {
  try {
    const raw = localStorage.getItem("rigelcms.user");
    if (!raw) return "Local user";
    const parsed = JSON.parse(raw);
    const name = typeof parsed?.name === "string" ? parsed.name : typeof parsed?.nickname === "string" ? parsed.nickname : "";
    return name.trim() || "Local user";
  } catch { return "Local user"; }
}

export async function uploadMedia(file: File): Promise<string> {
  const metadata = mediaMetadata(file.name);
  const limit = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (!safeMediaName(file.name) || !metadata || file.size > limit) throw new Error(translate("media.chooseSupportedFile", { limit: limit / 1024 / 1024 }));
  const response = await fetch("/rigel/api/local/media", { method: "POST", headers: { "Content-Type": metadata.type, "Accept-Language": get(locale), "X-Rigel-Filename": file.name, "X-Rigel-Author": currentAuthor() }, body: file });
  if (!response.ok) throw new Error(translate("media.uploadFailed", { status: response.status, body: await response.text() }));
  const result = await response.json();
  if (typeof result.url !== "string" || !safeImageUrl(result.url) || !result.url.startsWith("/") || !storedMediaFile.test(result.url.split("/").pop() ?? "") || !mediaMetadata(result.url)) throw new Error(translate("media.invalidUploadedUrl"));
  return result.url;
}

export async function uploadImage(blob: Blob): Promise<string> {
  const limit = config.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  if (blob.size > limit) throw new Error(translate("media.photoLimitExceeded", { limit: limit / 1024 / 1024 }));
  const saved = await fetch("/rigel/api/local/media", { method: "POST", headers: { "Accept-Language": get(locale) }, body: blob });
  if (saved.status === 404) throw new Error(translate("media.localImportRequired"));
  if (!saved.ok) throw new Error(translate("media.photoImportFailedStatus", { status: saved.status }));
  const result = await saved.json();
  if (typeof result.url !== "string" || !safeImageUrl(result.url) || !result.url.startsWith("/") || !storedMediaFile.test(result.url.split("/").pop() ?? "") || !/\.(jpg|png|webp)$/.test(result.url)) {
    throw new Error(translate("media.invalidImportedUrl"));
  }
  return result.url;
}
