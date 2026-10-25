import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { listMedia, loadMediaSidecar, safeDisplayName, validateMetaUpdate, writeMediaSidecar, updateMediaSidecar } from "./media-files";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.resolve("_temp", "media-sidecar-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test.each([["photo.png", true], ["Team photo.jpg", true], ["a-b_c.1.png", true], ["", false], ["..", false], ["../evil", false], ["/abs", false], [".hidden", false], ["a b/c.png", false], ["x".repeat(121), false], [42, false], [undefined, false], ["x".repeat(120), true]])(
  "safeDisplayName %j", (value, expected) => expect(safeDisplayName(value)).toBe(expected),
);

test.each([
  [{ url: "/rigel-media/ok.png", name: "Nice" }, "ok"],
  [{ url: "/rigel-media/ok.png", name: "../evil" }, "Invalid display name"],
  [{ url: "/rigel-media/ok.png", name: "x".repeat(200) }, "Invalid display name"],
  [{ url: "/rigel-media/ok.png", title: 5 }, "Title must be a string"],
  [{ url: "/rigel-media/ok.png", author: "Hacker" }, "Unknown metadata field"],
  [{ url: "/rigel-media/missing.png", name: "X" }, "Unknown asset"],
  [{ url: "/rigel-media/ok.png", name: "x", bogus: true }, "Unknown metadata field"],
  [null, "Invalid request body"],
  ["nope", "Invalid request body"],
  [{ url: "/rigel-media/ok.png", name: "  Spaced  " }, "ok"],
  [{ url: "/rigel-media/ok.png", title: "  \u0000A\u0007  Tail ", description: "d".repeat(5) }, "ok"],
])("validateMetaUpdate %j", async (body, expected) => {
  const value = validateMetaUpdate(body, new Set(["/rigel-media/ok.png"]));
  if (expected === "ok") {
    expect(value.ok).toBe(true);
    if (!value.ok) return;
    if (body && typeof body === "object" && "name" in body) expect(value.value.name).toBe(String(body.name).trim());
  } else {
    expect(value.ok).toBe(false);
    if (value.ok) return;
    expect(value.error).toBe(expected);
  }
});

test("image alt text is validated, persisted, listed and clearable without changing bytes", async () => {
  const url = "/rigel-media/alt.png";
  const existing = new Set([url, "/rigel-media/document.pdf"]);
  const update = validateMetaUpdate({ url, alt: "  A bright studio\u0000  " }, existing);
  expect(update).toEqual({ ok: true, value: { url, alt: "A bright studio" } });
  expect(validateMetaUpdate({ url, alt: "" }, existing)).toEqual({ ok: true, value: { url, alt: "" } });
  expect(validateMetaUpdate({ url, alt: "Line one\nLine two" }, existing)).toEqual({ ok: true, value: { url, alt: "Line one Line two" } });
  expect(validateMetaUpdate({ url, alt: 5 }, existing).ok).toBe(false);
  expect(validateMetaUpdate({ url: "/rigel-media/document.pdf", alt: "Document" }, existing).ok).toBe(false);
  await mkdir(path.join(dir, "rigel-media"));
  await writeFile(path.join(dir, "rigel-media/alt.png"), "unchanged");
  await writeMediaSidecar(path.join(dir, "rigel-media"), { [url]: { alt: "A bright studio" } });
  expect((await listMedia(pathToFileURL(dir + "/").href))[0].alt).toBe("A bright studio");
  expect(await readFile(path.join(dir, "rigel-media/alt.png"), "utf8")).toBe("unchanged");
});

test("loadMediaSidecar returns {} when absent and merges persisted fields", async () => {
  expect(await loadMediaSidecar(dir)).toEqual({});
  await writeFile(path.join(dir, ".rigel-media.json"), JSON.stringify({
    "/rigel-media/a.png": { name: "A", title: "T", description: "D", author: "Ada" },
    "/rigel-media/b.png": { name: "  Padded  ", author: 7 },
    "/rigel-media/nested/x.csv": { title: "X" },
    "/rigel-media/junk.png": "not an object",
  }));
  expect(await loadMediaSidecar(dir)).toEqual({
    "/rigel-media/a.png": { name: "A", title: "T", description: "D", author: "Ada" },
    "/rigel-media/b.png": { name: "Padded" },
    "/rigel-media/nested/x.csv": { title: "X" },
  });
});

test("loadMediaSidecar tolerates malformed JSON", async () => {
  await writeFile(path.join(dir, ".rigel-media.json"), "{ not json");
  expect(await loadMediaSidecar(dir)).toEqual({});
});

test("writeMediaSidecar writes atomically with no temp residue", async () => {
  await writeMediaSidecar(dir, { "/rigel-media/a.png": { name: "A", author: "Ada" } });
  expect(JSON.parse(await readFile(path.join(dir, ".rigel-media.json"), "utf8"))).toEqual({ "/rigel-media/a.png": { name: "A", author: "Ada" } });
  const files = await readdir(dir);
  expect(files.filter(f => f.includes(".tmp"))).toEqual([]);
});

test("queued metadata updates recover from failed writes and merge concurrent edits", async () => {
  await expect(updateMediaSidecar(path.join(dir, "missing"), "/file.pdf", {})).rejects.toThrow();
  await Promise.all([
    updateMediaSidecar(dir, "/file.pdf", { title: "Document title" }, { name: "Document.pdf" }),
    updateMediaSidecar(dir, "/file.pdf", { description: "Document description" }, { name: "Do not replace the name.pdf" }),
  ]);
  expect(await loadMediaSidecar(dir)).toEqual({ "/file.pdf": { name: "Document.pdf", title: "Document title", description: "Document description" } });
});

test("listMedia merges sidecar display name/fields, skips the dotfile and preserves real file", async () => {
  const publicUrl = pathToFileURL(`${dir}/public/`).href;
  const mediaDir = path.join(dir, "public", "rigel-media");
  await mkdir(mediaDir, { recursive: true });
  await writeFile(path.join(mediaDir, `${"a".repeat(64)}.png`), Buffer.from("x"));
  await writeFile(path.join(mediaDir, `${"b".repeat(64)}.csv`), Buffer.from("y"));
  await writeMediaSidecar(mediaDir, {
    [`/rigel-media/${"a".repeat(64)}.png`]: { name: "Hero shot", title: "Hero", description: "Top", author: "Ada" },
  });
  const assets = await listMedia(publicUrl, "rigel-media");
  const hero = assets.find(a => a.url === `/rigel-media/${"a".repeat(64)}.png`);
  expect(hero?.name).toBe("Hero shot");
  expect(hero?.title).toBe("Hero");
  expect(hero?.description).toBe("Top");
  expect(hero?.author).toBe("Ada");
  expect(hero?.url).toBe(`/rigel-media/${"a".repeat(64)}.png`);
  const csv = assets.find(a => a.url === `/rigel-media/${"b".repeat(64)}.csv`);
  expect(csv?.name).toBe(`${"b".repeat(64)}.csv`);
  expect(csv?.author).toBeUndefined();
  expect(await readdir(mediaDir)).toEqual([`.rigel-media.json`, `${"a".repeat(64)}.png`, `${"b".repeat(64)}.csv`]);
  expect(await readFile(path.join(mediaDir, `${"a".repeat(64)}.png`), "utf8")).toBe("x");
});

test("listMedia handles missing media directory as empty", async () => {
  const publicUrl = pathToFileURL(`${dir}/public/`).href;
  expect(await listMedia(publicUrl, "rigel-media")).toEqual([]);
});