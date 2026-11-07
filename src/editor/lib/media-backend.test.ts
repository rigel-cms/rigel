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

test("reset rejects late media completion even when the same context is reused", async () => {
  let resolve!: (blob: Blob) => void;
  vi.spyOn(github, "readRemoteMedia").mockImplementation(() => new Promise(done => { resolve = done; }));
  const ctx = { token: "fixture", repo: "owner/site", branch: "drafts" }, manifest = { pages: [], github: { mediaDir: "media" } } as any;
  configureMediaBackend(() => ({ ctx, manifest }), undefined, () => "github");
  const attributes = new Map<string, string>();
  const node = { tagName: "IMG", setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } as unknown as Element;
  const preview = mediaSource(node, "/media/a.png");
  resetMediaPreviews(); resolve(new Blob(["late"]));
  await new Promise(done => setTimeout(done, 0));
  expect(attributes.has("src")).toBe(false);
  preview.destroy();
});

test("library thumbnails wait for near viewport while detail previews remain eager", async () => {
  const read = vi.spyOn(github, "readRemoteMedia").mockResolvedValue(new Blob(["image"]));
  const ctx = { token: "fixture", repo: "owner/site", branch: "drafts" }, manifest = { pages: [], github: { mediaDir: "media" } } as any;
  configureMediaBackend(() => ({ ctx, manifest }), undefined, () => "github");
  let visible!: IntersectionObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: IntersectionObserverCallback) { visible = callback; } observe() {} disconnect = disconnect; });
  const attributes = new Map<string, string>();
  const node = { tagName: "IMG", closest: () => ({}), setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key) } as unknown as Element;
  const preview = mediaSource(node, "/media/a.png");
  expect(read).not.toHaveBeenCalled();
  visible([{ isIntersecting: false }] as IntersectionObserverEntry[], {} as IntersectionObserver);
  expect(read).not.toHaveBeenCalled();
  visible([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver);
  await vi.waitFor(() => expect(attributes.get("src")).toMatch(/^blob:/));
  expect(read).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalled();
  preview.destroy();
  const detail = mediaSource({ ...node, closest: () => null } as unknown as Element, "/media/a.png");
  expect(read).toHaveBeenCalledTimes(2);
  detail.destroy();
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
