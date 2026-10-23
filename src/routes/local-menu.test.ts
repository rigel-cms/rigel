import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { APIContext } from "astro";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import config from "virtual:rigel-config";
import { GET, POST, PUT, DELETE } from "./local-menu";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "local", menus: { folder: "content/menus", maxDepth: 3 } } }));

const origin = "http://localhost:4321";
const menu = { slug: "main", title: "Main", items: [{ id: "home", label: "Home", url: "/", children: [] }] };
let root: string;
let folder: string;

beforeEach(async () => {
  await mkdir("_temp", { recursive: true });
  root = await mkdtemp(path.resolve("_temp/local-menu-"));
  folder = path.join(root, "content/menus");
  config.root = pathToFileURL(root + "/").href;
  config.backend = "local";
  config.menus = { folder: "content/menus", maxDepth: 3 };
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

function call(method: "GET" | "POST" | "PUT" | "DELETE", body: unknown = menu, slug = "main", requestOrigin = origin) {
  return ({ GET, POST, PUT, DELETE })[method]({ params: { slug }, request: new Request(`${origin}/rigel/api/local/menus/${slug}`, {
    method, headers: { Origin: requestOrigin, "Content-Type": "application/json" },
    ...(method === "POST" || method === "PUT" ? { body: JSON.stringify(body) } : {}),
  }) } as unknown as APIContext);
}

async function declareMenu() {
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, "main.json"), JSON.stringify(menu));
}

test("reads and atomically updates developer-declared menus without allowing creation or deletion", async () => {
  expect((await call("GET")).status).toBe(404);
  expect((await call("PUT")).status).toBe(404);
  expect((await call("DELETE")).status).toBe(405);
  expect((await call("POST")).status).toBe(405);
  expect(await readdir(root)).toEqual([]);
  await declareMenu();
  expect(JSON.parse(await readFile(path.join(folder, "main.json"), "utf8"))).toEqual(menu);
  expect(await (await call("GET")).json()).toEqual(menu);
  const denied = await call("POST", { ...menu, title: "Wrong" });
  expect(denied.status).toBe(405);
  expect(denied.headers.get("Allow")).toBe("GET, PUT");
  expect(await (await call("GET")).json()).toEqual(menu);
  const updated = { ...menu, title: "Updated" };
  expect((await call("PUT", updated)).status).toBe(204);
  expect(await (await call("GET")).json()).toEqual(updated);
  expect(await readdir(folder)).toEqual(["main.json"]);
  expect((await call("DELETE")).status).toBe(405);
  expect(await (await call("GET")).json()).toEqual(updated);
});

test("parallel create requests cannot declare menus", async () => {
  expect((await Promise.all([call("POST"), call("POST")])).map((r) => r.status)).toEqual([405, 405]);
  expect(await readdir(root)).toEqual([]);
});

test.each(["../escape", "MAIN", "main.json", "a/b", "a\\b", "-main", "main-", "a--b", ""])("rejects slug %s", async (slug) => {
  expect((await call("PUT", menu, slug)).status).toBe(400);
  expect(await readdir(root)).toEqual([]);
});

test.each([null, { ...menu, slug: "other" }, { ...menu, items: [{}] }])("rejects invalid payload %j before writing", async (body) => {
  expect((await call("PUT", body)).status).toBe(400);
  expect(await readdir(root)).toEqual([]);
});

test("rejects invalid JSON and cross-origin writes", async () => {
  expect((await PUT({ params: { slug: "main" }, request: new Request(origin, { method: "PUT", headers: { Origin: origin }, body: "{" }) } as unknown as APIContext)).status).toBe(400);
  expect((await call("PUT", menu, "main", "https://evil.test")).status).toBe(403);
});

test("rejects production, github, and unconfigured requests", async () => {
  vi.stubEnv("PROD", true);
  expect((await call("POST")).status).toBe(404);
  vi.stubEnv("PROD", false);
  config.backend = "github";
  expect((await call("GET")).status).toBe(404);
  config.backend = "local";
  config.menus = undefined;
  expect((await call("POST")).status).toBe(404);
});

test("rejects malformed or mismatched stored documents without rewriting them", async () => {
  await declareMenu();
  for (const contents of ["{", JSON.stringify({ ...menu, slug: "wrong" })]) {
    await writeFile(path.join(folder, "main.json"), contents);
    expect((await call("GET")).status).toBe(500);
    expect(await readFile(path.join(folder, "main.json"), "utf8")).toBe(contents);
  }
});

test("rejects symlink folders before creating any descendants", async () => {
  const outside = await mkdtemp(path.resolve("_temp/menu-outside-"));
  try {
    await symlink(outside, path.join(root, "content"));
    expect((await call("PUT")).status).toBe(500);
    expect(await readdir(outside)).toEqual([]);
  } finally { await rm(outside, { recursive: true, force: true }); }
});

test("rejects symlink menu files for every method without changing the target", async () => {
  await mkdir(folder, { recursive: true });
  const outside = path.join(root, "outside.json");
  await writeFile(outside, JSON.stringify(menu));
  await symlink(outside, path.join(folder, "main.json"));
  for (const method of ["GET", "POST", "PUT", "DELETE"] as const)
    expect((await call(method)).status).toBe(method === "POST" || method === "DELETE" ? 405 : 500);
  expect(JSON.parse(await readFile(outside, "utf8"))).toEqual(menu);
});

test("rejects traversal configuration and requires the actual site root", async () => {
  config.menus!.folder = "../outside";
  expect((await call("PUT")).status).toBe(500);
  config.menus!.folder = "menus";
  config.root = undefined;
  expect((await call("PUT")).status).toBe(500);
  expect(await readdir(root)).toEqual([]);
});
