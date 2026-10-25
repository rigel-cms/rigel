import { expect, test } from "vitest";
import { assertUniqueUrlSlugs, effectiveSlug, normalizeUrlSlug, validateDocumentSlugs } from "./slugs";
import { pageRoute } from "./schema/paths";
import type { ContentDocument, Schema } from "./schema/types";

const schema: Schema = { objects: [], documents: ["page", "service"].map(name => ({ type: "document", name, title: name, folder: name, fields: [{ key: "title", label: "Title", type: "string" }] })) };
const doc = (type: string, slug: string, data: Record<string, unknown> = {}): ContentDocument => ({ id: `${type}:${slug}`, type, slug, data });

test("URL normalization strips accents and rejects empty or non-string edits without suffixes", () => {
  expect(normalizeUrlSlug("  ÁÉÍÓÚ ü Ñ / ¡Hola!  ")).toBe("aeiou-u-n-hola");
  for (const value of ["", "!!!", "🎉", null, 12]) expect(() => normalizeUrlSlug(value)).toThrow(/slug/);
  expect(effectiveSlug({}, "legacy_file")).toBe("legacy_file");
  for (const slug of ["", "two--parts", "../path", "Árbol", null]) expect(() => effectiveSlug({ slug }, "fallback")).toThrow(/slug/);
  expect(() => assertUniqueUrlSlugs([{ slug: "one", values: { slug: "two" } }, { slug: "two", values: {} }])).toThrow(/already used/);
});

test("page route accepts document metadata without changing its storage identity", () => {
  const document = doc("page", "stable-file", { slug: "pagina-nueva" });
  expect(pageRoute(document, { url: "/{slug}/" })).toBe("/pagina-nueva/");
  expect(pageRoute(doc("page", "old-file"), { url: "/{slug}/" })).toBe("/old-file/");
  expect(document.id).toBe("page:stable-file");
});

test("document URL collisions respect mapped route namespaces and fixed copy routes", () => {
  const documents = [doc("page", "one", { slug: "same" }), doc("service", "same")];
  expect(() => validateDocumentSlugs(schema, documents)).toThrow(/already used/);
  expect(() => validateDocumentSlugs(schema, documents, { documents: { page: { url: "/pages/{slug}/" }, service: { url: "/services/{slug}/" } } })).not.toThrow();
  expect(() => validateDocumentSlugs(schema, [documents[0]], { pages: { copy: "/same/" } })).toThrow(/already used/);
  expect(() => validateDocumentSlugs(schema, [documents[0]], { pages: { copy: { url: "/same/", template: "/templates/copy/" } } })).toThrow(/already used/);
  expect(() => validateDocumentSlugs(schema, [documents[0]], { pages: { copy: { url: "/other/", template: "/same/" } } })).not.toThrow();
});
