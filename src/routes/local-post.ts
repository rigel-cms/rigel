import type { APIRoute } from "astro";
import { writeFile, mkdir, rm, readFile, rename, link } from "node:fs/promises";
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

export const POST: APIRoute = async ({ request, params }) => {
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
    const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root)) : [];
    validateCollectionValues(fields, body.frontmatter, documents);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Invalid article", { status: 400 });
  }
  await mkdir(path.dirname(file), { recursive: true });
  const fm = { ...body.frontmatter, slug };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ frontmatter: fm, body: body.body }, null, 2) + "\n", { flag: "wx" });
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
