import { expect, test, vi } from "vitest";
import { rigelManifestPlugin } from "./manifest-plugin";
import type { RigelConfig } from "../config";
import { rigel } from "../index";
import type { AstroIntegration } from "astro";

interface RawPlugin {
  resolveId: (id: string) => string | undefined;
  load: (id: string) => string | undefined;
}

function raw(cfg: RigelConfig): RawPlugin {
  return rigelManifestPlugin(cfg) as unknown as RawPlugin;
}

const cfg: RigelConfig = { copyDir: "src/content/copy", backend: "local" };

test("github manifest projects only public remote configuration", () => {
  const plugin = raw({ ...cfg, backend: "github", repo: "owner/repo", users: ["private-user"], collections: [{ name: "blog", folder: "src/content/blog", fields: [] }], menus: { folder: "src/content/menus" } });
  const code = plugin.load("\0virtual:rigel-manifest")!;
  expect(code).toContain('backend: "github"');
  expect(code).toContain('github: {"repo":"owner/repo","branch":"drafts","publishBranch":"main","repoRoot":"","authOrigin":"https://auth.rigelcms.dev","appSlug":"rigel-cms","copyDir":"src/content/copy","collections":[{"name":"blog","folder":"src/content/blog"}],"menus":{"folder":"src/content/menus","maxDepth":3}}');
  expect(code).not.toContain("private-user");
  expect(raw(cfg).load("\0virtual:rigel-manifest")).not.toContain("github:");
});

test("Astro content-store reloads reach public pages but not mounted editor clients", () => {
  const plugin = rigelManifestPlugin(cfg);
  const editor = { send: vi.fn() }, website = { send: vi.fn() };
  const on = vi.fn(), broadcast = vi.fn();
  const server = { ws: { on, clients: new Set([editor, website]) }, environments: { client: { hot: { send: broadcast } } } };
  (plugin.configureServer as (server: unknown) => void)(server);
  expect(on).toHaveBeenCalledWith("rigel:editor-ready", expect.any(Function));
  on.mock.calls[0][1]({}, editor);
  const reload = { type: "full-reload", path: "*" };
  server.environments.client.hot.send(reload);
  expect(editor.send).not.toHaveBeenCalled();
  expect(website.send).toHaveBeenCalledWith(reload);
  const update = { type: "update", updates: [] };
  server.environments.client.hot.send(update);
  expect(broadcast).toHaveBeenCalledWith(update);
});

test("collection Markdown HMR invalidates the manifest without reloading the editor", () => {
  const plugin = rigelManifestPlugin({ ...cfg, collections: [{ name: "blog", folder: "src/content/blog", fields: [] }] }, undefined, new URL("file:///site/"));
  const send = vi.fn();
  const invalidateModule = vi.fn();
  const virtual = { id: "\0virtual:rigel-manifest" };
  const context = { environment: { name: "client", moduleGraph: { getModuleById: (id: string) => id === virtual.id ? virtual : undefined, invalidateModule }, hot: { send } } };
  const handler = (plugin.hotUpdate as { handler: (...args: unknown[]) => unknown }).handler;
  expect(handler.call(context, { file: "/site/src/content/blog/nested/post.md", modules: [], timestamp: 1 })).toEqual([]);
  expect(invalidateModule).toHaveBeenCalledWith(virtual, expect.any(Set), 1, true);
  expect(send).toHaveBeenCalledWith({ type: "custom", event: "rigel:collections-updated", data: {} });
  send.mockClear();
  expect(handler.call(context, { file: "/site/src/content/blog-other/post.md", modules: [], timestamp: 2 })).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});

test.each([
  ["local", "dev", true],
  ["local", "build", false],
  ["local", "preview", false],
  ["github", "dev", false],
] as const)("media registration for %s backend and %s", async (backend, command, enabled) => {
  const routes: { pattern: string; entrypoint: string; prerender?: boolean }[] = [];
  let plugins: RawPlugin[] = [];
  const publicDir = new URL("file:///site/custom%20public/");
  const setup = rigel({ backend, repo: "owner/repo" }).hooks["astro:config:setup"]!;
  await setup({
    command,
    config: { publicDir },
    injectRoute: (route: typeof routes[number]) => routes.push(route),
    updateConfig: (config: { vite: { plugins: RawPlugin[] } }) => { plugins = config.vite.plugins; },
    logger: { warn() {} },
  } as unknown as Parameters<NonNullable<AstroIntegration["hooks"]["astro:config:setup"]>>[0]);
  expect(routes.filter((route) => route.pattern === "/rigel/api/local/media")).toEqual(enabled ? [{
    pattern: "/rigel/api/local/media",
    entrypoint: "@rigel-cms/rigel/routes/local-media.ts",
    prerender: false,
  }] : []);
  const code = plugins[0].load("\0virtual:rigel-config")!;
  expect(JSON.parse(code.slice("export default ".length, -1)).publicDir).toBe(publicDir.href);
});

