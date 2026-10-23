import { expect, test } from "vitest";
import { z } from "astro/zod";
import { parseConfig } from "../config";
import type { CollectionField } from "./types";
import { initialCollectionValues, validateCollectionValues } from "./collections";

const fields = parseConfig({ collections: [{ name: "blog", folder: "blog", fields: [
  { key: "title", label: "Title", type: "string", required: true },
  { key: "date", label: "Date", type: "date" },
  { key: "draft", label: "Draft", type: "boolean" },
  { key: "featured", label: "Featured", type: "boolean", required: true },
  { key: "summary", label: "Summary", type: "text" },
  { key: "notes", label: "Notes", type: "markdown" },
  { key: "tags", label: "Tags", type: "tags" },
  { key: "author", label: "Author", type: "reference", options: [{ value: "alex", label: "Alex" }] },
  { key: "authors", label: "Authors", type: "reference", multiple: true, options: [{ value: "alex", label: "Alex" }] },
] }] }).collections![0].fields;

test("new collection values include every normalized field and serialize untouched SEO strings for Astro", () => {
  const values = initialCollectionValues(fields, "New post");
  expect(Object.keys(values)).toEqual(fields.map(field => field.key));
  expect(values).toMatchObject({ title: "New post", date: new Date().toISOString().slice(0, 10), draft: true, featured: false, summary: "", notes: "", tags: [], author: "", authors: [], description: "", metaTitle: "", ogImage: "" });
  expect(() => validateCollectionValues(fields, values)).not.toThrow();
  const saved = JSON.parse(JSON.stringify({ frontmatter: values }));
  expect(Object.hasOwn(saved.frontmatter, "description")).toBe(true);
  expect(z.object({ description: z.string() }).parse(saved.frontmatter)).toEqual({ description: "" });
});

test("validation leaves optional omissions and unknown existing properties untouched", () => {
  const values = { title: "Existing", featured: false, custom: { keep: true } };
  const before = structuredClone(values);
  validateCollectionValues(fields, values);
  expect(values).toEqual(before);
  expect(Object.hasOwn(values, "description")).toBe(false);
});

test.each([
  { title: " " }, { featured: "false" }, { description: null }, { notes: [] },
  { tags: "tag" }, { tags: [1] }, { author: [] }, { author: "missing" },
  { authors: "alex" }, { authors: ["alex", "alex"] }, { authors: ["missing"] },
  { date: "2026-02-30" }, { date: "2025-02-29" }, { date: "2026-13-01" },
  { date: "01/02/2026" }, { date: 20260101 }, { date: null },
])("rejects invalid declared values %j", invalid => {
  expect(() => validateCollectionValues(fields, { ...initialCollectionValues(fields, "Post"), ...invalid })).toThrow();
});

test("calendar dates, optional blanks and false are valid without coercion", () => {
  for (const date of ["", "2024-02-29", "2026-10-23"]) validateCollectionValues(fields, { ...initialCollectionValues(fields, "Post"), date });
});

test.each(["string", "date", "tags", "reference"] as const)("required %s rejects missing and empty values", type => {
  for (const multiple of [false, true]) {
    const field: CollectionField = { key: "value", label: "Value", type, required: true, multiple, options: [{ value: "alex", label: "Alex" }] };
    for (const value of [undefined, null, "", " ", []]) expect(() => validateCollectionValues([field], { value })).toThrow();
  }
});

test("collection required configuration must be boolean", () => {
  for (const required of [null, "true", 1]) expect(() => parseConfig({ collections: [{ name: "blog", folder: "blog", fields: [{ key: "title", label: "Title", type: "string", required } as never] }] })).toThrow(/required must be boolean/);
});
