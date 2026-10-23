import { expect, test } from "vitest";
import { newDocumentFromTemplate } from "./paths";
import type { Schema } from "./types";

const schema: Schema = {
  documents: [{
    name: "page", title: "Pages", type: "document", folder: "content/pages",
    fields: [
      { key: "title", label: "Title", type: "string", initialValue: "Field title" },
      { key: "description", label: "Description", type: "string", initialValue: "Field description" },
      { key: "fallback", label: "Fallback", type: "string", initialValue: "Field fallback" },
      { key: "enabled", label: "Enabled", type: "boolean", initialValue: true },
      { key: "count", label: "Count", type: "number", initialValue: 9 },
      { key: "items", label: "Items", type: "array", items: [{ type: "string" }], initialValue: ["fallback"] },
      { key: "sections", label: "Sections", type: "array", items: [{ type: "object", name: "hero" }] },
    ],
    initialValue: {
      _id: "page:old", _type: "old", slug: "old", title: "Document title",
      description: "Document description", enabled: false, count: 0, items: [],
      sections: [{ _key: "kold", _type: "hero", heading: "Document section" }],
      settings: { nested: [{ _key: "kdocument", _ref: "shared:stable" }] },
    },
    template: [{ type: "hero", values: { heading: "Template heading" } }],
  }],
  objects: [{ name: "hero", title: "Hero", type: "section", fields: [
    { key: "heading", label: "Heading", type: "string", initialValue: "Section default" },
    { key: "subheading", label: "Subheading", type: "string", initialValue: "Section fallback" },
  ] }],
};

function keysIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysIn);
  if (value === null || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [typeof object._key === "string" ? [object._key] : [], ...Object.values(object).map(keysIn)].flat();
}

test("recursively clones and refreshes keys from document, field, section and template defaults", () => {
  const source = structuredClone(schema);
  const nested = { _key: "kouter", payload: { rows: [
    { _key: "kinner", children: [{ _key: "kref", _ref: "shared:stable" }] },
  ] } };
  source.documents[0].fields.push({ key: "defaults", label: "Defaults", type: "object", initialValue: nested });
  source.objects[0].fields.push(
    { key: "defaults", label: "Defaults", type: "object", initialValue: nested },
    { key: "custom", label: "Custom", type: "object", initialValue: { unused: true } },
  );
  source.documents[0].template = [
    { type: "hero", values: { custom: nested } },
    { type: "hero", values: { custom: nested } },
  ];
  const before = structuredClone(source);
  const first = newDocumentFromTemplate(source, "page", "First", "first");
  const second = newDocumentFromTemplate(source, "page", "Second", "second");
  const originalKeys = new Set(keysIn(source));
  const generatedKeys = [...keysIn(first), ...keysIn(second)];
  expect(generatedKeys).toHaveLength(36);
  expect(new Set(generatedKeys).size).toBe(generatedKeys.length);
  expect(generatedKeys.every((key) => !originalKeys.has(key))).toBe(true);
  expect(source).toEqual(before);
  expect(first.defaults).not.toBe(nested);
  expect(first.settings).not.toBe(source.documents[0].initialValue!.settings);
  const firstSections = first.sections as Record<string, unknown>[];
  expect(firstSections[0].custom).not.toBe(firstSections[1].custom);
  expect(firstSections[0].custom).not.toBe(firstSections[0].defaults);
  const firstDefaults = first.defaults as typeof nested;
  const secondDefaults = second.defaults as typeof nested;
  expect(firstDefaults.payload.rows[0].children[0]._ref).toBe("shared:stable");
  firstDefaults.payload.rows[0].children[0]._ref = "shared:changed";
  expect(secondDefaults.payload.rows[0].children[0]._ref).toBe("shared:stable");
  expect(source).toEqual(before);
});

test("document defaults override field defaults while identity, title and template stay explicit", () => {
  const doc = newDocumentFromTemplate(schema, "page", "Entered title", "fresh");
  expect(doc).toMatchObject({
    _id: "page:fresh", _type: "page", slug: "fresh", title: "Entered title",
    description: "Document description", fallback: "Field fallback", enabled: false, count: 0, items: [],
    settings: { nested: [{ _ref: "shared:stable" }] },
    sections: [{ _type: "hero", heading: "Template heading", subheading: "Section fallback" }],
  });
  const withoutTemplate = structuredClone(schema);
  delete withoutTemplate.documents[0].template;
  expect(newDocumentFromTemplate(withoutTemplate, "page", "Entered title", "fresh").sections)
    .toMatchObject([{ _type: "hero", heading: "Document section" }]);
});