test("demo flag controls discovery, public content and the server's writable schema", () => {
  const fields = [{ key: "name", label: "Name", type: "string" as const }];
  const schema = { objects: [], documents: [
    { name: "settings", title: "Site settings", type: "document" as const, folder: "settings", shared: true, singleton: true, fields },
    { name: "demo", title: "Demo", type: "document" as const, folder: "demos", shared: true, singleton: true, demo: true, fields },
  ] };
  for (const demo of [undefined, true, false]) {
    const plugin = raw({ ...cfg, schema, demo });
    for (const id of ["\0virtual:rigel-manifest", "\0virtual:rigel-content"]) {
      const code = plugin.load(id)!;
      expect(code.includes('import.meta.glob("/demos/*.json"')).toBe(demo !== false);
      expect(code).toContain('import.meta.glob("/settings/*.json"');
    }
    const config = JSON.parse(plugin.load("\0virtual:rigel-config")!.slice("export default ".length, -1));
    expect(config.demo).toBe(demo !== false);
    expect(config.schema.documents.map((type: { name: string }) => type.name)).toEqual(demo === false ? ["settings"] : ["settings", "demo"]);
  }
});

test("resolves the virtual module id", () => {
  expect(raw(cfg).resolveId("virtual:rigel-manifest")).toBe("\0virtual:rigel-manifest");
});

test("ignores unrelated ids", () => {
  const p = raw(cfg);
  expect(p.resolveId("other")).toBeUndefined();
  expect(p.load("other")).toBeUndefined();
});

test("load emits a HOST-side glob over the configured copyDir, sorted by slug", () => {
  const code = raw(cfg).load("\0virtual:rigel-manifest") as string;
  expect(code).toContain('import.meta.glob("/src/content/copy/**/*.ts"');
  expect(code).toContain("eager: true");
  expect(code).toContain("localeCompare");
  expect(code).toContain("export default { pages, collections, documents }");
});

test("glob pattern follows config copyDir", () => {
  const code = raw({ copyDir: "content/text", backend: "local" }).load(
    "\0virtual:rigel-manifest",
  ) as string;
  expect(code).toContain("/content/text/**/*.ts");
});

test("preserves a configured collection list title", () => {
  const code = raw({ ...cfg, collections: [{ name: "blog", folder: "src/content/blog", fields: [], listTitle: "Editorial library" }] }).load("\0virtual:rigel-manifest")!;
  expect(code).toContain('listTitle: "Editorial library"');
});

const schema = {
  documents: [
    { name: "page", title: "Pages", type: "document" as const, folder: "src/content/pages", fields: [{ key: "title", label: "Title", type: "string" as const }] },
    { name: "logoSet", title: "Logo sets", type: "document" as const, folder: "src/content/shared", shared: true, fields: [{ key: "title", label: "Title", type: "string" as const }] },
  ],
  objects: [],
};

test("emits document globs, schema, reserved slugs and the content module", () => {
  const plugin = raw({ ...cfg, schema });
  const code = plugin.load("\0virtual:rigel-manifest") as string;
  expect(code).toContain('import.meta.glob("/src/content/pages/*.json"');
  expect(code).toContain('import.meta.glob("/src/content/shared/*.json"');
  expect(code).toContain("__rigelReservedSlugs");
  expect(code).toContain("schema:");
  const content = plugin.load("\0virtual:rigel-content") as string;
  expect(content).toContain("buildDocumentIndex");
  expect(content).toContain("export function getDocument");
  expect(content).toContain("export function derefDocument");
  expect(plugin.resolveId("virtual:rigel-content")).toBe("\0virtual:rigel-content");
  expect(JSON.parse((plugin.load("\0virtual:rigel-config") as string).slice("export default ".length, -1)).schema.documents).toHaveLength(2);
});
