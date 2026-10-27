import { expect, test } from "vitest";
import { parseConfig } from "../config";
import { isSeoField, withSeoFields } from "./seo";
import { validateDocument } from "../schema/validate";
import defaults from "../editor/i18n/en/defaults.json";

const title = { key: "title", label: "Title", type: "string" as const };

test("every website document and article receives SEO fields, but shared records do not", () => {
  const schema = { documents: [
    { name: "page", title: "Pages", type: "document" as const, folder: "pages", fields: [title] },
    { name: "author", title: "Authors", type: "document" as const, folder: "authors", shared: true, fields: [title] },
  ], objects: [] };
  const config = parseConfig({ schema, collections: [{ name: "blog", folder: "blog", fields: [title] }] });
  expect(config.schema?.documents[0].fields.map(field => field.key)).toEqual(["title", "metaTitle", "description", "ogImage", "draft"]);
  expect(config.schema?.documents[1].fields).toEqual([title]);
  expect(config.collections?.[0].fields.map(field => field.key)).toEqual(["title", "metaTitle", "description", "ogImage"]);
  expect(schema.documents[0].fields).toEqual([title]);
  expect(parseConfig(config)).toEqual(config);
});

test("social images use the SEO image field and optional images can be cleared", () => {
  const field = { key: "ogImage", label: "Social image", type: "image" as const };
  expect(withSeoFields([title]).find(item => item.key === "ogImage")).toEqual({ ...field, labelKey: "defaults.socialImage" });
  expect(isSeoField("ogImage")).toBe(true);
  const schema = { documents: [{ name: "page", title: "Pages", type: "document" as const, folder: "pages", fields: [field] }], objects: [] };
  expect(validateDocument(schema, "page", "home", { ogImage: "" }, [])).toEqual({ ogImage: "" });
  expect(() => validateDocument({ ...schema, documents: [{ ...schema.documents[0], fields: [{ ...field, required: true }] }] }, "page", "home", { ogImage: "" }, [])).toThrow(/required/);
  expect(() => validateDocument(schema, "page", "home", { ogImage: "javascript:alert(1)" }, [])).toThrow(/image/);
});

test("preserves declared SEO fields and avoids duplicates", () => {
  const custom = { key: "metaTitle", label: "Browser title", type: "string" as const, required: true };
  const fields = withSeoFields([title, custom]);
  expect(fields.filter(field => field.key === "metaTitle")).toEqual([custom]);
  expect(withSeoFields(fields)).toEqual(fields);
});

test("only injected labels carry translation keys, including after JSON serialization", () => {
  const schema = { documents: [{ name: "page", title: "Pages", type: "document" as const, folder: "pages", fields: [title] }], objects: [] };
  const config = parseConfig({ schema, collections: [{ name: "blog", folder: "blog", fields: [title] }] });
  const fields = config.schema!.documents[0].fields;
  expect(fields[0]).toBe(title);
  expect(fields.filter(field => field.labelKey).map(field => [field.key, field.labelKey])).toEqual([
    ["metaTitle", "defaults.seoTitle"], ["description", "defaults.seoDescription"], ["ogImage", "defaults.socialImage"], ["draft", "defaults.draft"],
  ]);
  for (const field of [...fields, ...config.collections![0].fields]) {
    if (field.labelKey) expect(defaults[field.labelKey as keyof typeof defaults]).toBe(field.label);
  }
  expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
  const declared = [title, { key: "draft", label: "Draft", type: "boolean" as const, initialValue: true },
    { key: "metaTitle", label: "SEO title", type: "string" as const, required: true },
    { key: "description", label: "SEO description", type: "text" as const },
    { key: "ogImage", label: "Social image", type: "image" as const }];
  const explicit = parseConfig({ schema: { ...schema, documents: [{ ...schema.documents[0], fields: declared }] }, collections: [{ name: "blog", folder: "blog", fields: declared }] });
  expect(explicit.schema!.documents[0].fields).toEqual(declared);
  expect(explicit.collections![0].fields).toEqual(declared);
  expect(explicit.schema!.documents[0].fields.every(field => !field.labelKey)).toBe(true);
  for (const label of ["Title", "Page name", "Custom title"]) {
    const field = { ...title, label, placeholder: "Developer placeholder", required: true };
    expect(parseConfig({ schema: { ...schema, documents: [{ ...schema.documents[0], fields: [field] }] } }).schema!.documents[0].fields[0]).toBe(field);
  }
});
