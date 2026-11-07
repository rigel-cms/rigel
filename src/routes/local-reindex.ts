import type { APIRoute } from "astro";
import { fileURLToPath } from "node:url";
import config from "virtual:rigel-config";
import { requestTranslator } from "../editor/i18n/server";
import { collectionWrite, rebuildCollectionLedger } from "../manifest/collection-ledger-store";
import { readDocuments } from "../schema/store";

export const prerender = false;
export const POST: APIRoute = ({ request }) => collectionWrite(async () => {
  if (import.meta.env.PROD || config.backend !== "local") return new Response("Local backend is dev-only", { status: 404 });
  const t = requestTranslator(request);
  try {
    const documents = config.schema && config.root ? await readDocuments(config.schema, fileURLToPath(config.root), config.preview, t) : [];
    const results = [];
    const name = new URL(request.url).searchParams.get("collection");
    const collections = (config.collections ?? []).filter(collection => !name || collection.name === name);
    if (name && !collections.length) return new Response(t("local.unknownCollectionSlug"), { status: 404 });
    for (const collection of collections) {
      request.signal.throwIfAborted();
      results.push({ name: collection.name, count: await rebuildCollectionLedger(collection, documents, t, request.signal) });
    }
    return Response.json(results);
  } catch (error) { return new Response(error instanceof Error ? error.message : t("local.invalidArticle"), { status: 409 }); }
});
