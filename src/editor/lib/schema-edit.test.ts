import { readFileSync, readdirSync } from "node:fs";
import { expect, test } from "vitest";
import schema from "../../../tests/fixtures/site/src/content/schema";
import { validateDocument } from "../../schema/validate";
import type { ContentDocument } from "../../schema/types";
import { blankItem } from "./schema-edit";

const documents: ContentDocument[] = schema.documents.filter(def => ["logoSet", "callout"].includes(def.name)).flatMap(def =>
  readdirSync(`tests/fixtures/site/${def.folder}`).filter(file => file.endsWith(".json")).map(file => {
    const slug = file.slice(0, -5);
    return { id: `${def.name}:${slug}`, type: def.name, slug, data: JSON.parse(readFileSync(`tests/fixtures/site/${def.folder}/${file}`, "utf8")) };
  }),
);

test.each(schema.objects.filter(def => def.type === "section"))("$name starts with valid, independent content", def => {
  const section: Record<string, unknown> = { ...blankItem(def.fields), _type: def.name };
  const page = { _type: "page", title: "New page", sections: [section] };
  expect(() => validateDocument(schema, "page", "test", page, documents)).not.toThrow();
  const other: Record<string, unknown> = { ...blankItem(def.fields), _type: def.name };
  expect(other._key).not.toBe(section._key);
  for (const field of def.fields.filter(field => field.initialValue !== undefined)) {
    const normalize = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, child) => key === "_key" ? undefined : child));
    expect(normalize(section[field.key])).toEqual(normalize(field.initialValue));
  }
});

test("array defaults receive fresh keys without mutating their declaration", () => {
  const fields = [{ key: "items", label: "Items", type: "array" as const, initialValue: [{ _key: "starter", title: "New item" }] }];
  const first = blankItem(fields).items as { _key: string; title: string }[];
  const second = blankItem(fields).items as { _key: string; title: string }[];
  expect(first[0]._key).not.toBe(second[0]._key);
  first[0].title = "Edited";
  expect(second[0].title).toBe("New item");
  expect(fields[0].initialValue).toEqual([{ _key: "starter", title: "New item" }]);
});

test("clearing required starter content still fails validation", () => {
  const def = schema.objects.find(def => def.name === "pageIntro")!;
  const section = { ...blankItem(def.fields), _type: def.name, title: "" };
  expect(() => validateDocument(schema, "page", "test", { title: "New page", sections: [section] }, documents)).toThrow(/title: required/);
});
