import { expect, test } from "vitest";
import { validateDocument, validateSchema } from "./validate";
import type { FieldDef } from "./types";
import { blankItem, replaceAt } from "../editor/lib/schema-edit";
import { matchesMediaAccept, safeFileUrl } from "../media-types";

const field: FieldDef = { key: "csv", label: "CSV document", type: "file", accept: ".csv", required: true };
function schemaFor(def = field) {
  return validateSchema({ documents: [{ name: "page", title: "Pages", type: "document", folder: "content/pages", fields: [def] }], objects: [] });
}

test("native CSV fields retain relative public URLs and require explicit draft replacement", () => {
  const schema = schemaFor();
  const saved = { csv: "/rigel-media/schedule.csv" };
  expect(validateDocument(schema, "page", "home", saved, [])).toEqual(saved);
  const draft = replaceAt(saved, "csv", "/rigel-media/replacement.CSV");
  expect(saved.csv).toBe("/rigel-media/schedule.csv");
  expect(validateDocument(schema, "page", "home", draft, [])).toEqual(draft);
  expect(blankItem([field]).csv).toBe("");
  for (const csv of [undefined, null, "", "   ", 1, {}, "/media/file.pdf", "https://example.com/file.csv", "//evil.test/file.csv", "javascript:alert(1)", "/../file.csv", "/%2e%2e/file.csv", "/media/%2f..%2ffile.csv", "/media/file.csv?x=1", "/media/file.csv#x"]) {
    expect(() => validateDocument(schema, "page", "home", { csv }, []), String(csv)).toThrow();
  }
  const optional = schemaFor({ ...field, required: false });
  expect(validateDocument(optional, "page", "home", { csv: "" }, [])).toEqual({ csv: "" });
  expect(validateDocument(optional, "page", "home", {}, [])).toEqual({});
});

test("file acceptance uses supported extensions and canonical MIME types, not supplied browser MIME", () => {
  for (const accept of [undefined, ".csv", " .CSV , .pdf ", "text/csv", "text/*"]) {
    expect(matchesMediaAccept("schedule.CSV", accept)).toBe(true);
  }
  for (const name of ["schedule.csv.exe", "schedule.pdf", "schedule.csv?other.pdf", "schedule.html", "schedule"]) {
    expect(matchesMediaAccept(name, ".csv"), name).toBe(false);
  }
  expect(matchesMediaAccept("photo.png", "image/*")).toBe(true);
  expect(matchesMediaAccept("notes.pdf")).toBe(true);
  expect(safeFileUrl("/media/my%20schedule.csv")).toBe(true);
  for (const url of ["/media/%00.csv", "/media/%5cfile.csv", "/media/%.csv", "/media/./file.csv", "/media//file.csv", "/media/file.svg"]) expect(safeFileUrl(url), url).toBe(false);
});

test("file accept declarations reject malformed configuration and work inside sections", () => {
  for (const accept of ["", ".csv,", "csv", "text", "*", 1, null]) {
    expect(() => schemaFor({ ...field, accept } as FieldDef)).toThrow(/accept/);
  }
  expect(() => schemaFor({ ...field, type: "image" })).toThrow(/accept/);
  const schema = validateSchema({
    documents: [{ name: "page", title: "Pages", type: "document", folder: "content/pages", fields: [{ key: "sections", label: "Sections", type: "array", items: [{ type: "object", name: "schedule" }] }] }],
    objects: [{ name: "schedule", title: "Schedule", type: "section", fields: [field] }],
  });
  const sections = [{ _key: "attachment", _type: "schedule", csv: "/media/example.csv" }];
  expect(() => validateDocument(schema, "page", "home", { sections }, [])).not.toThrow();
  sections[0].csv = "/media/example.pdf";
  expect(() => validateDocument(schema, "page", "home", { sections }, [])).toThrow(/csv/);
});
