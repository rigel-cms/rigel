import type { Manifest } from "./types";

export function pageCategories(manifest: Manifest): string[] {
  return [...new Set([...manifest.pages, ...(manifest.schema?.documents ?? [])].filter(entry => !entry.shared).map(entry => entry.category).filter((category): category is string => !!category))].sort();
}

export function pageTemplates(manifest: Manifest) {
  return (manifest.schema?.documents ?? []).filter(type => !type.shared && !type.singleton && type.creatable !== false);
}

export function defaultPageCategory(manifest: Manifest): "" | null {
  return [...manifest.pages, ...(manifest.schema?.documents ?? [])].some(entry => !entry.shared && entry.category === undefined) ? "" : null;
}

export function inPageCategory(category: string | undefined, filter: string | null): boolean {
  return filter === null || (category ?? "") === filter;
}
