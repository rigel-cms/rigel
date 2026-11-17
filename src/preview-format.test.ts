import { expect, test } from "vitest";
import { patchPreview, type PreviewConfig } from "./preview";
import { parseConfig } from "./config";

const formats: NonNullable<PreviewConfig["formats"]> = {
  articleDate: { type: "date", locale: "en", options: { year: "numeric", month: "long", day: "numeric" } },
  amount: { type: "number", locale: "en-US", options: { style: "currency", currency: "USD" } },
};

function fixture(path: string, format: string | null, owner: string | null = null) {
  const attributes: Record<string, string> = { datetime: "2000-01-01" };
  const element = {
    tagName: "TIME", textContent: "Stale", dataset: { rigelText: path },
    getAttribute: (key: string) => key === "data-rigel-format" ? format : key === "data-rigel-doc" ? owner : attributes[key] ?? null,
    setAttribute: (key: string, value: string) => { attributes[key] = value; },
    removeAttribute: (key: string) => { delete attributes[key]; },
  };
  const doc = {
    documentElement: { children: [], hasAttribute: () => false, getAttribute: () => null },
    querySelectorAll: (selector: string) => selector === "[data-rigel-text]" ? [element] : [],
  } as unknown as Document;
  return { doc, element, attributes };
}

test("preview formats update display and time attributes without changing the raw draft", () => {
  const { doc, element, attributes } = fixture("date", "articleDate");
  const draft = { date: "2026-11-17", author: "Sophia Attaf" };
  patchPreview(doc, draft, "", { formats });
  expect(element.textContent).toBe("November 17, 2026");
  expect(attributes.datetime).toBe(draft.date);
  expect(draft).toEqual({ date: "2026-11-17", author: "Sophia Attaf" });
  draft.date = "2027-01-02";
  patchPreview(doc, draft, "", { formats });
  expect(element.textContent).toBe("January 2, 2027");
  expect(attributes.datetime).toBe(draft.date);
  for (const date of ["", "not-a-date", "2026-02-30"]) {
    patchPreview(doc, { date }, "", { formats });
    expect(element.textContent).toBe("");
    expect(attributes.datetime).toBeUndefined();
  }
});

test("formats follow shared ownership and keyed nested paths, preserving unloaded owners", () => {
  const { doc, element } = fixture("items.row.amount", "amount", "settings:pricing");
  patchPreview(doc, {}, "", { formats, primary: "page:home", documents: { "settings:pricing": { items: [{ _key: "row", amount: 0 }] } } });
  expect(element.textContent).toBe("$0.00");
  patchPreview(doc, {}, "", { formats, primary: "page:home", documents: {} });
  expect(element.textContent).toBe("$0.00");
  patchPreview(doc, {}, "", { formats, primary: "page:home", documents: { "settings:pricing": {} } });
  expect(element.textContent).toBe("");
});

test("unformatted text remains literal and unknown format names fail closed", () => {
  const plain = fixture("author", null);
  patchPreview(plain.doc, { author: '<img onerror="alert(1)">' }, "");
  expect(plain.element.textContent).toBe('<img onerror="alert(1)">');
  for (const name of ["", "missing", "constructor", "toString", "__proto__"]) {
    const target = fixture("date", name);
    patchPreview(target.doc, { date: "2026-11-17" }, "", { formats });
    expect(target.element.textContent).toBe("");
    expect(target.attributes.datetime).toBeUndefined();
  }
});

test("preview format configuration is validated and copied into the serializable config", () => {
  const preview = parseConfig({ preview: { formats } }).preview!;
  expect(preview.formats).toEqual(formats);
  expect(preview.formats).not.toBe(formats);
  expect(JSON.parse(JSON.stringify(preview)).formats).toEqual(formats);
  for (const invalid of [null, [], 12, { "bad.name": formats.articleDate }, { constructor: formats.articleDate }, { articleDate: { type: "html" } }, { date: { type: "date", options: { month: "wrong" } } }]) {
    expect(() => parseConfig({ preview: { formats: invalid as never } })).toThrow(/format/);
  }
});
