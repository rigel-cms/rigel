import type { APIRoute } from "astro";
import { requestTranslator } from "../editor/i18n/server";
import type { Translator } from "../editor/i18n/format";
import path from "node:path";
import { fileURLToPath } from "node:url";
import config from "virtual:rigel-config";
import { DocumentStoreError, readDocuments, writeDocument } from "../schema/store";
import { SchemaError, isPlainObject, validateDocument, validateDocumentId } from "../schema/validate";
import type { Schema } from "../schema/types";

export const prerender = false;

const MAX_BODY = 1024 * 1024;

function guard(): { schema: Schema; root: string } | Response {
  if (import.meta.env.PROD || config.backend !== "local" || !config.schema || !config.root)
    return new Response("Local documents are not enabled", { status: 404 });
  return { schema: config.schema as Schema, root: fileURLToPath(config.root) };
}

async function readBody(request: Request, t: Translator): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY) throw new DocumentStoreError(t("local.documentTooLarge"), 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY) throw new DocumentStoreError(t("local.documentTooLarge"), 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new DocumentStoreError("Invalid JSON", 400);
  }
  if (!isPlainObject(body) || !isPlainObject(body.data)) throw new DocumentStoreError(t("local.dataRequired"), 400);
  return body.data;
}

function decodeParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const GET: APIRoute = async ({ request, params }) => {
  const t = requestTranslator(request);
  const guarded = guard();
  if (guarded instanceof Response) return guarded;
  const id = decodeParam(String(params.id ?? ""));
  const target = validateDocumentId(guarded.schema, id);
  if (!target) return new Response(t("local.unknownDocument"), { status: 404 });
  try {
    const documents = await readDocuments(guarded.schema, guarded.root, config.preview, t);
    const document = documents.find((entry) => entry.id === id);
    if (!document) return new Response(t("local.unknownDocument"), { status: 404 });
    return Response.json(document);
  } catch (error) {
    if (error instanceof DocumentStoreError) return new Response(error.message, { status: error.status });
    return new Response(t("local.readDocumentFailed"), { status: 500 });
  }
};

const handle: APIRoute = async ({ request, params }) => {
  const t = requestTranslator(request);
  const guarded = guard();
  if (guarded instanceof Response) return guarded;
  if (request.method === "DELETE") return new Response(t("local.documentDeveloperOnly"), { status: 405, headers: { Allow: "GET, POST, PUT" } });
  if (request.headers.get("Origin") !== new URL(request.url).origin) return new Response("Same-origin request required", { status: 403 });
  const id = decodeParam(String(params.id ?? ""));
  const target = validateDocumentId(guarded.schema, id);
  if (!target) return new Response(t("local.unknownDocumentTarget"), { status: 400 });
  try {
    const data = await readBody(request, t);
    const documents = await readDocuments(guarded.schema, guarded.root, config.preview, t);
    const next = { ...data, _id: id, _type: target.type.name };
    validateDocument(guarded.schema, target.type.name, target.slug, next, documents, t);
    await writeDocument(guarded.schema, guarded.root, target.type.name, target.slug, next, request.method === "POST" ? "create" : "update", config.preview, config.jsonOutput, t);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof DocumentStoreError) return new Response(error.message, { status: error.status });
    if (error instanceof SchemaError) return new Response(error.message, { status: 400 });
    return new Response(t("local.saveDocumentFailed"), { status: 500 });
  }
};

export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
