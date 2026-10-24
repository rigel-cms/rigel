import { expect, test } from "vitest";
import { anchorValue, previewPath, safePreviewUrl } from "./preview";
import { rigel } from "./index";
import { parseConfig } from "./config";
import { previewUrl } from "./preview";

test("live and draft bases resolve independently without changing route mappings", () => {
  const config = parseConfig({ preview: { liveUrl: "https://sunnypixels.io", draftUrl: "https://drafts.example.test/site", pages: { about: "/about/" }, documents: { page: { url: "/{slug}/", index: "/" } }, collections: { blog: { url: "/blog/{slug}/", new: "/preview/blog/" } } } }).preview!;
  expect(previewUrl(config, { kind: "page", slug: "about" })).toBe("https://drafts.example.test/site/about/");
  expect(previewUrl(config, { kind: "page", slug: "about" }, "live")).toBe("https://sunnypixels.io/about/");
  expect(previewUrl(config, { kind: "document", type: "page", slug: "home" })).toBe("https://drafts.example.test/site/");
  expect(previewUrl(config, { kind: "post", collection: "blog", slug: "hello" }, "draft", true)).toBe("https://drafts.example.test/site/preview/blog/");
  expect(previewUrl(config, { kind: "post", collection: "blog", slug: "hello" }, "live")).toBe("https://sunnypixels.io/blog/hello/");
  expect(previewUrl(config, { kind: "menu", slug: "footer" })).toBeNull();
  expect(previewUrl({ pages: { about: "/about/" }, liveUrl: "https://live.test" }, { kind: "page", slug: "about" })).toBe("/about/");
  expect(previewUrl({ pages: { about: "/about/" } }, { kind: "page", slug: "about" }, "live")).toBe("/about/");
});

test("collection draft previews keep the prepared template after Save and reopening", () => {
  const config = {
    liveUrl: "https://live.test/",
    draftUrl: "https://draft.test/",
    collections: {
      blog: { url: "/blog/{slug}/", new: "/preview/blog/" },
      news: { url: "/news/{slug}/", new: "/preview/news/" },
    },
  };
  for (const collection of ["blog", "news"]) {
    const target = { kind: "post" as const, collection, slug: "not-built-yet" };
    const template = `https://draft.test/preview/${collection}/`;
    expect(previewUrl(config, target, "draft", true)).toBe(template);
    expect(previewUrl(config, target, "draft", false)).toBe(template);
    expect(previewUrl(config, target)).toBe(template);
    expect(previewUrl(config, target, "live", true)).toBe(`https://live.test/${collection}/not-built-yet/`);
    expect(previewUrl(config, target, "live", false)).toBe(`https://live.test/${collection}/not-built-yet/`);
  }
});

test("website previews use real routes on the draft host before and after Save", () => {
  const config = {
    liveUrl: "https://live.test/",
    draftUrl: "https://draft.test/site/",
    pages: { about: "/about/" },
    documents: { page: { url: "/page/{slug}/", index: "/" } },
    collections: {
      blog: { url: "/blog/{slug}/", new: "/preview/blog/" },
      news: { url: "/news/{slug}/", new: "/preview/news/" },
    },
  };
  for (const collection of ["blog", "news"]) {
    for (const isNew of [true, false]) {
      const target = { kind: "post" as const, collection, slug: "not-built-yet" };
      expect(previewUrl(config, target, "website", isNew)).toBe(`https://draft.test/site/${collection}/not-built-yet/`);
      expect(previewUrl({ ...config, draftUrl: undefined }, target, "website", isNew)).toBe(`/${collection}/not-built-yet/`);
    }
  }
  expect(previewUrl(config, { kind: "page", slug: "about" }, "website")).toBe("https://draft.test/site/about/");
  expect(previewUrl(config, { kind: "document", type: "page", slug: "about" }, "website")).toBe("https://draft.test/site/page/about/");
  expect(previewUrl(config, { kind: "document", type: "page", slug: "home" }, "website")).toBe("https://draft.test/site/");
  expect(previewUrl(config, { kind: "menu", slug: "footer" }, "website")).toBeNull();
  for (const draftUrl of ["javascript:alert(1)", "//evil.test/", "https://u:p@evil.test/", "https://draft.test/?x=1"]) {
    expect(previewUrl({ ...config, draftUrl }, { kind: "page", slug: "about" }, "website")).toBeNull();
  }
  for (const url of ["//evil.test/{slug}", "/../{slug}/", "/%2e%2e/{slug}/", "/rigel/{slug}/", "/blog/{slug}/?x=1"]) {
    expect(previewUrl({ ...config, collections: { blog: { url, new: "/preview/blog/" } } }, { kind: "post", collection: "blog", slug: "hello" }, "website")).toBeNull();
  }
});

