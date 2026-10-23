import { expect, test } from "vitest";
import { createServer, type RunnableDevEnvironment } from "vite";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { rigelManifestPlugin } from "./manifest-plugin";
import { rigel } from "../index";
import type { AstroIntegration } from "astro";

const menu = { slug: "main", title: "Main", items: [] };

test.each(["folder", "file"])("manifest rejects symlink %s", async (kind) => {
  await mkdir("_temp", { recursive: true });
  const root = await mkdtemp(path.resolve("_temp/menu-symlink-"));
  try {
    await mkdir(path.join(root, "outside"));
    await writeFile(path.join(root, "outside/main.json"), JSON.stringify(menu));
    if (kind === "folder") await symlink(path.join(root, "outside"), path.join(root, "menus"));
    else {
      await mkdir(path.join(root, "menus"));
      await symlink(path.join(root, "outside/main.json"), path.join(root, "menus/main.json"));
    }
    const plugin = rigelManifestPlugin({ backend: "local", copyDir: "copy", menus: { folder: "menus" } }, undefined, pathToFileURL(root + "/"));
    const load = plugin.load as (id: string) => unknown;
    expect(() => load("\0virtual:rigel-manifest")).toThrow(/unsafe menu/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.each([
  ["local", "dev", true, true],
  ["local", "dev", false, false],
  ["local", "build", true, false],
  ["local", "preview", true, false],
  ["github", "dev", true, false],
] as const)("menus registration: %s %s configured=%s", async (backend, command, configured, enabled) => {
  const routes: { pattern: string; entrypoint: string; prerender?: boolean }[] = [];
  const setup = rigel({ backend, repo: "owner/repo", ...(configured ? { menus: { folder: "menus" } } : {}) }).hooks["astro:config:setup"]!;
  await setup({ command, config: { root: new URL("file:///site/"), publicDir: new URL("file:///site/public/") },
    injectRoute: (route: typeof routes[number]) => routes.push(route), injectScript() {}, updateConfig() {}, logger: { warn() {} },
  } as unknown as Parameters<NonNullable<AstroIntegration["hooks"]["astro:config:setup"]>>[0]);
  expect(routes.filter((route) => route.pattern === "/rigel/api/local/menus/[slug]")).toEqual(enabled ? [{
    pattern: "/rigel/api/local/menus/[slug]", entrypoint: "@rigel-cms/rigel/routes/local-menu.ts", prerender: false,
  }] : []);
});

test.each([JSON.stringify(menu), "{", JSON.stringify({ ...menu, slug: "wrong" }), JSON.stringify({ ...menu, items: [{}] })])("host Vite loads real validation and rejects invalid JSON: %s", async (contents) => {
  await mkdir("_temp", { recursive: true });
  const root = await mkdtemp(path.resolve("_temp/menu-manifest-"));
  await mkdir(path.join(root, "menus"));
  await writeFile(path.join(root, "menus/main.json"), contents);
  const server = await createServer({ configFile: false, root, logLevel: "silent", server: { middlewareMode: true, watch: null },
    plugins: [rigelManifestPlugin({ backend: "local", copyDir: "copy", menus: { folder: "menus", maxDepth: 3 } }, undefined, pathToFileURL(root + "/"))],
  });
  try {
    const load = (server.environments.ssr as RunnableDevEnvironment).runner.import("virtual:rigel-manifest");
    if (contents === JSON.stringify(menu)) {
      const result = await load;
      expect(result.default).toEqual({ pages: [], collections: [], documents: [], menus: { maxDepth: 3, entries: [menu] } });
      const config = await (server.environments.ssr as RunnableDevEnvironment).runner.import("virtual:rigel-config");
      expect(config.default.root).toBe(pathToFileURL(root + "/").href);
    } else await expect(load).rejects.toThrow(/Invalid menu/);
  } finally { await server.close(); await rm(root, { recursive: true, force: true }); }
});
