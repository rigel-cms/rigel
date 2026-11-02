import { expect, test, vi } from "vitest";
import type { APIContext, APIRoute } from "astro";
import config from "virtual:rigel-config";
import * as fs from "node:fs/promises";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "demo", root: "file:///site/", schema: { documents: [], objects: [] }, menus: { folder: "menus" }, collections: [{ name: "blog", folder: "blog", fields: [] }] } }));
vi.mock("node:fs/promises", async importOriginal => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return Object.fromEntries(Object.keys(original).map(key => [key, vi.fn(() => { throw new Error("Unexpected filesystem access"); })]));
});
const copy = await import("./local-api");
const posts = await import("./local-post");
const media = await import("./local-media");
const documents = await import("./local-documents");
const menus = await import("./local-menu");
const handlers: [string, APIRoute][] = [
  ["copy POST", copy.POST], ["post POST", posts.POST], ["post DELETE", posts.DELETE],
  ...["GET", "POST", "PUT", "DELETE"].flatMap(method => [
    [`media ${method}`, media[method as keyof typeof media] as APIRoute],
    [`documents ${method}`, documents[method as keyof typeof documents] as APIRoute],
    [`menus ${method}`, menus[method as keyof typeof menus] as APIRoute],
  ] as [string, APIRoute][]),
];

test.each(["demo", "github"] as const)("%s rejects every local handler before reading payloads or touching files", async backend => {
  config.backend = backend;
  vi.clearAllMocks();
  for (const [name, handler] of handlers) {
    const method = name.split(" ")[1];
    const request = new Request("http://localhost/rigel/api/local/test", { method, headers: { Origin: "http://localhost" } });
    const json = vi.spyOn(request, "json");
    const response = await handler({ request, params: { collection: "blog", slug: "hello", id: "page:hello", filename: "image.png" } } as unknown as APIContext);
    expect(response.status, name).toBe(404);
    expect(json, name).not.toHaveBeenCalled();
  }
  for (const fn of Object.values(fs)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
});
