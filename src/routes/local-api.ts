import type { APIRoute } from "astro";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { applyValues } from "./serialize";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (import.meta.env.PROD) {
    return new Response("Local backend is dev-only", { status: 404 });
  }

  let body: { slug?: string; values?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const slug = String(body.slug ?? "");
  const values = body.values ?? {};
  if (!slug) return new Response("Missing slug", { status: 400 });

  const file = path.resolve("src/content/copy", `${slug}.ts`);
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return new Response(`No copy module for ${slug}`, { status: 404 });
  }

  let next: string;
  try {
    next = applyValues(source, values);
  } catch {
    return new Response(`Could not locate values block in ${slug}.ts`, {
      status: 422,
    });
  }

  await writeFile(file, next, "utf8");
  return new Response(null, { status: 204 });
};