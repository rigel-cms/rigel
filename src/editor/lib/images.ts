import { getSettings, setSettings } from "./settings";
import { mediaMetadata, safeMediaName } from "../../media-types";
export function getKeys(): StockKeys { return getSettings().apiKeys; }
export function setKeys(keys: StockKeys) { setSettings({ apiKeys: keys }); }

export const STOCK_PROVIDERS = {
  pexels: { label: "Pexels", keyURL: "https://www.pexels.com/api/new/", pattern: "[a-zA-Z0-9]{56}", placeholder: "e.g. Ab3dE6fG9hJ2…" },
  pixabay: { label: "Pixabay", keyURL: "https://pixabay.com/api/docs/#api_key", pattern: "[0-9]+-[a-f0-9]{25}", placeholder: "e.g. 12345678-abcdef012345…" },
  unsplash: { label: "Unsplash", keyURL: "https://unsplash.com/oauth/applications", pattern: "[a-zA-Z0-9_-]{40,}", placeholder: "e.g. AbCdEf12_GhIjKl34…" },
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
  if (!r.ok) throw new Error(`Unsplash ${r.status}`);
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
  if (!r.ok) throw new Error(`Pexels ${r.status}`);
  const data = await r.json();
  return (data.photos ?? []).map((p: Record<string, any>) => ({
    source: "pexels",
    url: p.src?.large2x ?? p.src?.large ?? p.src?.original,
    thumb: p.src?.medium,
    credit: `${p.photographer ?? "?"} / Pexels`,
    creditURL: p.url,
  }));
}

export async function pixabay(query: string, key: string): Promise<StockResult[]> {
  const params = new URLSearchParams({ key, image_type: "photo", safesearch: "true", per_page: "24" });
  if (query) params.set("q", query);
  else params.set("editors_choice", "true");
  const r = await fetch(`https://pixabay.com/api/?${params}`);
  if (!r.ok) throw new Error(`Pixabay ${r.status}`);
  const data = await r.json();
  return (data.hits ?? []).map((p: Record<string, any>) => ({
    source: "pixabay",
    url: p.largeImageURL,
    thumb: p.webformatURL,
    credit: `${p.user ?? "?"} / Pixabay`,
    creditURL: p.pageURL,
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
    if (!keys.pixabay) throw new Error("Add a Pixabay API key in Settings → Media");
    return pixabay(query, keys.pixabay);
  }
  if (source === "unsplash") {
    if (!keys.unsplash) throw new Error("Add an Unsplash API key in Settings");
    return unsplash(query, keys.unsplash);
  }
  if (source === "pexels") {
    if (!keys.pexels) throw new Error("Add a Pexels API key in Settings → Media");
    return pexels(query, keys.pexels);
  }
  throw new Error("Unknown stock photo provider");
}

export async function importStockImage(image: StockResult): Promise<string> {
  const url = new URL(image.url);
  const hosts = {
    picsum: ["picsum.photos"], unsplash: ["images.unsplash.com"],
    pexels: ["images.pexels.com"], pixabay: ["pixabay.com", "cdn.pixabay.com"],
  };
  if (url.protocol !== "https:" || url.username || url.password || !hosts[image.source]?.includes(url.hostname)) {
    throw new Error("Unexpected stock photo URL");
  }
  if (image.source === "unsplash") {
    const key = getKeys().unsplash;
    if (!key || !image.id) throw new Error("Unsplash photo or API key is missing");
    const tracked = await fetch(`https://api.unsplash.com/photos/${encodeURIComponent(image.id)}/download`, {
      headers: { Authorization: "Client-" + "ID " + key },
    });
    if (!tracked.ok) throw new Error(`Unsplash download tracking failed (${tracked.status})`);
    return image.url;
  }
  return importImageUrl(image.url);
}

export async function importImageUrl(value: string): Promise<string> {
  if (!safeImageUrl(value)) throw new Error("Unsafe image URL");
  if (!value.startsWith("/") && new URL(value).protocol !== "https:") throw new Error("Remote imports require HTTPS");
  if (!value.startsWith("/") && new URL(value).hostname === "images.unsplash.com") throw new Error("Unsplash API images must stay hotlinked. Use Unsplash in the content image picker.");
  let response: Response;
  try { response = await fetch(value, { credentials: "omit", referrerPolicy: "no-referrer" }); }
  catch { throw new Error("Image download failed. The source must allow browser downloads (CORS); alternatively upload the image file."); }
  if (!response.ok) throw new Error(`Photo download failed (${response.status})`);
  const limit = 10 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > limit) throw new Error("Photo exceeds the 10 MB import limit");
  const type = response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type ?? "")) throw new Error("Choose a JPEG, PNG or WebP image.");
  if (!response.body) throw new Error("Empty image download");
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      size += chunk.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("Photo exceeds the 10 MB import limit"); }
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
  if (!safeMediaName(file.name) || !metadata || file.size > 10 * 1024 * 1024) throw new Error("Choose a supported file up to 10 MB with a safe filename.");
  const response = await fetch("/rigel/api/local/media", { method: "POST", headers: { "Content-Type": metadata.type, "X-Rigel-Filename": file.name, "X-Rigel-Author": currentAuthor() }, body: file });
  if (!response.ok) throw new Error(`Upload failed (${response.status}): ${await response.text()}`);
  const result = await response.json();
  if (typeof result.url !== "string" || !safeImageUrl(result.url) || !result.url.startsWith("/") || !/\/[a-f0-9]{64}\.[a-z0-9]+$/.test(result.url) || !mediaMetadata(result.url)) throw new Error("Invalid uploaded asset URL");
  return result.url;
}

export async function uploadImage(blob: Blob): Promise<string> {
  if (blob.size > 10 * 1024 * 1024) throw new Error("Photo exceeds the 10 MB import limit");
  const saved = await fetch("/rigel/api/local/media", { method: "POST", body: blob });
  if (saved.status === 404) throw new Error("Photo import requires the local dev server");
  if (!saved.ok) throw new Error(`Photo import failed (${saved.status})`);
  const result = await saved.json();
  if (typeof result.url !== "string" || !safeImageUrl(result.url) || !result.url.startsWith("/") || !/\/[a-f0-9]{64}\.(jpg|png|webp)$/.test(result.url)) {
    throw new Error("Invalid imported photo URL");
  }
  return result.url;
}
