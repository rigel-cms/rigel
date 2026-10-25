import { expect, test } from "vitest";
import { filterMedia, modifiedMonth, mediaSize, mediaIcon } from "./media-library";
import { ICONS } from "./icons";

test("file icons follow the stored extension and supported category", () => {
  const expected = { pdf: "filePdf", doc: "fileDoc", docx: "fileDoc", txt: "fileTxt", rtf: "fileText", odt: "fileText", ppt: "filePpt", pptx: "filePpt", csv: "fileXls", xls: "fileXls", xlsx: "fileXls", ods: "fileXls", zip: "fileZip", gz: "fileZip", tar: "fileZip", rar: "fileZip", "7z": "fileZip", mp3: "fileAudio", wav: "fileAudio", ogg: "fileAudio", m4a: "fileAudio", mp4: "fileVideo", webm: "fileVideo", mov: "fileVideo" } as const;
  for (const [extension, icon] of Object.entries(expected)) {
    expect(mediaIcon(`stored.${extension.toUpperCase()}`)).toBe(icon);
    expect(ICONS[mediaIcon(`stored.${extension}`)].d.length).toBeGreaterThan(100);
  }
  expect(mediaIcon("unknown.bin")).toBe("file");
});

test("categories combine with search and modified dates", () => {
  const assets = ["photo.jpg", "song.mp3", "movie.mp4", "paper.pdf", "sheet.xlsx", "backup.zip"].map(name => ({name, url: "/"+name, modified: "2026-01-01T00:00:00Z"}));
  for (const [i, category] of ["Images", "Audio", "Video", "Documents", "Spreadsheets", "Archives"].entries()) {
    expect(filterMedia(assets, assets[i].name, category, "2026-01")).toEqual([assets[i]]);
    expect(filterMedia(assets, assets[i].name, category, "2025-01")).toEqual([]);
  }
  expect(filterMedia(assets, "", "", "")).toEqual(assets);
});

test("display names never determine the media category", () => {
  const categories = ["Images", "Audio", "Video", "Documents", "Spreadsheets", "Archives"];
  const files = ["image.png", "audio.mp3", "video.mp4", "document.pdf", "sheet.csv", "archive.zip"];
  for (const [index, category] of categories.entries()) for (const name of ["My renamed asset", "Misleading name.jpg"]) {
    const asset = { url: `/rigel-media/${files[index]}`, name };
    expect(filterMedia([asset], name, category, "")).toEqual([asset]);
    expect(filterMedia([asset], "", "Other", "")).toEqual([]);
    if (category !== "Images") expect(filterMedia([asset], "", "Images", "")).toEqual([]);
  }
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
