import { expect, test } from "vitest";
import { collectionPreviewValues, entryUsage, referenceLabel, referenceOptions, validateCollectionReferences } from "./references";
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

test("entry usage links nested document and article references once per entry", () => {
  const manifest: import("./types").Manifest = {
    pages: [],
    schema: { objects: [], documents: [
      { name: "author", title: "Authors", type: "document", folder: "authors", fields: [] },
      { name: "page", title: "Pages", type: "document", folder: "pages", fields: [], locale: "fr" },
    ] },
    documents: [
      { ...documents[0], data: { name: "Alex", self: { _ref: "author:alex" } } },
      { id: "page:home", type: "page", slug: "home", data: { title: "Accueil", sections: [{ _type: "hero", nested: [{ _ref: "author:alex" }, { _ref: "author:alex" }] }] } },
      { id: "page:plain", type: "page", slug: "plain", data: { title: "Plain", text: 'author:alex and "_ref":"author:alex"' } },
    ],
    collections: [{ name: "blog", label: "Blog", locale: "en", fields: [field, { ...field, key: "editors", multiple: true }, { key: "text", label: "Text", type: "string" }], posts: [
      { slug: "one", frontmatter: { title: "One", author: "author:alex", editors: ["author:alex"] } },
      { slug: "two", frontmatter: { editors: ["author:studio", "author:alex"] } },
      { slug: "no", frontmatter: { text: "author:alex", author: "author:alexander" } },
    ] }],
  };
  expect(entryUsage(manifest, "author:alex")).toEqual({ complete: true, entries: [
    { label: "Accueil", group: "Pages", locale: "fr", target: { kind: "document", type: "page", id: "page:home" } },
    { label: "One", group: "Blog", locale: "en", target: { kind: "post", collection: "blog", slug: "one" } },
    { label: "two", group: "Blog", locale: "en", target: { kind: "post", collection: "blog", slug: "two" } },
  ] });
  expect(entryUsage(manifest, "author:missing").entries).toEqual([]);
});

test("entry usage does not claim zero references while documents or reference collections are unindexed", () => {
  const manifest: import("./types").Manifest = { pages: [], schema: { objects: [], documents: [
    { name: "page", title: "Pages", type: "document", folder: "pages", fields: [] },
  ] }, documents: [
    { id: "page:home", type: "page", slug: "home", loaded: "metadata", data: { title: "Home", _references: [{ _ref: "author:alex" }] } },
    { id: "page:other", type: "page", slug: "other", loaded: "identity", data: {} },
  ] };
  expect(entryUsage(manifest, "author:alex").entries.map(entry => entry.label)).toEqual(["Home"]);
  expect(entryUsage(manifest, "author:alex").complete).toBe(false);
  manifest.documents![1].loaded = "metadata";
  expect(entryUsage(manifest, "author:alex").complete).toBe(true);
  manifest.collections = [{ name: "blog", label: "Blog", fields: [field], posts: [], index: { state: "error", loaded: 0, total: 1 } }];
  expect(entryUsage(manifest, "author:alex").complete).toBe(false);
  manifest.collections[0].index!.state = "complete";
  expect(entryUsage(manifest, "author:alex").complete).toBe(true);
  manifest.collections[0].fields = [];
  manifest.collections[0].index!.state = "pending";
  expect(entryUsage(manifest, "author:alex").complete).toBe(true);
});

test("entry usage ignores fixed-choice references even when an option matches a document id", () => {
  const manifest: import("./types").Manifest = { pages: [], collections: [{
    name: "legacy", label: "Legacy", fields: [{ ...field, to: undefined, options: [{ value: "author:alex", label: "Legacy author" }] }],
    posts: [{ slug: "one", frontmatter: { author: "author:alex" } }], index: { state: "pending", loaded: 0, total: 1 },
  }] };
  expect(entryUsage(manifest, "author:alex")).toEqual({ entries: [], complete: true });
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

test("article identity never aliases a schema document with the same type and slug", () => {
  const manifest: import("./types").Manifest = { pages: [], schema: { objects: [], documents: [{ name: "blog", title: "Blog pages", type: "document", folder: "pages", fields: [] }] }, documents: [
    { id: "blog:source", type: "blog", slug: "source", data: { title: "Source", target: { _ref: "blog:test" } } },
  ], collections: [{ name: "blog", label: "Blog", fields: [], posts: [{ slug: "test", frontmatter: {} }] }] };
  expect(entryUsage(manifest, { kind: "post", collection: "blog", slug: "test" })).toEqual({ entries: [], complete: true });
  expect(entryUsage(manifest, { kind: "document", type: "blog", id: "blog:test" }).entries).toHaveLength(1);
  expect(entryUsage(manifest, "blog:test").entries).toHaveLength(1);
});