test("website URL slugs use unsaved metadata while draft canvases keep their storage route", () => {
  const config = { documents: { page: { url: "/{slug}/" } }, collections: { blog: { url: "/blog/{slug}/", new: "/preview/blog/" } } };
  const target = { kind: "post" as const, collection: "blog", slug: "stable-file", urlSlug: "Árbol español!" };
  expect(previewUrl(config, target, "website")).toBe("/blog/arbol-espanol/");
  expect(previewUrl(config, target, "draft")).toBe("/preview/blog/");
  expect(previewUrl(config, { kind: "document", type: "page", slug: "stable-file", urlSlug: "Página nueva" }, "website")).toBe("/pagina-nueva/");
  expect(previewUrl(config, { ...target, urlSlug: "!!!" }, "website")).toBeNull();
});

test("preview bases reject unsafe or ambiguous URLs", () => {
  for (const key of ["liveUrl", "draftUrl"]) {
    for (const value of ["", "/relative/", "//example.test", "http://example.test", "javascript:alert(1)", "https://u:p@example.test", "https://@example.test", "https:///example.test", "https://example.test/\u0000", "https://example.test/?token=x", "https://example.test/#x", "https://example.test/../x", "https://example.test/%2e%2e/x", " https://example.test", "https://example.test/\\x", 123, null]) {
      expect(() => parseConfig({ preview: { [key]: value } })).toThrow(/preview/);
    }
    expect(parseConfig({ preview: { [key]: "http://127.0.0.1:4321/site/" } }).preview?.[key as "liveUrl"]).toBe("http://127.0.0.1:4321/site/");
  }
});

const config = { pages: { about: "/about/" }, collections: { blog: { url: "/blog/{slug}/", new: "/preview/blog/" } } };
test("explicit static routes, new templates and unsupported pages", () => {
  expect(previewPath(config, { kind: "page", slug: "about" })).toBe("/about/");
  expect(previewPath(config, { kind: "page", slug: "home" })).toBeNull();
  expect(previewPath(config, { kind: "post", collection: "blog", slug: "hello" })).toBe("/blog/hello/");
  expect(previewPath(config, { kind: "post", collection: "blog", slug: "hello" }, true)).toBe("/preview/blog/");
  for (const path of ["https://evil.test/", "//evil.test/", "/\\evil.test/", "/../rigel/", "/%2e%2e/rigel/", "/./rigel/", "/rigel/", "/about/?x=1"]) {
    expect(previewPath({ pages: { about: path } }, { kind: "page", slug: "about" })).toBeNull();
    expect(previewPath({ documents: { page: { url: "/{slug}/", index: path } } }, { kind: "document", type: "page", slug: "home" })).toBeNull();
  }
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
  const preview = { ...config, liveUrl: "https://sunnypixels.io/", draftUrl: "https://drafts.example.test/" };
  const integration = rigel({ preview });
  let code = "";
  await (integration.hooks["astro:config:setup"] as Function)({ command, config: {}, injectScript() {}, injectRoute(route: { pattern: string }) { routes.push(route); }, updateConfig(config: { vite: { plugins: { load: (id: string) => string }[] } }) { code = config.vite.plugins[0].load("\0virtual:rigel-manifest"); }, logger: { warn() {} } });
  expect(routes.some(r => r.pattern === "/rigel/api/preview")).toBe(false);
  expect(code).toContain("preview: " + JSON.stringify(preview));
});
