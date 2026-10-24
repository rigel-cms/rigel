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

test.each([undefined, "pretty", "minified"] as const)("post saves use %s JSON without rewriting other posts", async (jsonOutput) => {
  const frontmatter = { title: "Árbol 🌍", custom: { keep: [false, "line\nbreak"] } };
  const body = emptyBody();
  const untouched = path.join(folder, "format-untouched.json");
  expect((await save("format-untouched", { title: "Untouched" })).status).toBe(204);
  const before = await readFile(untouched, "utf8");
  config.jsonOutput = jsonOutput;
  try {
    expect(await readFile(untouched, "utf8")).toBe(before);
    const slug = `format-${jsonOutput ?? "default"}`;
    expect((await save(slug, frontmatter, body, true)).status).toBe(204);
    expect((await save(slug, frontmatter, body)).status).toBe(204);
    const text = await readFile(path.join(folder, `${slug}.json`), "utf8");
    expect(text).toBe(JSON.stringify({ frontmatter, body }, null, jsonOutput === "minified" ? undefined : 2) + "\n");
    expect(JSON.parse(text)).toEqual({ frontmatter, body });
    expect(await readFile(untouched, "utf8")).toBe(before);
  } finally { config.jsonOutput = undefined; }
});

test("creating a post cannot overwrite a slug created since loading the collection", async () => {
  expect((await save("occupied", { title: "Original" })).status).toBe(204);
  const file = path.join(folder, "occupied.json");
  const before = await readFile(file, "utf8");
  expect((await save("occupied", { title: "Duplicate" }, emptyBody(), true)).status).toBe(409);
  expect(await readFile(file, "utf8")).toBe(before);
});

test("URL slug edits normalize without changing the storage filename or unknown metadata", async () => {
  const frontmatter = { title: "Spanish", slug: "Árbol y NIÑO!", author: "alex", custom: { keep: true } };
  expect((await save("spanish-file", frontmatter)).status).toBe(204);
  const stored = JSON.parse(await readFile(path.join(folder, "spanish-file.json"), "utf8"));
  expect(stored.frontmatter).toEqual({ ...frontmatter, slug: "arbol-y-nino" });
  expect((await save("spanish-file", stored.frontmatter)).status).toBe(204);
  expect((await save("another-file", { title: "Duplicate", slug: "arbol-y-nino" })).status).toBe(400);
  expect((await save("invalid-file", { title: "Invalid", slug: "!!!" })).status).toBe(400);
  expect((await save("legacy-url", { title: "Legacy" })).status).toBe(204);
  expect((await save("another-file", { title: "Duplicate fallback", slug: "legacy-url" })).status).toBe(400);
});

test("concurrent different filenames cannot claim the same URL slug", async () => {
  const responses = await Promise.all(["url-race-one", "url-race-two"].map(slug => save(slug, { title: "Race", slug: "shared-url" }, emptyBody(), true)));
  expect(responses.map(response => response.status).sort()).toEqual([204, 400]);
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
  expect(JSON.parse(text)).toEqual({ frontmatter, body });
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
