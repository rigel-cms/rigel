import { describe, expect, test } from "vitest";
import { documentDef, documentIndex, objectDef, SchemaError, validateDocument, validateSchema } from "./validate";
import type { ArrayItem, FieldDef } from "./types";
import { emptyBody, validateBody } from "../article-body";
import { assertUniqueUrlSlugs, effectiveSlug, normalizeUrlSlug, validateDocumentSlugs } from "../slugs";
import { validateMenu } from "../manifest/menu";
import { validateCollectionValues } from "../manifest/collections";
import { validateCollectionReferences } from "../manifest/references";
import type { Translator } from "../editor/i18n/format";

function withArray(items: ArrayItem[], bounds: Partial<FieldDef> = {}) {
  return validateSchema({
    documents: [{ name: "sample", title: "Samples", type: "document", folder: "content/samples", fields: [
      { key: "items", label: "Items", type: "array", items, ...bounds },
    ] }],
    objects: [],
  });
}

test("shared validators use the supplied translator through nested validation", () => {
  const message: Translator = (key, parameters) => `${key}|${JSON.stringify(parameters ?? {})}`;
  const schema = withArray([{ type: "object", fields: [{ key: "label", label: "User label", type: "string", required: true }] }]);
  expect(() => validateDocument(schema, "sample", "one", { items: [{ _key: "kone" }] }, [], message)).toThrow(new SchemaError('validation.schema.required|{"path":"one.items[0].label"}'));
  expect(() => validateDocument(schema, "sample", "one", JSON.parse('{"nested":{"constructor":1}}'), [], message)).toThrow('validation.schema.unsafeKey|{"path":"one.nested","key":"constructor"}');
  expect(() => objectDef(schema, "missing", message)).toThrow('validation.schema.unknownObject|{"path":"missing"}');
  expect(() => documentDef(schema, "missing", message)).toThrow('validation.schema.unknownDocument|{"path":"missing"}');
  const doc = { id: "sample:one", type: "sample", slug: "one", data: {} };
  expect(() => documentIndex([doc, doc], message)).toThrow('validation.schema.duplicateDocument|{"id":"sample:one"}');
  const linked = withArray([{ type: "object", fields: [{ key: "link", label: "User label", type: "reference", to: ["sample"] }] }]);
  const items = [{ _key: "kone", link: { _ref: doc.id } }];
  expect(() => validateDocument(linked, "sample", "one", { items }, [doc], message)).toThrow('validation.schema.selfReference|{"path":"sample:one.items[0]"}');
  expect(() => validateDocument(linked, "sample", "two", { items }, [], message)).toThrow('validation.schema.unresolvedTarget|{"path":"two.items[0].link","ref":"sample:one"}');
  const body = emptyBody();
  body.root.children[0] = { type: "unknown", version: 1 };
  expect(() => validateBody(body, message)).toThrow("validation.body.unsupportedBlock|{}");
  const item = { id: "home", label: "User label", url: "/", children: [] };
  expect(() => validateMenu({ slug: "nav", title: "User title", items: [{ ...item, children: [item] }] }, 1, message)).toThrow('validation.menu.depth|{"maxDepth":1}');
  expect(() => normalizeUrlSlug("!!!", message)).toThrow("validation.slug.required|{}");
  expect(() => effectiveSlug({ slug: "!!!" }, "one", message)).toThrow("validation.slug.invalid|{}");
  expect(() => assertUniqueUrlSlugs([{ slug: "one", values: { slug: "!!!" } }], message)).toThrow("validation.slug.invalid|{}");
  expect(() => validateDocumentSlugs(schema, [{ ...doc, data: { slug: "!!!" } }], undefined, message)).toThrow("validation.slug.invalid|{}");
  expect(() => assertUniqueUrlSlugs([{ slug: "one", values: {} }, { slug: "one", values: {} }], message)).toThrow('validation.slug.duplicate|{"slug":"one"}');
  expect(() => validateDocumentSlugs(schema, [doc, doc], undefined, message)).toThrow('validation.slug.duplicate|{"slug":"one"}');
  const reference = { key: "author", label: "User label", type: "reference" as const, options: [{ value: "alex", label: "Alex" }] };
  expect(() => validateCollectionReferences([reference], { author: "missing" }, [], message)).toThrow('system.reference.existingOnly|{"label":"User label"}');
  expect(() => validateCollectionValues([reference], { author: [] }, [], message)).toThrow('system.reference.expectedOne|{"label":"User label"}');
  expect(() => validateCollectionValues([{ key: "title", label: "User label", type: "string", required: true }], {}, [], message)).toThrow('validation.collection.required|{"label":"User label"}');
});

test("shared validation keeps exact default English exception messages", () => {
  const schema = withArray([{ type: "string" }], { min: 1 });
  expect(() => validateDocument(schema, "sample", "one", { items: [] }, [])).toThrow(new SchemaError("one.items: needs at least 1 items"));
  expect(() => objectDef(schema, "missing")).toThrow(new SchemaError("missing: unknown object type"));
  expect(() => validateBody(null)).toThrow(new Error("Expected a Lexical article body"));
  expect(() => validateMenu(null, 3)).toThrow(new Error("Menu requires a lowercase alphanumeric-hyphen slug, title, and items array"));
  expect(() => normalizeUrlSlug("!!!")).toThrow(new Error("URL slug must contain letters or numbers."));
  expect(() => effectiveSlug({ slug: "!!!" }, "one")).toThrow(new Error("Invalid URL slug; use lowercase letters, numbers and single dashes."));
  expect(() => assertUniqueUrlSlugs([{ slug: "one", values: {} }, { slug: "one", values: {} }])).toThrow(new Error('URL slug "one" is already used.'));
  expect(() => validateCollectionValues([{ key: "title", label: "User label", type: "string", required: true }], {})).toThrow(new Error("User label: required"));
  expect(() => validateCollectionValues([{ key: "title", label: "User label", type: "string" }], { title: 1 })).toThrow(new Error("User label: expected string"));
  const linked = withArray([{ type: "reference", to: ["sample"] }]);
  linked.documents.push(...["author", "page"].map(name => ({ ...linked.documents[0], name, folder: name })));
  linked.documents[0].fields[0].items = [{ type: "reference", to: ["sample", "author", "page"] }];
  expect(() => validateDocument(linked, "sample", "one", { items: [{ _key: "kone", _ref: "other:one" }] }, [])).toThrow(new SchemaError("one.items[0]: reference must target sample or author or page"));
});

