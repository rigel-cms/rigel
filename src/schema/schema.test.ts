import { describe, expect, test } from "vitest";
import { validateSchema, validateDocument, SchemaError, referrers } from "./validate";
import { newDocumentFromTemplate, regenerateKeys, resolvePath, setPath, assertUniqueSlug, pageRoute } from "./paths";
import type { ContentDocument, Schema } from "./types";

const declared: Schema = {
  documents: [
    {
      name: "page", title: "Pages", type: "document" as const, folder: "content/pages",
      fields: [
        { key: "title", label: "Title", type: "string" as const, required: true },
        { key: "sections", label: "Sections", type: "array" as const, items: [
          { type: "object" as const, name: "hero" },
          { type: "object" as const, name: "cta" },
        ], min: 1 },
        { key: "callout", label: "Callout", type: "reference" as const, to: ["callout"] },
        { key: "related", label: "Related page", type: "reference" as const, to: ["page"] },
      ],
      template: [{ type: "hero", values: { title: "Start here" } }, { type: "cta" }],
    },
    {
      name: "callout", title: "Callouts", type: "document" as const, folder: "content/shared", shared: true,
      fields: [
        { key: "title", label: "Title", type: "string" as const, required: true },
        { key: "heading", label: "Heading", type: "string" as const, required: true },
      ],
    },
  ],
  objects: [
    {
      name: "hero", title: "Hero", type: "section" as const,
      fields: [
        { key: "title", label: "Headline", type: "string" as const, required: true },
        { key: "image", label: "Image", type: "image" as const },
        { key: "links", label: "Links", type: "array" as const, items: [{ type: "object" as const, fields: [
          { key: "label", label: "Label", type: "string" as const },
          { key: "href", label: "Href", type: "string" as const },
        ] }] },
      ],
    },
    { name: "cta", title: "CTA", type: "section" as const, fields: [{ key: "heading", label: "Heading", type: "string" as const }] },
  ],
};

const schema: Schema = validateSchema(declared);

const callout: ContentDocument = {
  id: "callout:studio", type: "callout", slug: "studio",
  data: { _id: "callout:studio", _type: "callout", title: "Studio", heading: "Say hello" },
};

function page(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: "page:home", _type: "page", slug: "home", title: "Home", callout: { _ref: "callout:studio" },
    sections: [
      { _key: "khero01", _type: "hero", title: "Welcome", image: "/demo/hero.jpg", links: [
        { _key: "klink01", label: "About", href: "/about/" },
      ] },
      { _key: "kcta001", _type: "cta", heading: "Go" },
    ],
    ...overrides,
  };
}

describe("schema validation", () => {
  test("validates declared section item types", () => {
    expect(schema.objects.map((object) => object.name)).toEqual(["hero", "cta"]);
    const bad = structuredClone(declared);
    bad.documents[0].fields[1].items = [{ type: "object", name: "missing" }];
    expect(() => validateSchema(bad)).toThrow(/unknown object type/);
  });

  test("rejects unsafe folders, duplicate fields and unknown reference targets", () => {
    expect(() => validateSchema({ ...declared, documents: [{ ...declared.documents[0], folder: "../outside" }] })).toThrow(/unsafe folder/);
    const duplicate = structuredClone(declared) as typeof declared;
    duplicate.documents[0].fields.push({ key: "title", label: "Again", type: "string" });
    expect(() => validateSchema(duplicate)).toThrow(/duplicate field key/);
    const target = structuredClone(declared) as typeof declared;
    target.documents[0].fields[2] = { key: "callout", label: "Callout", type: "reference", to: ["missing"] };
    expect(() => validateSchema(target)).toThrow(/reference target/);
  });

  test("accepts a document with keyed heterogeneous sections and a resolved reference", () => {
    expect(validateDocument(schema, "page", "home", page(), [callout])).toEqual(page());
  });

  test("rejects missing keys, duplicates, broken references and unsafe keys", () => {
    const documents = [callout];
    const noKey = page({ sections: [{ _type: "hero", title: "No key" }] });
    expect(() => validateDocument(schema, "page", "home", noKey, documents)).toThrow(/stable _key/);
    const duplicate = page({ sections: [
      { _key: "ksame", _type: "hero", title: "One" },
      { _key: "ksame", _type: "cta", heading: "Two" },
    ] });
    expect(() => validateDocument(schema, "page", "home", duplicate, documents)).toThrow(/duplicate _key/);
    const broken = page({ callout: { _ref: "callout:missing" } });
    expect(() => validateDocument(schema, "page", "home", broken, documents)).toThrow(/does not resolve/);
    const wrongType = page({ callout: { _ref: "page:other" } });
    expect(() => validateDocument(schema, "page", "home", wrongType, [callout, { id: "page:other", type: "page", slug: "other", data: { _id: "page:other", _type: "page" } }])).toThrow(/must target callout/);
    const unsafe = page({ ["__proto__"]: { polluted: true } });
    expect(() => validateDocument(schema, "page", "home", unsafe, documents)).toThrow(SchemaError);
    const self = page({ related: { _ref: "page:home" } });
    expect(() => validateDocument(schema, "page", "home", self, [...documents, { id: "page:home", type: "page", slug: "home", data: {} }])).toThrow(/itself/);
  });

  test("rejects wrong scalar types, unknown section types and empty required strings", () => {
    const documents = [callout];
    expect(() => validateDocument(schema, "page", "home", page({ title: "" }), documents)).toThrow(/required/);
    expect(() => validateDocument(schema, "page", "home", page({ sections: [{ _key: "kx", _type: "unknown" }] }), documents)).toThrow(/unknown section type/);
    expect(() => validateDocument(schema, "page", "home", page({ sections: [{ _key: "kx", _type: "hero", title: "Hi", image: "javascript:alert(1)" }] }), documents)).toThrow(/image/);
    expect(() => validateDocument(schema, "page", "home", page({ sections: [{ _key: "kx", _type: "hero", title: "Hi", links: [{ _key: "kl", label: 4 }] }] }), documents)).toThrow(/string/);
  });

  test("validates url fields and required arrays", () => {
    const linked = validateSchema({
      documents: [{
        name: "linkPage", title: "Links", type: "document", folder: "content/links",
        fields: [
          { key: "href", label: "URL", type: "url" },
          { key: "paragraphs", label: "Paragraphs", type: "array", required: true, items: [{ type: "object", fields: [{ key: "text", label: "Text", type: "string" }] }] },
        ],
      }],
      objects: [],
    });
    const valid = { _id: "linkPage:one", _type: "linkPage", href: "/about/", paragraphs: [{ _key: "k1", text: "Hi" }] };
    expect(validateDocument(linked, "linkPage", "one", valid, [])).toEqual(valid);
    expect(() => validateDocument(linked, "linkPage", "one", { ...valid, href: "" }, [])).not.toThrow();
    expect(() => validateDocument(linked, "linkPage", "one", { ...valid, href: "javascript:alert(1)" }, [])).toThrow(/url/);
    expect(() => validateDocument(linked, "linkPage", "one", { ...valid, paragraphs: [] }, [])).toThrow(/required/);
  });
});

