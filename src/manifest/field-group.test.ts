import { expect, test } from "vitest";
import { parseConfig } from "../config";
import type { FieldDef, Schema } from "../schema/types";
import type { CollectionField } from "./types";
import { fieldGroup } from "./seo";

const schema = (fields: FieldDef[]): Schema => ({ documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", fields }], objects: [] });

test("field placement defaults to Content except core page metadata and native SEO keys", () => {
  for (const key of ["heading", "author", "publishedAt", "body"]) expect(fieldGroup({ key })).toBe("content");
  for (const key of ["title", "slug", "draft"]) expect(fieldGroup({ key })).toBe("page");
  for (const key of ["metaTitle", "description", "ogImage", "noindex"]) expect(fieldGroup({ key })).toBe("seo");
  for (const key of ["title", "description", "heading"]) {
    for (const group of ["page", "content", "seo"] as const) expect(fieldGroup({ key, group })).toBe(group);
  }
});

test("declared groups survive config normalization and manifest JSON roundtrips", () => {
  const fields: FieldDef[] = [{ key: "title", label: "Title", type: "string", group: "content" }, { key: "description", label: "Summary", type: "text", group: "page" }, { key: "custom", label: "Custom", type: "boolean", group: "seo" }];
  const config = parseConfig({ schema: schema(fields), collections: [{ name: "blog", folder: "blog", fields: fields as CollectionField[] }] });
  const manifest = JSON.parse(JSON.stringify({ schema: config.schema, collections: config.collections }));
  expect(manifest.schema.documents[0].fields.slice(0, 3)).toEqual(fields);
  expect(manifest.collections[0].fields.slice(0, 3)).toEqual(fields);
  expect(parseConfig(JSON.parse(JSON.stringify(config)))).toEqual(config);
});

test("invalid groups are rejected for schema and collection fields", () => {
  for (const group of ["Page", "", null, false, 1]) {
    const field = { key: "custom", label: "Custom", type: "string", group };
    expect(() => parseConfig({ schema: schema([field as unknown as FieldDef]) })).toThrow(/group/);
    expect(() => parseConfig({ collections: [{ name: "blog", folder: "blog", fields: [field as unknown as CollectionField] }] })).toThrow(/group/);
  }
});
