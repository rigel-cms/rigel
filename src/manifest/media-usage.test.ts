import { expect, test } from "vitest";
import { mediaDeletion, mediaUsage } from "./media-usage";
import type { Manifest } from "./types";

test("finds exact structured and parsed richtext references once per entry", () => {
  const manifest: Manifest = { pages: [{ slug: "home", label: "Home", groups: [{ id: "hero", label: "Hero", fields: [{ key: "image", type: "image", label: "Image" }, { key: "body", type: "markdown", label: "Body" }] }], values: { hero: { image: "/rigel-media/a.png", body: "![Image](/rigel-media/a.png?width=100)" } } }], collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "one", frontmatter: { title: "One" }, body: { root: { type: "root", version: 1, children: [{ ...{ type: "link", version: 1, url: "/rigel-media/a.png#download", children: [] } }], direction: null, format: "", indent: 0 } } }] }] };
  expect(mediaUsage(manifest, "/rigel-media/a.png").entries.map(entry => entry.label)).toEqual(["Home", "One"]);
  expect(mediaUsage(manifest, "/rigel-media/a.png").complete).toBe(true);
  expect(mediaUsage(manifest, "/rigel-media/a.png.bak").entries).toEqual([]);
});

test("resolves schema objects, section arrays, files and parsed Markdown without matching prose or code", () => {
  const manifest: Manifest = {
    pages: [],
    schema: { documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", fields: [{ key: "sections", label: "Sections", type: "array", items: [{ type: "object", name: "hero" }] }, { key: "body", label: "Body", type: "markdown" }] }], objects: [{ name: "hero", title: "Hero", type: "section", fields: [{ key: "file", label: "File", type: "file" }] }] },
    documents: [{ id: "page:one", type: "page", slug: "one", data: { title: "One", sections: [{ _type: "hero", file: "/media/my%20file.pdf#page=2" }], body: "[Download][file]\n\n[file]: /media/other.pdf" } }, { id: "page:two", type: "page", slug: "two", data: { body: "Mention /media/other.pdf and `/media/other.pdf`.\n\n```\n[Download](/media/other.pdf)\n```" } }],
    menus: { maxDepth: 2, entries: [{ slug: "footer", title: "Footer", items: [{ id: "one", label: "File", url: "/media/other.pdf", children: [] }] }] },
  };
  expect(mediaUsage(manifest, "/media/my%20file.pdf").entries.map(entry => entry.label)).toEqual(["One"]);
  expect(mediaUsage(manifest, "/media/other.pdf").entries.map(entry => entry.label)).toEqual(["One", "Footer"]);
  expect(mediaUsage(manifest, "/media/not-used.pdf")).toEqual({ entries: [], complete: true });
});

test("checks unsupported richtext even when the same entry already references the asset", () => {
  const manifest: Manifest = { pages: [{ slug: "one", label: "One", values: { hero: { image: "/a.png" }, body: { text: "<img src=\"/a.png\">" } }, groups: [{ id: "hero", label: "Hero", fields: [{ key: "image", label: "Image", type: "image" }] }, { id: "body", label: "Body", fields: [{ key: "text", label: "Text", type: "markdown" }] }] }] };
  expect(mediaUsage(manifest, "/a.png").complete).toBe(false);
});

test("never claims complete coverage for unloaded documents or collection bodies", () => {
  expect(mediaUsage({ pages: [], backend: "github", documents: [{ id: "page:one", type: "page", slug: "one", loaded: "metadata", data: { title: "One" } }] }, "/rigel-media/a.png").complete).toBe(false);
  expect(mediaUsage({ pages: [], collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "one", frontmatter: {} }] }] }, "/rigel-media/a.png").complete).toBe(false);
});

test("blocks deletion only for assets still referenced in checked content", () => {
  const used: Manifest = { pages: [{ slug: "home", label: "Home", groups: [{ id: "hero", label: "Hero", fields: [{ key: "image", label: "Image", type: "image" }] }], values: { hero: { image: "/rigel-media/a.png" } } }] };
  expect(mediaDeletion(used, "/rigel-media/a.png")).toEqual({ blocked: true, count: 1, unverified: false });
  expect(mediaDeletion({ pages: [] }, "/rigel-media/a.png")).toEqual({ blocked: false, count: 0, unverified: false });
  expect(mediaDeletion({ pages: [], documents: [{ id: "page:one", type: "page", slug: "one", loaded: "metadata", data: { title: "One" } }] }, "/rigel-media/a.png")).toEqual({ blocked: false, count: 0, unverified: true });
});
