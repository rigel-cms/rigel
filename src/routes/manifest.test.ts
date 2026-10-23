import { expect, test, vi } from "vitest";
import type { Manifest } from "../manifest/types";

const fixture = vi.hoisted(() => ({ manifest: {
  backend: "github",
  pages: [{ slug: "contact", label: "Contact", groups: [], values: { intro: { heading: "private-draft-marker" } } }],
  collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "unpublished", frontmatter: { title: "private-draft-marker" }, body: "private-draft-marker" }] }],
  documents: [{ id: "settings:site", type: "settings", slug: "site", data: { siteName: "private-draft-marker" } }],
  menus: { maxDepth: 3, entries: [{ slug: "main", title: "private-draft-marker", items: [] }] },
} }));
vi.mock("virtual:rigel-manifest", () => ({ default: fixture.manifest }));
const { GET } = await import("./manifest.json");

test("public GitHub manifest exposes metadata, never build-time drafts or document values", async () => {
  const response = await GET({} as never);
  const text = await response.text();
  expect(text).not.toContain("private-draft-marker");
  const manifest: Manifest = JSON.parse(text);
  expect(manifest.pages[0]).toEqual({ slug: "contact", label: "Contact", groups: [], values: {} });
  expect(manifest.collections?.[0].posts).toEqual([]);
  expect(manifest.documents).toEqual([]);
  expect(manifest.menus).toEqual({ maxDepth: 3, entries: [] });
  expect(fixture.manifest.documents[0].data.siteName).toBe("private-draft-marker");
});
