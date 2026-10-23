import type { CopyPage, Manifest } from "./types";

export function loadManifest(modules: CopyPage[]): Manifest {
  const pages = [...modules].sort((a, b) => a.slug.localeCompare(b.slug));
  for (const page of pages) {
    if (!page.slug || !page.groups?.length)
      throw new Error(`Copy module ${page.label || "?"} missing slug or groups`);
    for (const group of page.groups) {
      if (!group.id || !group.fields?.length)
        throw new Error(`Group ${group.id || "?"} in ${page.slug} missing id or fields`);
    }
  }
  return { pages };
}