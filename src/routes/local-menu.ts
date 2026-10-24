import type { APIRoute } from "astro";
import { serializeContentJson } from "../json-output";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseConfig } from "../config";
import { MENU_SLUG, validateMenu, type MenuDocument } from "../manifest/menu";
import config from "virtual:rigel-config";

export const prerender = false;

async function menuFile(slug: string): Promise<string> {
  const menus = parseConfig({ menus: config.menus }).menus!;
  if (!config.root) throw new Error("Missing site root");
  let directory = await realpath(fileURLToPath(config.root));
  for (const part of menus.folder.split("/")) {
    directory = path.join(directory, part);
    const info = await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory())
      throw new Error("Menu folder must contain only real directories");
  }
  const file = path.join(directory, `${slug}.json`);
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Menu must be a regular file");
  return file;
}

const handle: APIRoute = async ({ request, params }) => {
  if (import.meta.env.PROD || config.backend !== "local" || !config.menus)
    return new Response("Local menus are not enabled", { status: 404 });
  const slug = params.slug ?? "";
  if (!MENU_SLUG.test(slug)) return new Response("Invalid menu slug", { status: 400 });
  const method = request.method;
  if (method !== "GET" && method !== "PUT")
    return new Response("Menus are declared by the site developer. Only existing menus can be edited.", { status: 405, headers: { Allow: "GET, PUT" } });
  if (method !== "GET" && request.headers.get("Origin") !== new URL(request.url).origin)
    return new Response("Same-origin request required", { status: 403 });
  let menu: MenuDocument | undefined;
  if (method === "PUT") {
    try {
      menu = validateMenu(await request.json(), config.menus.maxDepth ?? 3);
      if (menu.slug !== slug) throw new Error("Menu slug must match the request slug");
    } catch (error) {
      return new Response(error instanceof SyntaxError ? "Invalid JSON" : (error as Error).message, { status: 400 });
    }
  }
  let temporary: string | undefined;
  try {
    const file = await menuFile(slug);
    if (method === "GET") {
      const input = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const result = validateMenu(JSON.parse(await input.readFile("utf8")), config.menus.maxDepth ?? 3);
        if (result.slug !== slug) throw new Error("Stored menu slug does not match filename");
        return Response.json(result);
      } finally { await input.close(); }
    }

    temporary = path.join(path.dirname(file), `.${slug}-${randomUUID()}.tmp`);
    const output = await open(temporary, "wx", 0o600);
    try {
      await output.writeFile(serializeContentJson(menu, config.jsonOutput), "utf8");
      await output.sync();
    } finally { await output.close(); }
    await menuFile(slug);
    await rename(temporary, file);
    return new Response(null, { status: 204 });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return new Response("No such menu", { status: 404 });
    return new Response("Could not access menu: invalid stored data or unsafe/unavailable storage", { status: 500 });
  } finally {
    if (temporary) await unlink(temporary).catch(() => {});
  }
};

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
