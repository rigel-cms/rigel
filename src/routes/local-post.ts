import type { APIRoute } from "astro";
import { requestTranslator } from "../editor/i18n/server";
import { serializeContentJson } from "../json-output";
import { writeFile, mkdir, rm, readFile, readdir, rename, link } from "node:fs/promises";
import { assertUniqueUrlSlugs, normalizeUrlSlug } from "../slugs";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { validateBody, type ArticleBody } from "../article-body";
import config from "virtual:rigel-config";
import extensions from "virtual:rigel-extensions";
import { resolveExtensions, validateExtensionBlocks } from "../extensions";
import { validateCollectionValues } from "../manifest/collections";
import { COLLECTION_LEDGER } from "../manifest/collection-ledger";
import { collectionWrite, rebuildCollectionLedger, safeCollectionFile } from "../manifest/collection-ledger-store";
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

export const POST: APIRoute = (context) => collectionWrite(async () => savePost(context));

export const GET: APIRoute = async ({ request, params }) => {
  const t = requestTranslator(request);
  if (import.meta.env.PROD || config.backend !== "local") return new Response("Local backend is dev-only", { status: 404 });
  const folder = collectionFolder(String(params.collection ?? "")), slug = safeSlug(String(params.slug ?? ""));
  if (!folder || !slug) return new Response(t("local.unknownCollectionSlug"), { status: 404 });
  try {
    const text = await readFile(await safeCollectionFile(folder, `${slug}.json`, t), "utf8"), post = JSON.parse(text);
    validateBody(post.body, t);
    return new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch { return new Response(t("local.postNotFound"), { status: 404 }); }
};

const savePost: APIRoute = async ({ request, params }) => {
  const t = requestTranslator(request);
  if (import.meta.env.PROD || config.backend !== "local") {
    return new Response("Local backend is dev-only", { status: 404 });
  }
  const folder = collectionFolder(String(params.collection ?? ""));
  const slug = safeSlug(String(params.slug ?? ""));
  if (!folder || !slug) {
    return new Response(t("local.unknownCollectionSlug"), { status: 404 });
  }

  let body: { frontmatter: Record<string, unknown>; body: ArticleBody };
  try {
    body = await request.json();
    if (!body || typeof body !== "object" || !body.frontmatter || typeof body.frontmatter !== "object" || Array.isArray(body.frontmatter)) throw new Error(t("local.invalidArticle"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const file = path.resolve(folder, `${slug}.json`);
  try {
    validateBody(body.body, t);
    validateExtensionBlocks(body.body, resolveExtensions(extensions).blocks);
    const fields = config.collections?.find((collection: CollectionConfig) => collection.name === params.collection)?.fields ?? [];
    const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root), config.preview, t) : [];
    validateCollectionValues(fields, body.frontmatter, documents, t);
    if (Object.hasOwn(body.frontmatter, "slug")) body.frontmatter.slug = normalizeUrlSlug(body.frontmatter.slug, t);
    const names = await readdir(folder).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const entries = await Promise.all(names.filter(name => name.endsWith(".json") && name !== COLLECTION_LEDGER && name !== `${slug}.json`).map(async name => {
      const data = JSON.parse(await readFile(await safeCollectionFile(folder, name, t), "utf8"));
      validateBody(data.body, t); validateCollectionValues(fields, data.frontmatter, documents, t);
      return { slug: name.slice(0, -5), values: data.frontmatter };
    }));
    assertUniqueUrlSlugs([...entries, { slug, values: body.frontmatter }], t);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : t("local.invalidArticle"), { status: 400 });
  }
  await mkdir(path.dirname(file), { recursive: true });
  await safeCollectionFile(folder, `${slug}.json`, t);
  await safeCollectionFile(folder, COLLECTION_LEDGER, t);
  const fm = { ...body.frontmatter };
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, serializeContentJson({ frontmatter: fm, body: body.body }, config.jsonOutput), { flag: "wx" });
    if (request.headers.get("If-None-Match") === "*") {
      try { await link(temporary, file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") return new Response(t("local.postExists"), { status: 409 });
        throw error;
      }
    } else await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
  const collection = config.collections!.find(c => c.name === params.collection)!;
  const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root), config.preview, t) : [];
  await rebuildCollectionLedger(collection, documents, t);
  return new Response(null, { status: 204 });
};

export const DELETE: APIRoute = (context) => collectionWrite(async () => deletePost(context));
const deletePost: APIRoute = async ({ request, params }) => {
  const t = requestTranslator(request);
  if (import.meta.env.PROD || config.backend !== "local") {
    return new Response("Local backend is dev-only", { status: 404 });
  }
  const folder = collectionFolder(String(params.collection ?? ""));
  const slug = safeSlug(String(params.slug ?? ""));
  if (!folder || !slug) {
    return new Response(t("local.unknownCollectionSlug"), { status: 404 });
  }
  const file = path.resolve(folder, `${slug}.json`);
  try {
    await readFile(await safeCollectionFile(folder, `${slug}.json`, t));
    await safeCollectionFile(folder, COLLECTION_LEDGER, t);
  } catch {
    return new Response(t("local.postNotFound"), { status: 404 });
  }
  await rm(file);
  const collection = config.collections!.find(c => c.name === params.collection)!;
  const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root), config.preview, t) : [];
  await rebuildCollectionLedger(collection, documents, t);
  return new Response(null, { status: 204 });
};
