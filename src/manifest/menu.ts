import { systemMessage, type Translator } from "../editor/i18n/format";

export interface MenuItem {
  id: string;
  label: string;
  url: string;
  newTab?: boolean;
  children: MenuItem[];
}

export interface MenuDocument {
  slug: string;
  title: string;
  items: MenuItem[];
}

export const MENU_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateMenu(value: unknown, maxDepth: number, message: Translator = systemMessage): MenuDocument {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10)
    throw new Error(message("validation.menu.maxDepth"));
  const object = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  if (!object(value) || typeof value.slug !== "string" || !MENU_SLUG.test(value.slug) || !text(value.title) || !Array.isArray(value.items))
    throw new Error(message("validation.menu.required"));
  const ids = new Set<string>();
  function items(values: unknown[], depth: number): MenuItem[] {
    return values.map((item) => {
      if (depth > maxDepth) throw new Error(message("validation.menu.depth", { maxDepth }));
      if (!object(item) || !text(item.id) || !text(item.label) || !text(item.url) || !Array.isArray(item.children))
        throw new Error(message("validation.menu.itemRequired"));
      if (ids.has(item.id)) throw new Error(message("validation.menu.duplicateId", { id: item.id }));
      ids.add(item.id);
      if (item.newTab !== undefined && typeof item.newTab !== "boolean") throw new Error(message("validation.menu.newTab"));
      const url = item.url;
      if (url !== url.trim() || /[\u0000-\u0020\u007f\\]/.test(url) || url.startsWith("//"))
        throw new Error(message("validation.menu.unsafeUrl"));
      let parsed: URL;
      try { parsed = new URL(url, "https://rigel.invalid/"); }
      catch { throw new Error(message("validation.menu.invalidUrl")); }
      if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol))
        throw new Error(message("validation.menu.unsafeProtocol"));
      return { id: item.id, label: item.label, url, ...(item.newTab === undefined ? {} : { newTab: item.newTab }), children: items(item.children, depth + 1) };
    });
  }
  return { slug: value.slug, title: value.title, items: items(value.items, 1) };
}
