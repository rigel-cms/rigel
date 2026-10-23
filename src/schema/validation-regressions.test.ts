import { describe, expect, test } from "vitest";
import { validateDocument, validateSchema } from "./validate";
import type { ArrayItem, FieldDef } from "./types";

function withArray(items: ArrayItem[], bounds: Partial<FieldDef> = {}) {
  return validateSchema({
    documents: [{ name: "sample", title: "Samples", type: "document", folder: "content/samples", fields: [
      { key: "items", label: "Items", type: "array", items, ...bounds },
    ] }],
    objects: [],
  });
}

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
