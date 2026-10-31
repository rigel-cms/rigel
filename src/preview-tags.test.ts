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
    getAttribute: (name: string) => name === "data-rigel-doc" ? "profile:first" : null,
    replaceChildren: (...items: { textContent: string }[]) => { children = items; },
  };
  const doc = {
    documentElement: { children: [], hasAttribute: () => false, getAttribute: () => null },
    querySelectorAll: (selector: string) => selector === "[data-rigel-tags]" ? [element] : [],
    createElement: () => ({ textContent: "" }),
  } as unknown as Document;
  const documents = { "profile:first": { en: { tags: ' Design, , Research , <img onerror="alert(1)">, ' } } };
  patchPreview(doc, {}, "", { primary: "page-en:example", documents });
  expect(children.map(item => item.textContent)).toEqual(["Design", "Research", '<img onerror="alert(1)">']);
  documents["profile:first"].en.tags = "";
  patchPreview(doc, {}, "", { primary: "page-en:example", documents });
  expect(children).toEqual([]);
  patchPreview(doc, {}, "", { primary: "page-en:example", documents: { "profile:first": { en: { tags: "Writing" } } } });
  expect(children.map(item => item.textContent)).toEqual(["Writing"]);
  patchPreview(doc, { en: { tags: "Wrong owner" } }, "", { primary: "page-en:example", documents: {} });
  expect(children.map(item => item.textContent)).toEqual(["Writing"]);
});
