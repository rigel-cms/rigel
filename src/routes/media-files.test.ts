import { expect, test } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile, utimes, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { listMedia, mediaDirectory, mediaFolder } from "./media-files";
import { safeImageUrl } from "../editor/lib/images";

test("lists existing nested images, omits symlinks and non-images, validates folder boundaries", async () => {
  await mkdir("_temp", {recursive: true});
  const root = await mkdtemp(path.resolve("_temp/media-test-"));
  const publicDir = pathToFileURL(root + "/").href;
  try {
    await mkdir(path.join(root, "assets/nested"), {recursive: true});
    await writeFile(path.join(root, "assets/nested/existing image.png"), "fixture");
    await writeFile(path.join(root, "assets/private.txt"), "private");
    await writeFile(path.join(root, "assets/script.svg"), "<svg/>");
    await symlink(path.join(root, "assets/nested/existing image.png"), path.join(root, "assets/link.png"));
    await symlink(path.join(root, "assets"), path.join(root, "escape"));
    const file = path.join(root, "assets/nested/existing image.png");
    await utimes(file, new Date("2024-02-15T12:00:00Z"), new Date("2024-02-15T12:00:00Z"));
    const info = await stat(file);
    expect(await listMedia(publicDir, "assets")).toEqual([{name: "nested/existing image.png", url: "/assets/nested/existing%20image.png", type: "image/png", size: info.size, modified: info.mtime.toISOString()}]);
    await expect(mediaDirectory(publicDir, "escape", true)).rejects.toThrow("Unsafe");
    for (const folder of ["../escape", "/assets", "assets/../escape", "assets\\escape", "", "assets//nested"]) expect(() => mediaFolder(folder)).toThrow();
    expect(await listMedia(publicDir, "missing")).toEqual([]);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test("image URLs reject active schemes, credentials and ambiguous slashes", () => {
  for (const url of ["javascript:alert(1)", "data:image/svg+xml,x", "//evil.test/x", "/\\evil.test", "https://user:pass@example.com/x", "mailto:a@b", ""]) expect(safeImageUrl(url)).toBe(false);
  for (const url of ["/assets/a%20b.png", "https://images.example.com/a.jpg"]) expect(safeImageUrl(url)).toBe(true);
});
