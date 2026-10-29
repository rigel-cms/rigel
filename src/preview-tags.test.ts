import { expect, test } from "vitest";
import { patchPreview } from "./preview";

test("preview patch tolerates a frame document during navigation", () => {
  expect(() => patchPreview({ documentElement: null } as unknown as Document, {}, "")).not.toThrow();
});

test("comma-separated tags trim blanks, preserve literal text and follow shared document ownership", () => {
  let children: { textContent: string }[] = [];
  const element = {
    tagName: "UL",
    dataset: { rigelTags: "en.tags" },
    getAttribute: (name: string) => name === "data-rigel-doc" ? "trainer:first" : null,
    replaceChildren: (...items: { textContent: string }[]) => { children = items; },
  };
  const doc = {
    documentElement: { children: [], hasAttribute: () => false, getAttribute: () => null },
    querySelectorAll: (selector: string) => selector === "[data-rigel-tags]" ? [element] : [],
    createElement: () => ({ textContent: "" }),
  } as unknown as Document;
  const documents = { "trainer:first": { en: { tags: ' Boxing, , Pilates , <img onerror="alert(1)">, ' } } };
  patchPreview(doc, {}, "", { primary: "page-en:gym", documents });
  expect(children.map(item => item.textContent)).toEqual(["Boxing", "Pilates", '<img onerror="alert(1)">']);
  documents["trainer:first"].en.tags = "";
  patchPreview(doc, {}, "", { primary: "page-en:gym", documents });
  expect(children).toEqual([]);
  patchPreview(doc, {}, "", { primary: "page-en:gym", documents: { "trainer:first": { en: { tags: "Strength" } } } });
  expect(children.map(item => item.textContent)).toEqual(["Strength"]);
  patchPreview(doc, { en: { tags: "Wrong owner" } }, "", { primary: "page-en:gym", documents: {} });
  expect(children.map(item => item.textContent)).toEqual(["Strength"]);
});
