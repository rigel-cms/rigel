import type { AstroIntegration } from "astro";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { mediaHeaders, safeMediaName, storedMediaFile } from "./media-types";
import { mediaDirectory } from "./routes/media-files";
import { parseConfig, type RigelConfig } from "./config";
import { rigelManifestPlugin } from "./vite/manifest-plugin";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export function rigel(options: Partial<RigelConfig> = {}): AstroIntegration {
  let cfg: RigelConfig;
  return {
    name: "rigel",
    hooks: {
      "astro:config:setup": ({ injectRoute, injectScript, updateConfig, command, config }) => {
        cfg = parseConfig(options);
        if (cfg.menus && command === "dev") injectScript("page", `if (import.meta.hot) import.meta.hot.on("rigel:menus-updated", () => { if (!/^\\/rigel(?:\\/|$)/.test(location.pathname)) location.reload(); });`);
        if (cfg.schema && command === "dev") injectScript("page", `if (import.meta.hot) import.meta.hot.on("rigel:content-updated", () => { if (!/^\\/rigel(?:\\/|$)/.test(location.pathname)) location.reload(); });`);
        if (cfg.collections?.length && command === "dev") injectScript("page", `if (import.meta.hot) import.meta.hot.on("rigel:collections-updated", () => { if (!/^\\/rigel(?:\\/|$)/.test(location.pathname)) location.reload(); });`);


        updateConfig({
          vite: {
            plugins: [rigelManifestPlugin(cfg, config.publicDir, config.root), svelte(), {
              name: "rigel-svelte-environment",
              enforce: "pre",
              configEnvironment(name) {
                if (name !== "client") return { optimizeDeps: { exclude: ["svelte"] } };
              },
            }, {
              name: "rigel-media-headers",
              configureServer(server) {
                const prefix = `/${cfg.mediaDir ?? "rigel-media"}/`;
                server.middlewares.use(async (request, response, next) => {
                  let pathname: string;
                  try { pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname); } catch { return next(); }
                  if (!pathname.startsWith(prefix)) return next();
                  try {
                    const parts = pathname.slice(prefix.length).split("/");
                    const filename = parts.pop()!;
                    if (!safeMediaName(filename) || !parts.every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(part))) throw new Error();
                    let directory = await mediaDirectory(config.publicDir.href, cfg.mediaDir);
                    for (const part of parts) {
                      directory = path.join(directory, part);
                      const info = await lstat(directory);
                      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
                    }
                    const file = path.join(directory, filename), info = await lstat(file);
                    if (!info.isFile() || info.isSymbolicLink()) throw new Error();
                    for (const [name, value] of Object.entries(mediaHeaders(filename, new URL(request.url ?? "/", "http://localhost").searchParams.get("preview") === "1"))) response.setHeader(name, value);
                    response.end(request.method === "HEAD" ? undefined : await readFile(file));
                  } catch { response.statusCode = 404; response.end("Not found"); }
                });
              },
            }],
            ...(cfg.backend === "local" && command === "dev" ? {
              server: { watch: { ignored: [(file: string) =>
                path.dirname(file) === path.resolve(fileURLToPath(config.publicDir), cfg.mediaDir ?? "rigel-media")
                && storedMediaFile.test(path.basename(file))
              ] } },
            } : {}),
          },
        });

        injectRoute({
          pattern: "/rigel",
          entrypoint: "@rigel-cms/rigel/routes/rigel-page.astro",
          prerender: true,
        });
        injectRoute({
          pattern: "/rigel/manifest.json",
          entrypoint: "@rigel-cms/rigel/routes/manifest.json.ts",
          prerender: true,
        });
        injectRoute({ pattern: "/rigel/media.json", entrypoint: "@rigel-cms/rigel/routes/media.json.ts", prerender: true });
        if (cfg.backend === "local" && command === "dev") {
          injectRoute({
            pattern: `/${cfg.mediaDir ?? "rigel-media"}/[filename]`,
            entrypoint: "@rigel-cms/rigel/routes/local-media.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/rigel/api/local/media",
            entrypoint: "@rigel-cms/rigel/routes/local-media.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/rigel/api/local/save",
            entrypoint: "@rigel-cms/rigel/routes/local-api.ts",
            prerender: false,
          });
          injectRoute({
            pattern: "/rigel/api/local/[collection]/[slug]",
            entrypoint: "@rigel-cms/rigel/routes/local-post.ts",
            prerender: false,
          });
          if (cfg.menus) injectRoute({
            pattern: "/rigel/api/local/menus/[slug]",
            entrypoint: "@rigel-cms/rigel/routes/local-menu.ts",
            prerender: false,
          });
          if (cfg.schema) injectRoute({
            pattern: "/rigel/api/local/documents/[id]",
            entrypoint: "@rigel-cms/rigel/routes/local-documents.ts",
            prerender: false,
          });
        }
      },
    },
  };
}

export { validateMenu } from "./manifest/menu";
export type { MenuItem, MenuDocument } from "./manifest/menu";
export { defineCopy } from "./manifest/types";
export type { CopyField, CopyGroup, CopyPage, Manifest, CollectionField } from "./manifest/types";
export type { RigelConfig, CollectionConfig, ContentLocalesConfig } from "./config";
export type { JsonOutput } from "./json-output";
export type { ReferenceOption } from "./manifest/references";
export type { SidebarEntry, SidebarTarget, SidebarIconName } from "./manifest/navigation";
export { defineSchema, defineDocument, defineObject, defineField } from "./schema/types";
export type { Schema, DocumentDef, ObjectDef, FieldDef, ContentDocument } from "./schema/types";
export { validateSchema, validateDocument, SchemaError } from "./schema/validate";
export { resolvePath, setPath, newKey, newDocumentFromTemplate, regenerateKeys, pageRoute } from "./schema/paths";
export { buildDocumentIndex, deref, referencedIds } from "./schema/docs";