describe("keyed paths", () => {
  test("resolves and writes array items by stable key after reorder", () => {
    const data = page();
    const sections = data.sections as Record<string, unknown>[];
    const reordered = { ...data, sections: [sections[1], sections[0]] };
    expect(resolvePath(reordered, "sections.khero01.title")).toEqual({ found: true, value: "Welcome" });
    expect(setPath(reordered, "sections.kcta001.heading", "Next")).toBe(true);
    expect((reordered.sections as Record<string, unknown>[])[0].heading).toBe("Next");
    expect(setPath(reordered, "sections.kmissing.heading", "No")).toBe(false);
    expect(resolvePath(reordered, "__proto__.x")).toEqual({ found: false });
  });

  test("writes numeric array indexes as well as keys", () => {
    const data = page();
    expect(setPath(data, "sections.0.title", "Indexed")).toBe(true);
    expect(resolvePath(data, "sections.0.title").value).toBe("Indexed");
    expect(setPath(data, "sections.9.title", "No")).toBe(false);
  });

  test("regenerates every instance key and keeps content", () => {
    const copy = regenerateKeys(page());
    const keys = (copy.sections as Record<string, unknown>[]).flatMap((section) => [
      section._key,
      ...((section.links as Record<string, unknown>[]) ?? []).map((link) => link._key),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("khero01");
    expect(resolvePath(copy, "sections." + (copy.sections as Record<string, unknown>[])[0]._key + ".title").value).toBe("Welcome");
  });

  test("builds a new document from the template with fresh keys", () => {
    const doc = newDocumentFromTemplate(schema, "page", "Studio Notes", "studio-notes");
    expect(doc._id).toBe("page:studio-notes");
    expect(doc._type).toBe("page");
    expect(doc.title).toBe("Studio Notes");
    const sections = doc.sections as Record<string, unknown>[];
    expect(sections.map((section) => section._type)).toEqual(["hero", "cta"]);
    expect(sections[0].title).toBe("Start here");
    expect(new Set(sections.map((section) => section._key)).size).toBe(2);
    expect(() => newDocumentFromTemplate(schema, "page", "Bad", "Bad Slug")).toThrow(/Slug/);
  });

  test("checks slug uniqueness against documents and legacy pages", () => {
    expect(() => assertUniqueSlug([callout], "callout", "studio")).toThrow(/already exists/);
    expect(() => assertUniqueSlug([], "page", "contact", ["contact"])).toThrow(/copy page/);
    expect(() => assertUniqueSlug([], "page", "fresh")).not.toThrow();
  });

  test("derives document routes with an explicit index mapping", () => {
    expect(pageRoute("home", { url: "/{slug}/", index: "/" })).toBe("/");
    expect(pageRoute("about", { url: "/{slug}/", index: "/" })).toBe("/about/");
    expect(pageRoute("x", { url: "https://evil.test/{slug}" })).toBeNull();
  });

  test("finds documents that reference a shared id", () => {
    const docs = [{ id: "page:home", type: "page", slug: "home", data: page() }, callout];
    expect(referrers(docs as ContentDocument[], "callout:studio").map((doc) => doc.id)).toEqual(["page:home"]);
  });
});
