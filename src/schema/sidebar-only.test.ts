import { expect, test } from "vitest";
import { validateSchema } from "./validate";
import type { FieldDef } from "./types";

function schemaFor(def: FieldDef) {
  return validateSchema({ documents: [{ name: "page", title: "Pages", type: "document", folder: "content/pages", fields: [def] }], objects: [] });
}

test("markdown fields can be declared sidebar-only", () => {
  expect(() => schemaFor({ key: "answer", label: "Answer", type: "markdown", sidebarOnly: true })).not.toThrow();
  expect(() => schemaFor({ key: "answer", label: "Answer", type: "markdown", sidebarOnly: false })).not.toThrow();
  expect(() => schemaFor({ key: "answer", label: "Answer", type: "markdown" })).not.toThrow();
});

test("sidebar-only is rejected outside markdown fields or with a non-boolean value", () => {
  expect(() => schemaFor({ key: "title", label: "Title", type: "string", sidebarOnly: true })).toThrow(/sidebarOnly/);
  expect(() => schemaFor({ key: "answer", label: "Answer", type: "markdown", sidebarOnly: "yes" as unknown as boolean })).toThrow(/sidebarOnly/);
});
