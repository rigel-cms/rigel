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

export function validateMenu(value: unknown, maxDepth: number): MenuDocument {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10)
    throw new Error("Menu maxDepth must be an integer from 1 to 10");
  const object = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);
  const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  if (!object(value) || typeof value.slug !== "string" || !MENU_SLUG.test(value.slug) || !text(value.title) || !Array.isArray(value.items))
    throw new Error("Menu requires a lowercase alphanumeric-hyphen slug, title, and items array");
  const ids = new Set<string>();
  function items(values: unknown[], depth: number): MenuItem[] {
    return values.map((item) => {
      if (depth > maxDepth) throw new Error(`Menu exceeds maximum depth ${maxDepth}`);
      if (!object(item) || !text(item.id) || !text(item.label) || !text(item.url) || !Array.isArray(item.children))
        throw new Error("Menu items require nonempty id, label, url, and children array");
      if (ids.has(item.id)) throw new Error(`Duplicate menu item id: ${item.id}`);
      ids.add(item.id);
      if (item.newTab !== undefined && typeof item.newTab !== "boolean") throw new Error("Menu item newTab must be a boolean");
      const url = item.url;
      if (url !== url.trim() || /[\u0000-\u0020\u007f\\]/.test(url) || url.startsWith("//"))
        throw new Error("Unsafe menu URL");
      let parsed: URL;
      try { parsed = new URL(url, "https://rigel.invalid/"); }
      catch { throw new Error("Invalid menu URL"); }
      if (!["http:", "https:", "mailto:", "tel:"].includes(parsed.protocol))
        throw new Error("Unsafe menu URL protocol");
      return { id: item.id, label: item.label, url, ...(item.newTab === undefined ? {} : { newTab: item.newTab }), children: items(item.children, depth + 1) };
    });
  }
  return { slug: value.slug, title: value.title, items: items(value.items, 1) };
}
