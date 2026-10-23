import { afterAll, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { APIContext } from "astro";
import { emptyBody } from "../article-body";

const folder = path.resolve("_temp/article-route-check");
vi.mock("virtual:rigel-config", () => ({ default: { collections: [{ name: "blog", folder: path.resolve("_temp/article-route-check"), fields: [] }] } }));
const { POST } = await import("./local-post");
afterAll(() => rm(folder, { recursive: true, force: true }));

test("existing article save route persists a Lexical tree without a Markdown round trip", async () => {
  const body = emptyBody();
  const payload = { frontmatter: { title: "Block article", draft: true }, body };
  const response = await POST({ params: { collection: "blog", slug: "blocks" }, request: new Request("http://localhost/rigel/api/local/blog/blocks", { method: "POST", body: JSON.stringify(payload) }) } as unknown as APIContext);
  expect(response.status).toBe(204);
  const text = await readFile(path.join(folder, "blocks.json"), "utf8");
  expect(JSON.parse(text)).toEqual({ frontmatter: { ...payload.frontmatter, slug: "blocks" }, body });
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  const invalid = await POST({ params: { collection: "blog", slug: "blocks" }, request: new Request("http://localhost/", { method: "POST", body: JSON.stringify({ frontmatter: {}, body: { root: { type: "script", version: 1 } } }) }) } as unknown as APIContext);
  expect(invalid.status).toBe(400);
  expect(await readFile(path.join(folder, "blocks.json"), "utf8")).toBe(text);
});
