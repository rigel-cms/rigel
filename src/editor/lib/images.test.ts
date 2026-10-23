import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getKeys, setKeys, searchImages, importStockImage, importImageUrl } from "./images";

const fetchMock = vi.fn();

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

test("Pixabay keys persist and authenticate photo searches", async () => {
  setKeys({ pixabay: "test-pixabay-key" });
  expect(getKeys().pixabay).toBe("test-pixabay-key");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ hits: [{
    id: 123, largeImageURL: "https://pixabay.com/get/photo.jpg",
    webformatURL: "https://pixabay.com/get/preview.jpg", pageURL: "https://pixabay.com/photos/123/",
    user: "Test photographer", tags: "stars",
  }] }), { headers: { "Content-Type": "application/json" } }));
  const results = await searchImages("pixabay", "stars & sky");
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(url.origin).toBe("https://pixabay.com");
  expect(url.searchParams.get("key")).toBe("test-pixabay-key");
  expect(url.searchParams.get("q")).toBe("stars & sky");
  expect(url.searchParams.get("safesearch")).toBe("true");
  expect(results[0]).toMatchObject({ source: "pixabay", url: "https://pixabay.com/get/photo.jpg", credit: "Test photographer / Pixabay" });
});

test.each([
  ["pexels", "https://api.pexels.com/v1/curated", { photos: [] }],
  ["pixabay", "https://pixabay.com/api/", { hits: [] }],
  ["unsplash", "https://api.unsplash.com/photos", []],
] as const)("%s browses without a search term", async (source, endpoint, body) => {
  setKeys({ [source]: "test-key" });
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body)));
  expect(await searchImages(source, "   ")).toEqual([]);
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(`${url.origin}${url.pathname}`).toBe(endpoint);
  if (source === "pixabay") expect(url.searchParams.get("editors_choice")).toBe("true");
});

test.each(["pexels", "pixabay", "unsplash"] as const)("%s needs its own key and reports request errors without exposing it", async (source) => {
  await expect(searchImages(source, "stars")).rejects.toThrow(/API key/);
  expect(fetchMock).not.toHaveBeenCalled();
  setKeys({ [source]: "private-test-placeholder" });
  fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
  await expect(searchImages(source, "stars")).rejects.toThrow(/429/);
  await expect(searchImages(source, "stars")).rejects.not.toThrow("private-test-placeholder");
});

test("corrupt key storage cannot break Settings", () => {
  for (const invalid of ["null", "[]", '"string"', '{"pexels":42}', "invalid"]) {
    localStorage.setItem("rigel.keys", invalid);
    expect(getKeys()).toEqual({});
  }
});

test.each(["pexels", "pixabay", "picsum"] as const)("%s selection imports bytes locally instead of hotlinking", async source => {
  fetchMock.mockResolvedValueOnce(new Response(new Blob(["test image"], { type: "image/png" })));
  fetchMock.mockResolvedValueOnce(Response.json({ url: `/rigel-media/${"a".repeat(64)}.png` }));
  const url = await importStockImage({ source, url: `https://${{pexels: "images.pexels.com", pixabay: "cdn.pixabay.com", picsum: "picsum.photos"}[source]}/photo.png`, thumb: "", credit: "Photographer" });
  expect(url).toBe(`/rigel-media/${"a".repeat(64)}.png`);
  expect(fetchMock.mock.calls[1][0]).toBe("/rigel/api/local/media");
  expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  expect(await fetchMock.mock.calls[1][1].body.text()).toBe("test image");
});

test("URL imports download bytes, reject unsafe URLs and bound streamed input", async () => {
  for (const url of ["javascript:alert(1)", "//evil.test/image", "http://example.com/image", "https://user:password@example.com/image"]) {
    await expect(importImageUrl(url)).rejects.toThrow();
  }
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(new Response(new Blob(["url bytes"], {type: "image/png"})));
  fetchMock.mockResolvedValueOnce(Response.json({url: `/images/${"b".repeat(64)}.png`}));
  expect(await importImageUrl("https://example.com/image.png")).toBe(`/images/${"b".repeat(64)}.png`);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({credentials: "omit"});
  fetchMock.mockResolvedValueOnce(new Response(new Uint8Array(10 * 1024 * 1024 + 1), {headers: {"Content-Type": "image/png"}}));
  await expect(importImageUrl("https://example.com/large.png")).rejects.toThrow(/10 MB/);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(importImageUrl("https://example.com/blocked.png")).rejects.toThrow(/CORS/);
});

test("Unsplash selection records download and preserves the image hotlink", async () => {
  setKeys({ unsplash: "test-unsplash-key" });
  fetchMock.mockResolvedValue(new Response("{}"));
  const url = await importStockImage({ source: "unsplash", id: "photo-id", url: "https://images.unsplash.com/photo-id", thumb: "", credit: "Photographer" });
  expect(url).toBe("https://images.unsplash.com/photo-id");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.unsplash.com/photos/photo-id/download");
  expect(new Headers(fetchMock.mock.calls[0][1].headers).get("Authorization")).toBe("Client-" + "ID test-unsplash-key");
});

test("selection rejects unexpected hosts and unsuccessful imports", async () => {
  const image = { source: "pixabay" as const, url: "http://localhost/private", thumb: "", credit: "" };
  await expect(importStockImage(image)).rejects.toThrow(/URL/);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockResolvedValueOnce(new Response(new Blob(["test"], { type: "image/png" })));
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
  await expect(importStockImage({ ...image, url: "https://pixabay.com/get/photo.png" })).rejects.toThrow(/local dev/);
});