describe("additional schema scalars", () => {
  const cases = [
    { type: "color" as const, valid: ["", "#0af", "#A0F", "#00aAfF"], invalid: ["blue", "#abcd", "#12345678", "#123456\n", 123, false, null] },
    { type: "code" as const, valid: ["", "const x = 1;\n", "<script>alert('inert')</script>"], invalid: [123, false, null, {}] },
    { type: "password" as const, valid: ["", "demo-only-not-a-real-key", " spaces\nare preserved "], invalid: [123, false, null, {}] },
  ];
  test.each(cases)("accepts $type strings, including empty values", ({ type, valid }) => {
    const schema = validateSchema({ documents: [{ name: "sample", title: "Samples", type: "document", folder: "content/samples", fields: [{ key: "value", label: "Value", type }] }], objects: [] });
    for (const value of valid) expect(validateDocument(schema, "sample", "one", { value }, [])).toEqual({ value });
    const arraySchema = withArray([{ type }]);
    expect(() => validateDocument(arraySchema, "sample", "one", { items: valid }, [])).not.toThrow();
  });
  test.each(cases)("rejects invalid $type values", ({ type, invalid }) => {
    const schema = validateSchema({ documents: [{ name: "sample", title: "Samples", type: "document", folder: "content/samples", fields: [{ key: "value", label: "Value", type }] }], objects: [] });
    for (const value of invalid) expect(() => validateDocument(schema, "sample", "one", { value }, [])).toThrow(`must be a ${type}`);
    const arraySchema = withArray([{ type }]);
    for (const value of invalid) expect(() => validateDocument(arraySchema, "sample", "one", { items: [value] }, [])).toThrow();
  });
});

describe("array bounds", () => {
  test("enforces optional array bounds only when present", () => {
    const schema = withArray([{ type: "string" }], { min: 1, max: 2 });
    expect(() => validateDocument(schema, "sample", "one", {}, [])).not.toThrow();
    expect(() => validateDocument(schema, "sample", "one", { items: ["a"] }, [])).not.toThrow();
    expect(() => validateDocument(schema, "sample", "one", { items: ["a", "b"] }, [])).not.toThrow();
    expect(() => validateDocument(schema, "sample", "one", { items: [] }, [])).toThrow(/at least 1/);
    expect(() => validateDocument(schema, "sample", "one", { items: ["a", "b", "c"] }, [])).toThrow(/at most 2/);
  });

  test("required arrays reject missing and empty values independently of min", () => {
    const schema = withArray([{ type: "string" }], { required: true, min: 0 });
    expect(() => validateDocument(schema, "sample", "one", {}, [])).toThrow(/required/);
    expect(() => validateDocument(schema, "sample", "one", { items: [] }, [])).toThrow(/required/);
    const optional = withArray([{ type: "string" }], { min: 0, max: 1 });
    expect(() => validateDocument(optional, "sample", "one", { items: [] }, [])).not.toThrow();
    expect(() => validateDocument(optional, "sample", "one", { items: ["a", "b"] }, [])).toThrow(/at most 1/);
  });
});

describe("scalar array validation", () => {
  test.each([
    { type: "number" as const, valid: [0, -2, 3.5], invalid: ["3", true, null, NaN, Infinity] },
    { type: "boolean" as const, valid: [true, false], invalid: ["false", 0, null] },
    { type: "string" as const, valid: ["", "hello"], invalid: [false, 2, null] },
  ])("preserves $type array item types", ({ type, valid, invalid }) => {
    const schema = withArray([{ type }]);
    expect(() => validateDocument(schema, "sample", "one", { items: valid }, [])).not.toThrow();
    for (const value of invalid) {
      expect(() => validateDocument(schema, "sample", "one", { items: [value] }, [])).toThrow();
    }
  });

  test("matches each heterogeneous scalar against its declared type", () => {
    const schema = withArray([{ type: "number" }, { type: "boolean" }, { type: "url" }, { type: "date" }]);
    expect(() => validateDocument(schema, "sample", "one", { items: [4, false, "/about/", "2026-10-20"] }, [])).not.toThrow();
    for (const value of ["not-a-url-or-date", "javascript:alert(1)", null, {}, NaN]) {
      expect(() => validateDocument(schema, "sample", "one", { items: [value] }, [])).toThrow();
    }
  });

  test("matches mixed object, reference and scalar items", () => {
    const schema = withArray([
      { type: "number" }, { type: "boolean" },
      { type: "reference", to: ["sample"] },
      { type: "object", fields: [{ key: "label", label: "Label", type: "string", required: true }] },
    ]);
    const target = { id: "sample:target", type: "sample", slug: "target", data: {} };
    expect(() => validateDocument(schema, "sample", "one", { items: [
      4, false, { _key: "kref", _ref: target.id }, { _key: "kobj", label: "Object" },
    ] }, [target])).not.toThrow();
  });
});
