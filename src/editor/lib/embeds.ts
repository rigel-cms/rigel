export type EmbedProvider = "youtube" | "vimeo";
export type EmbedRef = { provider: EmbedProvider; id: string };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{6,12}$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com", "youtube-nocookie.com", "www.youtube-nocookie.com"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

export function parseEmbedUrl(value: string): EmbedRef | undefined {
  const raw = value.trim();
  if (!/^https?:\/\//i.test(raw) || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return undefined;
  let url: URL;
  try { url = new URL(raw); } catch { return undefined; }
  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = host === "youtu.be" ? parts[0] : url.searchParams.get("v") ?? (["embed", "shorts", "live", "v"].includes(parts[0] ?? "") ? parts[1] : undefined);
    return candidate && YOUTUBE_ID.test(candidate) ? { provider: "youtube", id: candidate } : undefined;
  }
  if (VIMEO_HOSTS.has(host)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const candidate = parts[0] === "video" ? parts[1] : /^\d{6,12}$/.test(parts.at(-1) ?? "") ? parts.at(-1) : undefined;
    return candidate && VIMEO_ID.test(candidate) ? { provider: "vimeo", id: candidate } : undefined;
  }
  return undefined;
}

export function embedSrc(ref: EmbedRef, privacy = true): string {
  if (ref.provider === "youtube") return `https://www.${privacy ? "youtube-nocookie.com" : "youtube.com"}/embed/${ref.id}?rel=0`;
  return `https://player.vimeo.com/video/${ref.id}${privacy ? "?dnt=1" : ""}`;
}

export function embedWatchUrl(ref: EmbedRef): string {
  return ref.provider === "youtube" ? `https://www.youtube.com/watch?v=${ref.id}` : `https://vimeo.com/${ref.id}`;
}

export function embedProviderLabel(ref: EmbedRef): string {
  return ref.provider === "youtube" ? "YouTube" : "Vimeo";
}

export function safeEmbed(ref: unknown): EmbedRef | undefined {
  if (!ref || typeof ref !== "object") return undefined;
  const { provider, id } = ref as EmbedRef;
  if (provider === "youtube" && typeof id === "string" && YOUTUBE_ID.test(id)) return { provider, id };
  if (provider === "vimeo" && typeof id === "string" && VIMEO_ID.test(id)) return { provider, id };
  return undefined;
}
