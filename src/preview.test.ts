import { expect, test } from "vitest";
import { anchorValue, previewPath, safePreviewUrl } from "./preview";
import { rigel } from "./index";

const config = { pages: { about: "/about/" }, collections: { blog: { url: "/blog/{slug}/", new: "/preview/blog/" } } };
test("explicit static routes, new templates and unsupported pages", () => {
  expect(previewPath(config, { kind: "page", slug: "about" })).toBe("/about/");
  expect(previewPath(config, { kind: "page", slug: "home" })).toBeNull();
  expect(previewPath(config, { kind: "post", collection: "blog", slug: "hello" })).toBe("/blog/hello/");
  expect(previewPath(config, { kind: "post", collection: "blog", slug: "hello" }, true)).toBe("/preview/blog/");
  for (const path of ["https://evil.test/", "//evil.test/", "/\\evil.test/", "/../rigel/", "/rigel/", "/about/?x=1"]) expect(previewPath({ pages: { about: path } }, { kind: "page", slug: "about" })).toBeNull();
});
test("nested scalars only, no inherited keys or fabricated lists", () => {
  expect(anchorValue({ intro: { title: "Hello" } }, "intro.title")).toEqual({ found: true, value: "Hello" });
  expect(anchorValue({ list: [{ _key: "k1", title: "Yes" }] }, "list.k1.title")).toEqual({ found: true, value: "Yes" });
  for (const path of ["__proto__.x", "constructor", "list.0.title", "missing"]) expect(anchorValue({ list: [{ title: "No" }] }, path).found).toBe(false);
});
test("document targets use explicit index and slug mappings", () => {
  const documents = { page: { url: "/{slug}/", index: "/" }, logoSet: { url: "/" } };
  expect(previewPath({ documents }, { kind: "document", type: "page", slug: "home" })).toBe("/");
  expect(previewPath({ documents }, { kind: "document", type: "page", slug: "about" })).toBe("/about/");
  expect(previewPath({ documents }, { kind: "document", type: "logoSet", slug: "brands" })).toBe("/");
  expect(previewPath({ documents }, { kind: "document", type: "unknown", slug: "x" })).toBeNull();
});
test("unsafe URLs are rejected", () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,x", "//evil.test", "java\nscript:x", "\\evil", "vbscript:x"]) expect(safePreviewUrl(url)).toBe(false);
  for (const url of ["/images/test.png", "https://example.test/x", "#heading", "relative.png"]) expect(safePreviewUrl(url)).toBe(true);
  expect(safePreviewUrl("mailto:a@b.test", true)).toBe(false);
});
test.each(["dev", "build"])("no preview API in %s", async command => {
  const routes: { pattern: string }[] = [];
  const integration = rigel({ preview: config });
  await (integration.hooks["astro:config:setup"] as Function)({ command, config: {}, injectScript() {}, injectRoute(route: { pattern: string }) { routes.push(route); }, updateConfig() {}, logger: { warn() {} } });
  expect(routes.some(r => r.pattern === "/rigel/api/preview")).toBe(false);
});
