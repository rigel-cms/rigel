import { expect, test, vi } from "vitest";
import { rigel } from "./index";

vi.mock("@sveltejs/vite-plugin-svelte", () => ({ svelte: () => ({ name: "svelte" }) }));

function setup(backend: "github" | "local", command: "dev" | "build") {
  const injectRoute = vi.fn(), warn = vi.fn(), updateConfig = vi.fn();
  const integration = rigel({ backend, ...(backend === "github" ? { repo: "owner/site" } : {}) });
  const hook = integration.hooks["astro:config:setup"] as (options: unknown) => void;
  hook({ command, injectRoute, injectScript: vi.fn(), updateConfig, logger: { warn }, config: { root: new URL("file:///site/"), publicDir: new URL("file:///site/public/") } });
  return { routes: injectRoute.mock.calls.map(([route]) => route.pattern), warn, updateConfig };
}

test("GitHub dev and static builds expose no local write routes or obsolete read-only warning", () => {
  for (const command of ["dev", "build"] as const) {
    const { routes, warn } = setup("github", command);
    expect(routes).toEqual(["/rigel", "/rigel/manifest.json", "/rigel/media.json"]);
    expect(warn).not.toHaveBeenCalled();
  }
});

test("local persistence stays dev-only", () => {
  expect(setup("local", "dev").routes).toContain("/rigel/api/local/save");
  expect(setup("local", "build").routes.some(route => route.startsWith("/rigel/api/local/"))).toBe(false);
});

test("only client environments prebundle Svelte to preserve Astro's shared server runtime", () => {
  const { updateConfig } = setup("local", "dev");
  const plugin = updateConfig.mock.calls[0][0].vite.plugins.find((plugin: { name: string }) => plugin.name === "rigel-svelte-environment");
  expect(plugin?.configEnvironment("ssr")).toEqual({ optimizeDeps: { exclude: ["svelte"] } });
  expect(plugin.configEnvironment("astro")).toEqual({ optimizeDeps: { exclude: ["svelte"] } });
  expect(plugin.configEnvironment("client")).toBeUndefined();
});
