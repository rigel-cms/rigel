import { expect, test } from "vitest";
import { assertDocumentUnreferenced, isProtectedDocument } from "./deletion";
import { SchemaError, validateSchema } from "./validate";
import type { ContentDocument, DocumentDef, Schema } from "./types";

const page: DocumentDef = { name: "page", title: "Pages", type: "document", folder: "content/pages", fields: [{ key: "title", label: "Title", type: "string" }] };
const schema: Schema = { documents: [page], objects: [] };

test("protectedSlugs accepts only unique stable storage slugs", () => {
  for (const protectedSlugs of [undefined, [], ["home", "about-us"]]) {
    expect(() => validateSchema({ ...schema, documents: [{ ...page, protectedSlugs }] })).not.toThrow();
  }
  for (const protectedSlugs of [null, "home", ["home", "home"], ["../home"], ["/"], ["home.json"], ["About"], [""], [1], new Array(1)]) {
    expect(() => validateSchema({ ...schema, documents: [{ ...page, protectedSlugs } as DocumentDef] })).toThrow(/protectedSlugs/);
  }
});

test("policy protects required storage identities, not public URLs or JSON flags", () => {
  const type = { ...page, protectedSlugs: ["home"] };
  expect(isProtectedDocument(type, "home")).toBe(true);
  expect(isProtectedDocument(type, "new-page")).toBe(false);
  for (const policy of [{ shared: true }, { singleton: true }, { creatable: false }]) {
    expect(isProtectedDocument({ ...page, ...policy }, "anything")).toBe(true);
  }
  expect(isProtectedDocument(page, "home")).toBe(false);
});

test("reference guard covers nested and undeclared _ref values in remaining schema documents", () => {
  const target: ContentDocument = { id: "page:home", type: "page", slug: "home", data: { self: { _ref: "page:home" } } };
  expect(() => assertDocumentUnreferenced(schema, [target], target.id)).not.toThrow();
  const source = { id: "page:other", type: "page", slug: "other", data: { sections: [{ nested: { _ref: target.id } }] } };
  expect(() => assertDocumentUnreferenced(schema, [target, source], target.id, key => key)).toThrow(new SchemaError("local.documentReferenced"));
  expect(() => assertDocumentUnreferenced(schema, [{ ...source, data: { text: "page:home" } }], target.id)).not.toThrow();
});
