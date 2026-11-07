import { mediaMetadata } from "./media-types";
import { systemMessage, type Translator } from "./editor/i18n/format";
export const META_KEYS: Record<string, number> = { name: 120, title: 200, description: 1000, alt: 1000, author: 80 };
export interface MediaMeta { name?: string; title?: string; description?: string; alt?: string; author?: string; }
function sanitize(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max);
  return clean || undefined;
}

export function safeDisplayName(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 120
    && !value.startsWith(".") && /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(value);
}

export function validateMetaUpdate(
  body: unknown,
  existing: Set<string>,
  message: Translator = systemMessage,
): { ok: true; value: { url: string; name?: string; title?: string; description?: string; alt?: string } } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: message("local.invalidMetadataBody") };
  const b = body as Record<string, unknown>;
  const allowed = ["url", "name", "title", "description", "alt"];
  if (Object.keys(b).some(key => !allowed.includes(key))) return { ok: false, error: message("local.unknownMetadataField") };
  if (typeof b.url !== "string" || !existing.has(b.url)) return { ok: false, error: message("local.unknownAsset") };
  const value: { url: string; name?: string; title?: string; description?: string; alt?: string } = { url: b.url };
  if ("name" in b) {
    const candidate = typeof b.name === "string" ? b.name.trim() : b.name;
    if (!safeDisplayName(candidate)) return { ok: false, error: message("local.invalidDisplayName") };
    value.name = typeof candidate === "string" ? candidate : undefined;
  }
  if ("title" in b) {
    if (typeof b.title !== "string") return { ok: false, error: message("local.metadataTitleString") };
    value.title = sanitize(b.title, 200);
  }
  if ("description" in b) {
    if (typeof b.description !== "string") return { ok: false, error: message("local.metadataDescriptionString") };
    value.description = sanitize(b.description, 1000);
  }
  if ("alt" in b) {
    if (typeof b.alt !== "string") return { ok: false, error: message("local.metadataAltString") };
    if (!mediaMetadata(b.url)?.type.startsWith("image/")) return { ok: false, error: message("local.metadataAltImagesOnly") };
    value.alt = sanitize(b.alt.replace(/\s+/g, " "), 1000) ?? "";
  }
  return { ok: true, value };
}

