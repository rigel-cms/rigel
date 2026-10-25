export function safePreviewUrl(value: string, image = false): boolean {
  return !!value && !/[ \t\r\n\f\v\u0000-\u001f\u007f\\]/.test(value) && !value.startsWith("//") && (!/^[a-z][a-z\d+.-]*:/i.test(value) || (image ? /^https?:/i : /^(https?:|mailto:)/i).test(value));
}

export function previewRoute(value: unknown, template = false): string | null {
  if (typeof value !== "string" || !/^\/(?!\/)/.test(value) || /[\\\s?#\u0000-\u001f\u007f]/.test(value) || /%(?:2e|2f|5c)/i.test(value) || value.split("/").some(part => part === "." || part === "..")) return null;
  if (template && /[{}]/.test(value)) return null;
  return !/^\/rigel(?:\/|$)/.test(value) || (template && /^\/rigel\/preview(?:\/|$)/.test(value)) ? value : null;
}

export function previewBaseUrl(value: unknown): string {
  try {
    if (typeof value !== "string" || !/^https?:\/\/[^/@]+(?:\/|$)/.test(value) || /[\s\u0000-\u001f\u007f\\%?#]/.test(value) || value.split("/").some(part => part === "." || part === "..")) throw new Error();
    const url = new URL(value);
    if (url.username || url.password || (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) throw new Error();
    return `${url.origin}${url.pathname.replace(/\/$/, "")}/`;
  } catch { throw new Error("rigel: preview.liveUrl and preview.draftUrl must be absolute HTTPS base URLs without credentials, query or fragment (HTTP allowed on loopback)"); }
}
