import { describe, expect, it } from "vitest";
import { buildSidebar, validateSidebar } from "./navigation";
import type { Manifest } from "./types";
import { emptyBody } from "../article-body";

const manifest = {
  pages: [
    { slug: "contact", label: "Contact", groups: [], values: {} },
    { slug: "footer", label: "Footer", shared: true, category: "Globals", groups: [], values: {} },
  ],
  collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "contact", frontmatter: { title: "A post", draft: true }, body: emptyBody() }] }],
  schema: { documents: [
    { name: "page", title: "Pages", type: "document", folder: "pages", fields: [] },
    { name: "logoSet", title: "Logo sets", type: "document", folder: "logos", fields: [], shared: true },
  ], objects: [] },
  documents: [
    { id: "page:home", type: "page", slug: "home", data: { title: "Home" } },
    { id: "logoSet:brands", type: "logoSet", slug: "brands", data: { title: "Brands" } },
  ],
  menus: { maxDepth: 3, entries: [{ slug: "footer", title: "Footer navigation", items: [] }] },
} as Manifest;

describe("content navigation", () => {
  it("keeps a configured icon and rejects remote sources", () => {
    const nodes = buildSidebar({ ...manifest, sidebar: [{ kind: "link", target: { kind: "collection", name: "blog" }, icon: "newspaper" }] } as Manifest);
    expect(nodes.find(node => node.kind === "link" && node.target.kind === "collection")).toMatchObject({ icon: "newspaper" });
    expect(() => validateSidebar([{ kind: "link", target: { kind: "media" }, icon: "https://example.test/icon.svg" }])).toThrow(/sidebar/);
  });
  it("supports bundled names or safe custom SVG paths without repairing unsafe input", () => {
    for (const icon of ["house", "calendar", "gear", "/icons/products.svg", "/demo/my-icon.SVG"]) {
      const sidebar = [{ kind: "link", target: { kind: "media" }, icon }];
      expect(() => validateSidebar(sidebar)).not.toThrow();
      expect(buildSidebar({ ...manifest, sidebar } as Manifest).find(node => node.kind === "link" && node.target.kind === "media")).toMatchObject({ icon });
      const withIcon = buildSidebar({ ...manifest, sidebar: [{ kind: "link", target: { kind: "pages" }, icon }] });
      expect(withIcon[0]).toMatchObject({ target: { kind: "pages" }, label: "Pages", icon });
    }
    for (const icon of ["unknown-icon", "//example.test/icon.svg", "/icons/../private.svg", "/icons/./icon.svg", "/icons/%2e%2e/icon.svg", "data:image/svg+xml,hi", "/icons/icon.svg?x=1", "/icons/icon.svg#mask", '/icons/a"b.svg', "/icons/a\\b.svg", "/icons/a\nb.svg", 12, null]) {
      expect(() => validateSidebar([{ kind: "link", target: { kind: "media" }, icon }])).toThrow(/sidebar/);
    }
  });
  it("defaults to flat groups and keeps shared copy out of Pages", () => {
    const nodes = buildSidebar(manifest);
    expect(nodes[0]).toEqual({ kind: "heading", label: "Website" });
    expect(nodes.filter(node => node.kind === "link").map(node => node.label)).not.toContain("All content");
    for (const node of nodes) expect(node).not.toHaveProperty("count");
    expect(nodes.filter(node => node.kind === "heading").map(node => node.label)).toEqual(["Website", "Shared content", "Assets"]);
    expect(nodes.find(node => node.kind === "link" && node.target.kind === "pages" && !node.target.category)).toMatchObject({ label: "Pages" });
    expect(nodes.find(node => node.kind === "link" && node.target.kind === "page")).toMatchObject({ label: "Footer", target: { kind: "page", slug: "footer" } });
  });

  it("honors configured headings, separators and labels without hiding omitted types", () => {
    const nodes = buildSidebar({ ...manifest, sidebar: [
      { kind: "heading", label: "Writing" },
      { kind: "link", target: { kind: "collection", name: "blog" }, label: "Journal" },
      { kind: "separator" },
      { kind: "link", target: { kind: "page", slug: "missing" } },
    ] });
    expect(nodes.slice(0, 3)).toEqual([
      { kind: "heading", label: "Writing" },
      { kind: "link", target: { kind: "collection", name: "blog" }, label: "Journal" },
      { kind: "separator" },
    ]);
    const links = nodes.filter(node => node.kind === "link");
    expect(links.some(node => node.target.kind === "documents" && node.target.type === "logoSet")).toBe(true);
    expect(links.filter(node => node.target.kind === "collection")).toHaveLength(1);
    expect(links.some(node => node.target.kind === "page" && node.target.slug === "missing")).toBe(false);
  });

  it("opens shared singletons directly after Assets without a count or duplicate collection", () => {
    const settings = { name: "settings", title: "Site settings", type: "document" as const, folder: "settings", fields: [], shared: true, singleton: true };
    const source = { ...manifest, schema: { ...manifest.schema!, documents: [...manifest.schema!.documents, settings] }, documents: [...manifest.documents!, { id: "settings:site", type: "settings", slug: "site", data: {} }] };
    for (const sidebar of [undefined, [{ kind: "link" as const, target: { kind: "document" as const, type: "settings", id: "settings:site" }, label: "Site settings", icon: "gear" }]]) {
      const nodes = buildSidebar({ ...source, sidebar });
      const links = nodes.filter(node => node.kind === "link" && "type" in node.target && node.target.type === "settings");
      expect(links).toHaveLength(1);
      expect(links[0]).toMatchObject({ label: "Site settings", target: { kind: "document", type: "settings", id: "settings:site" } });
      expect(links[0]).not.toHaveProperty("count");
      if (!sidebar) expect(nodes.at(-1)).toBe(links[0]);
    }
  });

  it("rejects malformed navigation instead of shipping executable or ambiguous config", () => {
    for (const value of [null, {}, [{ kind: "heading", label: "" }], [{ kind: "link", target: { kind: "collection" } }], [{ kind: "link", target: { kind: "unknown" } }], [{ kind: "link", target: { kind: "all" } }]]) {
      expect(() => validateSidebar(value)).toThrow(/sidebar/);
    }
    expect(() => validateSidebar([{ kind: "separator" }, { kind: "link", target: { kind: "documents", type: "logoSet" } }])).not.toThrow();
  });
});
