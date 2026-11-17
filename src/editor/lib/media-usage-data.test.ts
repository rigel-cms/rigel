import { afterEach, expect, test, vi } from "vitest";
import type { Manifest } from "../../manifest/types";
import { emptyBody } from "../../article-body";
import { mediaUsageSnapshot, mediaDeletionSnapshot } from "./media-usage-data";
import { resetLocalArticles } from "./local-articles";

afterEach(() => { vi.unstubAllGlobals(); resetLocalArticles(); });

const url = "/rigel-media/used.jpg";
const article = { frontmatter: { title: "Saved article" }, body: { root: { ...emptyBody().root, children: [{ type: "image", version: 1, src: url, alt: "Saved" }] } } };
const manifest = (): Manifest => ({ pages: [], collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "broken", frontmatter: {} }, { slug: "used", frontmatter: {} }] }] });

test("local media scans continue hydrating saved articles after a failed read", async () => {
  let fail = true;
  const fetcher = vi.fn(async (path: string) => path.endsWith("/broken") && fail ? new Response("Unavailable", { status: 503 }) : Response.json(article));
  vi.stubGlobal("fetch", fetcher);
  const m = manifest(), before = JSON.stringify(m);
  expect(await mediaUsageSnapshot(m, url)).toMatchObject({ entries: [{ label: "Saved article" }], complete: false, error: true });
  expect(await mediaDeletionSnapshot(m, url)).toEqual({ blocked: true, count: 1, unverified: true, error: true });
  fail = false;
  expect(await mediaUsageSnapshot(m, url)).toMatchObject({ entries: [{ label: "Saved article" }, { label: "Saved article" }], complete: true, error: false });
  expect(JSON.stringify(m)).toBe(before);
});
