import type { Manifest } from "../../manifest/types";
import { mediaDeletion, mediaUsage } from "../../manifest/media-usage";
import { readLocalArticle } from "./local-articles";
import { readMediaContent } from "./media-backend";

async function snapshot(manifest: Manifest, signal?: AbortSignal) {
  if (manifest.backend === "github") {
    try {
      const result = await readMediaContent(manifest, signal);
      return { copy: result.copy, error: !!result.error };
    } catch { return { copy: { ...manifest, pages: [], documents: [], collections: [], menus: undefined }, error: true }; }
  }
  const copy: Manifest = { ...manifest, collections: manifest.collections?.map(collection => ({ ...collection, posts: collection.posts.map(post => ({ ...post })) })) };
  let error = false;
  try {
    if (!manifest.backend) for (const collection of copy.collections ?? []) for (const post of collection.posts) {
      const article = await readLocalArticle(collection.name, post.slug);
      post.frontmatter = article.frontmatter; post.body = article.body;
    }
  } catch { error = true; }
  return { copy, error };
}

export async function mediaUsageSnapshot(manifest: Manifest, url: string, signal?: AbortSignal) {
  const { copy, error } = await snapshot(manifest, signal);
  return { ...mediaUsage(copy, url, !error), error };
}

export async function mediaDeletionSnapshot(manifest: Manifest, url: string, signal?: AbortSignal) {
  const { copy, error } = await snapshot(manifest, signal);
  return { ...mediaDeletion(copy, url, !error), error };
}
