import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { APIContext } from "astro";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import config from "virtual:rigel-config";
import { GET, POST, PUT, DELETE } from "./local-documents";
import type { Schema } from "../schema/types";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "local" } }));

const origin = "http://localhost:4321";
const schema: Schema = {
  documents: [
    {
      name: "page", title: "Pages", type: "document", folder: "content/pages",
      fields: [
        { key: "title", label: "Title", type: "string", required: true },
        { key: "sections", label: "Sections", type: "array", items: [{ type: "object", name: "hero" }] },
        { key: "callout", label: "Callout", type: "reference", to: ["callout"] },
      ],
    },
    {
      name: "callout", title: "Callouts", type: "document", folder: "content/shared", shared: true,
      fields: [{ key: "title", label: "Title", type: "string", required: true }],
    },
  ],
  objects: [{ name: "hero", title: "Hero", type: "section", fields: [{ key: "heading", label: "Heading", type: "string" }] }],
};

const callout = { _id: "callout:studio", _type: "callout", title: "Studio" };
const home = {
  _id: "page:home", _type: "page", slug: "home", title: "Home",
  sections: [{ _key: "khero01", _type: "hero", heading: "Welcome" }],
  callout: { _ref: "callout:studio" },
};

let root: string;

beforeEach(async () => {
  await mkdir("_temp", { recursive: true });
  root = await mkdtemp(path.resolve("_temp/local-documents-"));
  await mkdir(path.join(root, "content/pages"), { recursive: true });
  await mkdir(path.join(root, "content/shared"), { recursive: true });
  config.root = pathToFileURL(root + "/").href;
  config.backend = "local";
  config.schema = schema;
  await writeFile(path.join(root, "content/shared/studio.json"), JSON.stringify(callout));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function call(method: "GET" | "POST" | "PUT" | "DELETE", body: unknown = { data: home }, id = "page:home", requestOrigin = origin) {
  return ({ GET, POST, PUT, DELETE })[method]({
    params: { id },
    request: new Request(`${origin}/rigel/api/local/documents/${encodeURIComponent(id)}`, {
      method,
      headers: { Origin: requestOrigin, "Content-Type": "application/json" },
      ...(method === "POST" || method === "PUT" ? { body: JSON.stringify(body) } : {}),
    }),
  } as unknown as APIContext);
}

test("creates and updates validated documents, then reads them back", async () => {
  expect((await call("GET")).status).toBe(404);
  expect((await call("POST")).status).toBe(204);
  expect(JSON.parse(await readFile(path.join(root, "content/pages/home.json"), "utf8"))).toEqual(home);
  expect(await (await call("GET")).json()).toEqual({ id: "page:home", type: "page", slug: "home", data: home });
  expect((await call("POST")).status).toBe(409);
  expect((await call("PUT", { data: { ...home, title: "Homepage" } })).status).toBe(204);
  expect((await (await call("GET")).json()).data.title).toBe("Homepage");
  expect((await call("PUT", { data: home }, "page:missing")).status).toBe(404);
});

test("editable URL slug preserves document identity, references and legacy omissions", async () => {
  expect((await call("POST")).status).toBe(204);
  const data = { ...home, slug: "Árbol español!", custom: { keep: true } };
  expect((await call("PUT", { data })).status).toBe(204);
  const stored = await (await call("GET")).json();
  expect(stored).toEqual({ id: "page:home", type: "page", slug: "home", data: { ...data, slug: "arbol-espanol" } });
  expect(await readdir(path.join(root, "content/pages"))).toEqual(["home.json"]);
  expect((await call("POST", { data: { title: "Other", slug: "arbol-espanol" } }, "page:other")).status).toBe(400);
  expect((await call("PUT", { data: { ...home, slug: "!!!" } })).status).toBe(400);
  await writeFile(path.join(root, "content/pages/legacy.json"), JSON.stringify({ title: "Legacy" }));
  expect((await call("PUT", { data: { ...home, slug: "legacy" } })).status).toBe(400);
  expect((await call("PUT", { data: { title: "Edited legacy" } }, "page:legacy")).status).toBe(204);
  expect((await (await call("GET", undefined, "page:legacy")).json()).data).not.toHaveProperty("slug");
});

test("rejects invalid ids, payloads and broken references without writing", async () => {
  for (const id of ["../escape", "page:Bad Slug", "unknown:home", "page", "page:home:extra", "%zz"]) expect((await call("POST", { data: home }, id)).status).toBe(400);
  for (const body of [null, {}, { data: {} }, { data: { ...home, title: "" } }, { data: { ...home, sections: [{ _type: "hero" }] } }, { data: { ...home, callout: { _ref: "callout:missing" } } }])
    expect((await call("POST", body)).status).toBe(400);
  expect(await readdir(path.join(root, "content/pages"))).toEqual([]);
});

test("requires same-origin writes, forbids deletes and rejects production or other backends", async () => {
  expect((await call("POST", { data: home }, "page:home", "https://evil.test")).status).toBe(403);
  expect((await call("DELETE")).status).toBe(405);
  const invalid = await POST({ params: { id: "page:home" }, request: new Request(origin, { method: "POST", headers: { Origin: origin }, body: "{" }) } as unknown as APIContext);
  expect(invalid.status).toBe(400);
  vi.stubEnv("PROD", true);
  expect((await call("POST")).status).toBe(404);
  vi.stubEnv("PROD", false);
  config.backend = "github";
  expect((await call("POST")).status).toBe(404);
  config.backend = "local";
  config.schema = undefined;
  expect((await call("POST")).status).toBe(404);
  expect(await readdir(path.join(root, "content/pages"))).toEqual([]);
});

test("rejects documents over the size limit before writing", async () => {
  const big = { ...home, title: "x".repeat(60 * 1024) };
  const response = await call("POST", { data: { ...big, sections: [{ _key: "k1", _type: "hero", heading: "y".repeat(1024 * 1024) }] } });
  expect(response.status).toBe(413);
  expect(await readdir(path.join(root, "content/pages"))).toEqual([]);
});

test("refuses symlinked document files and folders", async () => {
  const outside = path.join(root, "outside.json");
  await writeFile(outside, JSON.stringify(home));
  await symlink(outside, path.join(root, "content/pages/home.json"));
  expect((await call("GET")).status).toBe(500);
  expect((await call("PUT")).status).toBe(500);
  expect(JSON.parse(await readFile(outside, "utf8"))).toEqual(home);
  await rm(path.join(root, "content/pages/home.json"));
  await rm(path.join(root, "content"), { recursive: true, force: true });
  const elsewhere = await mkdtemp(path.resolve("_temp/local-documents-outside-"));
  try {
    await symlink(elsewhere, path.join(root, "content"));
    expect((await call("POST")).status).toBe(500);
    expect(await readdir(elsewhere)).toEqual([]);
  } finally {
    await rm(elsewhere, { recursive: true, force: true });
  }
});
