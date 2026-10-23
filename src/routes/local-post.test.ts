import { afterAll, expect, test, vi } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { APIContext } from "astro";
import { emptyBody } from "../article-body";
import { initialCollectionValues } from "../manifest/collections";
import config from "virtual:rigel-config";

const folder = path.resolve("_temp/article-route-check");
vi.mock("virtual:rigel-config", () => ({ default: { collections: [{ name: "blog", folder: path.resolve("_temp/article-route-check"), fields: [
  { key: "title", label: "Title", type: "string", required: true },
  { key: "description", label: "Description", type: "text" },
  { key: "date", label: "Date", type: "date" },
  { key: "tags", label: "Tags", type: "tags" },
  { key: "author", label: "Author", type: "reference", options: [{ value: "alex", label: "Alex" }] },
] }] } }));
const { POST } = await import("./local-post");
afterAll(() => rm(folder, { recursive: true, force: true }));

function save(slug: string, frontmatter: Record<string, unknown>, body: unknown = emptyBody(), creating = false) {
  return POST({ params: { collection: "blog", slug }, request: new Request("http://localhost/", { method: "POST", headers: creating ? { "If-None-Match": "*" } : {}, body: JSON.stringify({ frontmatter, body }) }) } as unknown as APIContext);
}

test("creating a post cannot overwrite a slug created since loading the collection", async () => {
  expect((await save("occupied", { title: "Original" })).status).toBe(204);
  const file = path.join(folder, "occupied.json");
  const before = await readFile(file, "utf8");
  expect((await save("occupied", { title: "Duplicate" }, emptyBody(), true)).status).toBe(409);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("concurrent creates persist one complete post without overwriting the winner", async () => {
  const responses = await Promise.all([
    save("simultaneous", { title: "First" }, emptyBody(), true),
    save("simultaneous", { title: "Second" }, emptyBody(), true),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([204, 409]);
  const post = JSON.parse(await readFile(path.join(folder, "simultaneous.json"), "utf8"));
  expect(post.frontmatter.title).toBe(responses[0].status === 204 ? "First" : "Second");
  expect(post.body).toEqual(emptyBody());
});

test("existing article save route persists a Lexical tree without a Markdown round trip", async () => {
  const body = emptyBody();
  const frontmatter = { title: "Block article", draft: true };
  expect((await save("blocks", frontmatter, body)).status).toBe(204);
  const text = await readFile(path.join(folder, "blocks.json"), "utf8");
  expect(JSON.parse(text)).toEqual({ frontmatter: { ...frontmatter, slug: "blocks" }, body });
  expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2) + "\n");
  expect((await save("blocks", frontmatter, { root: { type: "script", version: 1 } })).status).toBe(400);
  expect(await readFile(path.join(folder, "blocks.json"), "utf8")).toBe(text);
});

test("new values persist untouched description and rejected saves leave existing bytes unchanged", async () => {
  const frontmatter = { ...initialCollectionValues(config.collections![0].fields, "New post"), custom: { keep: true } };
  expect((await save("new-post", frontmatter)).status).toBe(204);
  const file = path.join(folder, "new-post.json");
  const before = await readFile(file, "utf8");
  expect(JSON.parse(before).frontmatter).toMatchObject({ description: "", custom: { keep: true } });
  for (const invalid of [{ title: "" }, { description: 3 }, { date: "2026-02-30" }, { tags: [false] }, { author: "missing" }]) {
    expect((await save("new-post", { ...frontmatter, ...invalid })).status).toBe(400);
    expect(await readFile(file, "utf8")).toBe(before);
  }
});
