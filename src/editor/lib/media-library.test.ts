import { expect, test } from "vitest";
import { filterMedia, modifiedMonth, mediaSize } from "./media-library";

test("categories combine with search and modified dates", () => {
  const assets = ["photo.jpg", "song.mp3", "movie.mp4", "paper.pdf", "sheet.xlsx", "backup.zip"].map(name => ({name, url: "/"+name, modified: "2026-01-01T00:00:00Z"}));
  for (const [i, category] of ["Images", "Audio", "Video", "Documents", "Spreadsheets", "Archives"].entries()) {
    expect(filterMedia(assets, assets[i].name, category, "2026-01")).toEqual([assets[i]]);
    expect(filterMedia(assets, assets[i].name, category, "2025-01")).toEqual([]);
  }
  expect(filterMedia(assets, "", "", "")).toEqual(assets);
});

test("combines filename, format and real modified month; missing metadata is safe", () => {
  const assets = [
    {url: "/a.png", name: "A.png", type: "image/png", modified: "2024-02-15T12:00:00Z", size: 7},
    {url: "/b.jpg", name: "A.jpg", type: "image/jpeg", modified: "2024-02-15T12:00:00Z"},
    {url: "/c.png", name: "C.png", type: "image/png", modified: "2024-03-15T12:00:00Z"},
    {url: "/old.png", name: "Old.png"},
  ];
  expect(filterMedia(assets, "a", "image/png", "2024-02")).toEqual([assets[0]]);
  expect(filterMedia(assets, "c", "image/png", "2024-02")).toEqual([]);
  expect(filterMedia(assets, "", "", "")).toEqual(assets);
  expect(modifiedMonth(undefined)).toBe("");
  expect(modifiedMonth("bad")).toBe("");
  expect(mediaSize(undefined)).toBe("—");
  expect(mediaSize(-1)).toBe("—");
  expect(mediaSize(0)).toBe("0 B");
  expect(mediaSize(2048)).toBe("2 KB");
});
