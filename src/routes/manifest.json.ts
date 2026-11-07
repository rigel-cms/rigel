import type { APIRoute } from "astro";
import manifest from "virtual:rigel-manifest";

export const GET: APIRoute = async () => {
  const editorManifest = manifest.backend === "github" ? {
    ...manifest,
    pages: manifest.pages.map(page => ({ ...page, values: {} })),
    collections: manifest.collections?.map(collection => ({ ...collection, posts: [] })),
    documents: [],
    ...(manifest.menus ? { menus: { ...manifest.menus, entries: [] } } : {}),
  } : manifest.backend === "demo" ? manifest : {
    ...manifest,
    collections: manifest.collections?.map(collection => ({ ...collection, posts: collection.posts.map(({ slug, frontmatter }) => ({ slug, frontmatter })) })),
  };
  return new Response(JSON.stringify(editorManifest), {
    headers: { "Content-Type": "application/json" },
  });
};