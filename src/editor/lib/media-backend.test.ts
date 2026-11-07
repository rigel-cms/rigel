import { afterEach, expect, test, vi } from "vitest";
import { configureMediaBackend, listMedia, saveMediaMetadata, deleteMedia, mediaSource, resetMediaPreviews, refreshMediaPreviews } from "./media-backend";
import * as github from "./github-backend";

vi.mock("virtual:rigel-config", () => ({ default: { backend: "local" } }));
afterEach(() => { configureMediaBackend(undefined)(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("context reset revokes previews and verified reconnect restores canonical sources", async () => {
  vi.spyOn(github, "readRemoteMedia").mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const ctx = { token: "fixture", repo: "owner/site", branch: "drafts" }, manifest = { pages: [], github: { mediaDir: "media" } } as any;
  const stop = configureMediaBackend(() => ({ ctx, manifest }), undefined, () => "github");
  const attributes = new Map<string, string>();
  const node = { tagName: "IMG", setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } as unknown as Element;
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const preview = mediaSource(node, "/media/image.png");
  await vi.waitFor(() => expect(attributes.get("src")).toMatch(/^blob:/));
  const first = attributes.get("src");
  resetMediaPreviews();
  expect(revoke).toHaveBeenCalledWith(first);
  expect(attributes.has("src")).toBe(false);
  refreshMediaPreviews();
  await vi.waitFor(() => expect(attributes.get("src")).toMatch(/^blob:/));
  expect(attributes.get("src")).not.toBe(first);
  preview.destroy(); stop();
});

test("local media retains listing, metadata and deletion HTTP contracts", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ assets: [{ url: "/rigel-media/a.txt", name: "a.txt" }], folder: "rigel-media", writable: true }));
  vi.stubGlobal("fetch", fetch);
  expect((await listMedia()).assets).toHaveLength(1);
  await saveMediaMetadata({ url: "/rigel-media/a.txt", title: "Title" });
  await deleteMedia("/rigel-media/a.txt");
  expect(fetch.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([["/rigel/media.json", "GET"], ["/rigel/api/local/media", "PUT"], ["/rigel/api/local/media", "DELETE"]]);
  expect(typeof configureMediaBackend).toBe("function");
  expect(typeof mediaSource).toBe("function");
});
