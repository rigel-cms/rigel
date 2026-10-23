import { expect, test } from "vitest";
import { collectionPreviewValues, referenceLabel, referenceOptions, validateCollectionReferences } from "./references";
import type { CollectionField } from "./types";
import type { ContentDocument } from "../schema/types";

const documents: ContentDocument[] = [
  { id: "author:alex", type: "author", slug: "alex", data: { name: "Alex", description: "Editor", photo: "/alex.jpg", email: "alex@example.com", url: "https://example.com" } },
  { id: "author:studio", type: "author", slug: "studio", data: { name: "Studio" } },
  { id: "page:home", type: "page", slug: "home", data: { title: "Home" } },
];
const field: CollectionField = { key: "author", label: "Author", type: "reference", to: "author" };

test("resolves declared author records, metadata and ordered multiple names", () => {
  const options = referenceOptions(field, documents);
  expect(options).toHaveLength(2);
  expect(options[0]).toEqual({ value: "author:alex", label: "Alex", description: "Editor", photo: "/alex.jpg", email: "alex@example.com", url: "https://example.com" });
  expect(referenceLabel(["author:studio", "author:alex"], options)).toBe("Studio, Alex");
  expect(collectionPreviewValues([field], { author: "author:alex", title: "Article" }, documents)).toEqual({ author: "Alex", title: "Article" });
  expect(referenceLabel("missing", options)).toContain("Unavailable");
});

test("supports fixed config arrays without a document collection", () => {
  const fixed = { ...field, to: undefined, options: [{ value: "editor", label: "Editor" }] };
  expect(referenceOptions(fixed)).toEqual(fixed.options);
  expect(() => validateCollectionReferences([fixed], { author: "editor" }, [])).not.toThrow();
  expect(() => validateCollectionReferences([fixed], { author: "unknown" }, [])).toThrow(/existing/);
});

test("validates single and multiple references and rejects unknown, wrong-type and duplicate ids", () => {
  expect(() => validateCollectionReferences([field], { author: "author:alex" }, documents)).not.toThrow();
  expect(() => validateCollectionReferences([field], { author: "" }, documents)).not.toThrow();
  for (const author of [["author:alex"], "page:home", "author:missing", 3, null]) expect(() => validateCollectionReferences([field], { author }, documents)).toThrow();
  const multiple = { ...field, multiple: true };
  expect(() => validateCollectionReferences([multiple], { author: ["author:alex", "author:studio"] }, documents)).not.toThrow();
  expect(() => validateCollectionReferences([multiple], { author: [] }, documents)).not.toThrow();
  for (const author of ["author:alex", ["author:alex", "author:alex"], ["page:home"]]) expect(() => validateCollectionReferences([multiple], { author }, documents)).toThrow();
});
