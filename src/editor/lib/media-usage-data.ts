import type { Manifest } from "../../manifest/types";
import { mediaDeletion, mediaUsage } from "../../manifest/media-usage";
import { readLocalArticle } from "./local-articles";

async function snapshot(manifest: Manifest) {
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

export async function mediaUsageSnapshot(manifest: Manifest, url: string) {
  const { copy, error } = await snapshot(manifest);
  return { ...mediaUsage(copy, url), error };
}

export async function mediaDeletionSnapshot(manifest: Manifest, url: string) {
  const { copy, error } = await snapshot(manifest);
  return { ...mediaDeletion(copy, url), error };
}
