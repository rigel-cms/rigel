import type { Manifest } from "./types";

export type Selection =
  | { kind: "media" }
  | { kind: "menus" }
  | { kind: "menu"; slug: string }
  | { kind: "pages"; category?: string }
  | { kind: "page"; slug: string }
  | { kind: "documents"; type: string }
  | { kind: "document"; type: string; id: string }
  | { kind: "collection"; name: string }
  | { kind: "post"; collection: string; slug: string };

export type SidebarTarget = Exclude<Selection, { kind: "post" } | { kind: "menu" }>;
export const SIDEBAR_ICONS = ["files", "file-text", "newspaper", "megaphone", "images", "squares-four", "list", "layout", "sidebar-simple", "magnifying-glass", "house", "users", "user", "gear", "globe", "folder", "folders", "book-open", "calendar", "tag", "heart", "shopping-bag", "chart-bar", "pencil-simple", "square-half"] as const;
export type SidebarIconName = typeof SIDEBAR_ICONS[number];
export function isSidebarIconPath(value: unknown): value is string {
  return typeof value === "string" && /^\/(?!\/)[\w./-]+\.svg$/i.test(value) && !value.split("/").some(part => part === "." || part === "..");
}
export type SidebarEntry =
  | { kind: "heading"; label: string }
  | { kind: "separator" }
  | { kind: "link"; target: SidebarTarget; label?: string; icon?: string };
export type SidebarLink = { kind: "link"; target: SidebarTarget; label: string; icon?: string };
export type SidebarNode = Exclude<SidebarEntry, { kind: "link" }> | SidebarLink;
export function navigationKey(target: Selection): string {
  return JSON.stringify([target.kind, "category" in target ? target.category : null, "name" in target ? target.name : null, "slug" in target ? target.slug : null, "type" in target ? target.type : null, "id" in target ? target.id : null, "collection" in target ? target.collection : null]);
}

export function buildSidebar(manifest: Manifest): SidebarNode[] {
  const link = (target: SidebarTarget, label: string): SidebarLink => ({ kind: "link", target, label });
  const types = manifest.schema?.documents ?? [];
  const pageTypes = types.filter(type => !type.shared);
  const pages = manifest.pages.filter(page => !page.shared);
  const categories = [...new Set(pages.map(page => page.category).filter((category): category is string => !!category))].sort();
  const defaults: SidebarNode[] = [
    { kind: "heading", label: "Website" },
    link({ kind: "pages" }, "Pages"),
    ...(manifest.collections ?? []).map(collection => link({ kind: "collection", name: collection.name }, collection.label)),
    ...categories.map(category => link({ kind: "pages", category }, category)),
    ...pageTypes.slice(1).map(type => link({ kind: "documents", type: type.name }, type.title)),
    { kind: "heading", label: "Shared content" },
    ...types.filter(type => type.shared && !type.singleton).map(type => link({ kind: "documents", type: type.name }, type.title)),
    ...manifest.pages.filter(page => page.shared).map(page => link({ kind: "page", slug: page.slug }, page.label)),
    ...(manifest.menus ? [link({ kind: "menus" }, "Menus")] : []),
    { kind: "heading", label: "Assets" },
    link({ kind: "media" }, "Media"),
    ...(types.some(type => type.shared && type.singleton) ? [{ kind: "separator" } as SidebarNode] : []),
    ...types.filter(type => type.shared && type.singleton).map(type => {
      const doc = manifest.documents?.find(doc => doc.type === type.name);
      return doc ? { ...link({ kind: "document", type: type.name, id: doc.id }, type.title), icon: "gear" } : link({ kind: "documents", type: type.name }, type.title);
    }),
  ];
  if (!manifest.sidebar) return defaults;
  const available = new Map(defaults.filter((node): node is SidebarLink => node.kind === "link").map(node => [navigationKey(node.target), node]));
  for (const page of manifest.pages) available.set(navigationKey({ kind: "page", slug: page.slug }), link({ kind: "page", slug: page.slug }, page.label));
  for (const doc of manifest.documents ?? []) {
    const target: SidebarTarget = { kind: "document", type: doc.type, id: doc.id };
    const key = navigationKey(target);
    if (!available.has(key)) available.set(key, link(target, String(doc.data.title ?? doc.data.name ?? doc.slug)));
  }
  const nodes: SidebarNode[] = [];
  const used = new Set<string>();
  for (const entry of manifest.sidebar) {
    if (entry.kind !== "link") { nodes.push(entry); continue; }
    const key = navigationKey(entry.target);
    const item = available.get(key);
    if (!item || used.has(key)) continue;
    used.add(key);
    nodes.push({ ...item, label: entry.label ?? item.label, ...(entry.icon ? { icon: entry.icon } : {}) });
  }
  const remaining = defaults.filter((node): node is SidebarLink => node.kind === "link" && !used.has(navigationKey(node.target)));
  if (remaining.length) nodes.push({ kind: "heading", label: "More content" }, ...remaining);
  return nodes;
}

export function validateSidebar(value: unknown): void {
  const fail = () => { throw new Error("rigel: sidebar requires headings, separators or links with valid content targets"); };
  if (!Array.isArray(value)) fail();
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== "object") fail();
    const item = entry as Record<string, unknown>;
    if (item.kind === "separator") continue;
    if (item.label !== undefined && (typeof item.label !== "string" || !item.label.trim())) fail();
    if (item.kind === "heading") { if (!item.label) fail(); continue; }
    if (item.kind !== "link" || !item.target || typeof item.target !== "object") fail();
    if (item.icon !== undefined && !SIDEBAR_ICONS.includes(item.icon as SidebarIconName) && !isSidebarIconPath(item.icon)) fail();
    const target = item.target as Record<string, unknown>;
    const fields: Record<string, string[]> = { media: [], menus: [], pages: [], page: ["slug"], collection: ["name"], documents: ["type"], document: ["type", "id"] };
    if (typeof target.kind !== "string" || !Object.hasOwn(fields, target.kind)) fail();
    for (const key of fields[target.kind as string]) if (typeof target[key] !== "string" || !String(target[key]).trim()) fail();
    if (target.category !== undefined && (target.kind !== "pages" || typeof target.category !== "string" || !target.category.trim())) fail();
  }
}
