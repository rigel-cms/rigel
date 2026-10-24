import type { APIRoute } from "astro";
import { serializeContentJson } from "../json-output";
import { writeFile, mkdir, rm, readFile, readdir, rename, link } from "node:fs/promises";
import { assertUniqueUrlSlugs, normalizeUrlSlug } from "../slugs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { validateBody, type ArticleBody } from "../article-body";
import config from "virtual:rigel-config";
import { validateCollectionValues } from "../manifest/collections";
import { readDocuments } from "../schema/store";
import { fileURLToPath } from "node:url";
import type { CollectionConfig } from "../config";

export const prerender = false;

function collectionFolder(name: string): string | null {
  const col = (config.collections ?? []).find(
    (c: { name: string }) => c.name === name,
  );
  return col ? col.folder : null;
}

function safeSlug(slug: string): string | null {
  return /^[a-z0-9][a-z0-9_-]*$/.test(slug) ? slug : null;
}

let writes: Promise<unknown> = Promise.resolve();
export const POST: APIRoute = (context) => {
  const result = writes.then(() => savePost(context));
  writes = result.catch(() => {});
  return result;
};

const savePost: APIRoute = async ({ request, params }) => {
  if (import.meta.env.PROD) {
    return new Response("Local backend is dev-only", { status: 404 });
  }
  const folder = collectionFolder(String(params.collection ?? ""));
  const slug = safeSlug(String(params.slug ?? ""));
  if (!folder || !slug) {
    return new Response("Unknown collection/slug", { status: 404 });
  }

  let body: { frontmatter: Record<string, unknown>; body: ArticleBody };
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || !body.frontmatter || typeof body.frontmatter !== "object" || Array.isArray(body.frontmatter)) throw new Error("Invalid article");
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const file = path.resolve(folder, `${slug}.json`);
  try {
    validateBody(body.body);
    const fields = config.collections?.find((collection: CollectionConfig) => collection.name === params.collection)?.fields ?? [];
    const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root), config.preview) : [];
    validateCollectionValues(fields, body.frontmatter, documents);
    if (Object.hasOwn(body.frontmatter, "slug")) body.frontmatter.slug = normalizeUrlSlug(body.frontmatter.slug);
    const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const entries = await Promise.all(names.filter(name => name.endsWith(".json") && name !== `${slug}.json`).map(async name => ({ slug: name.slice(0, -5), values: JSON.parse(await readFile(path.join(folder, name), "utf8")).frontmatter })));
    assertUniqueUrlSlugs([...entries, { slug, values: body.frontmatter }]);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Invalid article", { status: 400 });
  }
  await mkdir(path.dirname(file), { recursive: true });
  const fm = { ...body.frontmatter };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializeContentJson({ frontmatter: fm, body: body.body }, config.jsonOutput), { flag: "wx" });
    if (request.headers.get("If-None-Match") === "*") {
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return new Response("A post with that slug already exists. Reload the collection and create the draft again.", { status: 409 });
        throw error;
      }
    } else await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  return new Response(null, { status: 204 });
};

export const DELETE: APIRoute = async ({ params }) => {
  if (import.meta.env.PROD) {
    return new Response("Local backend is dev-only", { status: 404 });
  }
  const folder = collectionFolder(String(params.collection ?? ""));
  const slug = safeSlug(String(params.slug ?? ""));
  if (!folder || !slug) {
    return new Response("Unknown collection/slug", { status: 404 });
  }
  const file = path.resolve(folder, `${slug}.json`);
  try {
    await readFile(file); // only delete existing files
  } catch {
    return new Response("No such post", { status: 404 });
  }
  await rm(file);
  return new Response(null, { status: 204 });
};
