import { expect, test } from "vitest";
import { draftSnapshot, updateDraftField, contentCatalog, selectContent, replaceArticleBody, registerDraftTools, type DraftTool } from "./webmcp";
import { emptyBody } from "../../article-body";
import type { Manifest } from "../../manifest/types";

const manifest: Manifest = {
  pages: [],
  github: { token: "secret", repo: "private" } as never,
  schema: {
    documents: [{ name: "page", title: "Page", type: "document", folder: "pages", fields: [
      { key: "title", label: "Title", type: "string", required: true },
      { key: "seo", label: "SEO", type: "object", fields: [{ key: "description", label: "Description", type: "text" }] },
      { key: "password", label: "Password", type: "password" },
      { key: "body", label: "Body", type: "markdown" },
    ] }], objects: [],
  },
};
const selection = { kind: "document", type: "page", id: "page:home" } as const;
const values = { title: "Home", seo: { description: "Find us" }, password: "secret", body: "Private body", unknown: "hidden" };

test("snapshot exposes only declared content fields and exact selection/locale context", () => {
  const snapshot = draftSnapshot(manifest, selection, "en", "revision-1", values);
  expect(snapshot).toMatchObject({ context: "revision-1", selection, locale: "en", fields: [
    { path: "title", type: "string", required: true, value: "Home" },
    { path: "seo", type: "object", value: { description: "Find us" } },
    { path: "seo.description", type: "text", value: "Find us" },
    { path: "body", type: "markdown", value: "Private body" },
  ] });
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|private|hidden/);
});


test("selection identity never leaks extra properties from navigation state", () => {
  const snapshot = draftSnapshot(manifest, { ...selection, token: "secret" } as typeof selection, "en", "one", values);
  expect(snapshot.selection).toEqual(selection);
});

test("single-field updates validate real input and preserve unrelated unsaved values without mutating source", () => {
  const input = { context: "revision-1", path: "seo.description", value: "New description" };
  const next = updateDraftField(manifest, selection, "en", "revision-1", values, input);
  expect(next).toEqual({ ...values, seo: { description: "New description" } });
  expect(values.seo.description).toBe("Find us");
  for (const bad of [null, [], { ...input, extra: true }, { ...input, context: "stale" }, { ...input, path: "__proto__.polluted" }, { ...input, path: "password" }, { ...input, value: {} }, { ...input, path: "title", value: "" }]) {
    expect(() => updateDraftField(manifest, selection, "en", "revision-1", values, bad)).toThrow();
  }
});

test("native registration guards every call, cancels stale callbacks and changes only the in-memory draft", async () => {
  const tools: DraftTool[] = [];
  const signals: AbortSignal[] = [];
  let current: Record<string, unknown> = values;
  let allowed = true;
  let revision = "one";
  const stop = registerDraftTools({ registerTool: async (tool, options) => { tools.push(tool); signals.push(options.signal); } }, {
    guard: () => { if (!allowed) throw new Error("Not authorized"); },
    read: () => draftSnapshot(manifest, selection, "en", revision, current),
    update: input => { current = updateDraftField(manifest, selection, "en", revision, current, input); revision = "two"; },
    settled: async () => {},
  });
  await Promise.resolve(); await Promise.resolve();
  expect(tools.map(tool => tool.name)).toEqual(["rigel_read_draft", "rigel_update_field"]);
  const options = { signal: new AbortController().signal };
  expect(await tools[0].execute({}, options)).toMatchObject({ context: "one" });
  await tools[1].execute({ context: "one", path: "title", value: "Changed" }, options);
  expect(current.title).toBe("Changed");
  expect(values.title).toBe("Home");
  allowed = false;
  await expect(tools[0].execute({}, options)).rejects.toThrow("Not authorized");
  allowed = true;
  const aborted = new AbortController(); aborted.abort();
  await expect(tools[1].execute({ context: "two", path: "title", value: "Aborted" }, { signal: aborted.signal })).rejects.toThrow();
  expect(current.title).toBe("Changed");
  stop();
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

test("pending registration is not executable and cleanup cancels late registration", async () => {
  let complete!: () => void;
  const calls: DraftTool[] = [];
  const stop = registerDraftTools({ registerTool: async tool => { calls.push(tool); await new Promise<void>(resolve => { complete = resolve; }); } }, {
    guard: () => {}, read: () => draftSnapshot(manifest, selection, "en", "one", values),
    update: () => { throw new Error("Must not run"); }, settled: async () => {},
  });
  await expect(calls[0].execute({}, { signal: new AbortController().signal })).rejects.toThrow(/register/i);
  stop(); complete(); await Promise.resolve(); await Promise.resolve();
  expect(calls).toHaveLength(1);
  await expect(calls[0].execute({}, { signal: new AbortController().signal })).rejects.toThrow();
});

test("registration failure rolls back the whole batch, and an absent API is a no-op", async () => {
  const signals: AbortSignal[] = [];
  const tools: DraftTool[] = [];
  const editor = { guard: () => {}, read: () => draftSnapshot(manifest, selection, undefined, "one", values), update: () => { throw new Error("Must not execute"); }, settled: async () => {} };
  expect(() => registerDraftTools(undefined, editor)()).not.toThrow();
  registerDraftTools({ registerTool: async (tool, { signal }) => { signals.push(signal); tools.push(tool); if (tools.length === 2) throw new Error("Registration denied"); } }, editor);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(signals).toHaveLength(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  await expect(tools[0].execute({}, { signal: new AbortController().signal })).rejects.toThrow();
});

test("stable section fields and replacements use native paths and validation", () => {
  const native = structuredClone(manifest);
  native.schema!.documents[0].fields.push({ key: "sections", label: "Sections", type: "array", min: 1, max: 2, items: [{ type: "object", name: "hero" }] });
  native.schema!.objects.push({ name: "hero", title: "Hero", type: "section", fields: [{ key: "heading", label: "Heading", type: "string", required: true }, { key: "body", label: "Body", type: "markdown" }] });
  const draft = { ...values, sections: [{ _key: "kHero", _type: "hero", heading: "Hello", body: "Excluded" }] };
  const snapshot = draftSnapshot(native, selection, "fr", "one", draft);
  expect(snapshot.fields.map(field => field.path)).toEqual(["title", "seo", "seo.description", "body", "sections", "sections.kHero.heading", "sections.kHero.body"]);
  const next = updateDraftField(native, selection, "fr", "one", draft, { context: "one", path: "sections.kHero.heading", value: "Bonjour" });
  expect((next.sections as typeof draft.sections)[0]).toEqual({ ...draft.sections[0], heading: "Bonjour" });
  expect(() => updateDraftField(native, selection, "fr", "one", { ...draft, sections: [] }, { context: "one", path: "title", value: "Changed" })).toThrow(/at least/);
});

test("legacy copy pages expose text and richtext, including shared content, but not unsupported selections", () => {
  const legacy: Manifest = { pages: [{ slug: "home", label: "Home", groups: [{ id: "hero", label: "Hero", fields: [{ key: "title", label: "Title", type: "string" }, { key: "body", label: "Body", type: "markdown" }] }], values: { hero: { title: "Home", body: "Excluded" } } }] };
  const sel = { kind: "page", slug: "home" } as const;
  const snapshot = draftSnapshot(legacy, sel, undefined, "one", legacy.pages[0].values);
  expect(snapshot.fields.map(field => field.path)).toEqual(["hero.title", "hero.body"]);
  expect(updateDraftField(legacy, sel, undefined, "one", legacy.pages[0].values, { context: "one", path: "hero.title", value: "New" })).toEqual({ hero: { title: "New", body: "Excluded" } });
  for (const selection of [null, { kind: "post", collection: "blog", slug: "home" } as const, { kind: "menu", slug: "main" } as const]) expect(() => draftSnapshot(legacy, selection, undefined, "one", {})).toThrow();
  legacy.pages[0].shared = true;
  expect(draftSnapshot(legacy, sel, undefined, "one", legacy.pages[0].values).fields).toEqual(snapshot.fields);
});

test("collection metadata supports blog and news fields without leaking unknown frontmatter", () => {
  const blog: Manifest = { pages: [], collections: [{ name: "blog", label: "Blog", fields: [{ key: "title", label: "Title", type: "string", required: true }, { key: "tags", label: "Tags", type: "tags" }], posts: [] }] };
  const selected = { kind: "post", collection: "blog", slug: "hello" } as const;
  const draft = { title: "Hello", tags: ["news"], token: "hidden" };
  expect(draftSnapshot(blog, selected, undefined, "one", draft).fields.map(field => field.path)).toEqual(["title", "tags"]);
  expect(updateDraftField(blog, selected, undefined, "one", draft, { context: "one", path: "tags", value: ["updated"] })).toEqual({ ...draft, tags: ["updated"] });
  expect(() => updateDraftField(blog, selected, undefined, "one", draft, { context: "one", path: "title", value: "" })).toThrow();
});

test("structured schema replacements retain stable keys, reject unknown and secret properties, and support shared content", () => {
  const native = structuredClone(manifest);
  native.schema!.documents[0].shared = true;
  native.schema!.documents[0].fields.push({ key: "cards", label: "Cards", type: "array", items: [{ type: "object", fields: [{ key: "caption", label: "Caption", type: "string" }, { key: "image", label: "Image", type: "image" }] }] });
  const draft = { ...values, cards: [{ _key: "kCard", caption: "Original", image: "/image.png", unknown: "hidden" }] };
  const snapshot = draftSnapshot(native, selection, "en", "one", draft);
  expect(JSON.stringify(snapshot)).not.toMatch(/secret|hidden/);
  expect(snapshot.fields.map(field => field.path)).toContain("cards.kCard.caption");
  const replace = (value: unknown) => updateDraftField(native, selection, "en", "one", draft, { context: "one", path: "cards", value });
  expect(replace([{ _key: "kCard", caption: "Updated", image: "/new.png" }]).cards).toEqual([{ _key: "kCard", caption: "Updated", image: "/new.png" }]);
  for (const value of [[{ _key: "kCard", caption: "Updated", password: "injected" }], [{ _key: "kCard", image: "javascript:alert(1)" }], JSON.parse('[{"_key":"kCard","__proto__":{}}]')]) expect(() => replace(value)).toThrow();
  expect(() => updateDraftField(native, selection, "en", "one", draft, { context: "one", path: "body", value: "<script>alert(1)</script>" })).toThrow();
  expect(updateDraftField(native, selection, "en", "one", draft, { context: "one", path: "body", value: "**Safe** copy" }).body).toBe("**Safe** copy");
});

test("article replacement accepts native body and lossless visual Markdown, never HTML or unsafe trees", () => {
  const selected = { kind: "post", collection: "blog", slug: "hello" } as const;
  const replace = (format: string, value: unknown) => replaceArticleBody(selected, "one", { context: "one", format, value });
  expect(replace("article-body", emptyBody())).toEqual(emptyBody());
  expect(JSON.stringify(replace("markdown", "# Hello\n\n**Article** copy"))).toContain("Hello");
  for (const [format, value] of [["markdown", "<script>alert(1)</script>"], ["article-body", { root: { type: "root", version: 1, children: [{ type: "paragraph", version: 1, children: [{ type: "link", version: 1, url: "javascript:alert(1)", children: [] }] }] } }], ["article-body", { ...emptyBody(), password: "hidden" }], ["article-body", { root: { type: "root", version: 1, children: [{ type: "image", version: 1, src: "javascript:x", alt: "" }] } }], ["html", "<p>Not supported</p>"]]) expect(() => replace(format as string, value), JSON.stringify([format, value])).toThrow();
  expect(() => replaceArticleBody(selection, "one", { context: "one", format: "article-body", value: emptyBody() })).toThrow();
});

test("menus expose only native draft fields and enforce IDs, depth, URLs and exact keys", () => {
  const menus: Manifest = { pages: [], menus: { maxDepth: 2, entries: [{ slug: "main", title: "Main", items: [] }] } };
  const selected = { kind: "menu", slug: "main" } as const;
  const draft = { title: "Main", items: [] };
  expect(draftSnapshot(menus, selected, undefined, "one", draft).fields.map(field => field.path)).toEqual(["title", "items"]);
  const value = [{ id: "home", label: "Home", url: "/", children: [] }];
  expect(updateDraftField(menus, selected, undefined, "one", draft, { context: "one", path: "items", value }).items).toEqual(value);
  for (const bad of [[{ ...value[0], url: "javascript:alert(1)" }], [value[0], value[0]], [{ ...value[0], token: "hidden" }]]) expect(() => updateDraftField(menus, selected, undefined, "one", draft, { context: "one", path: "items", value: bad })).toThrow();
});

test("catalog and selection return only existing locale-visible identities, not content or settings", () => {
  const source = structuredClone(manifest);
  source.documents = [{ id: "page:home", type: "page", slug: "home", data: values }];
  source.schema!.documents[0].locale = "en";
  source.contentLocales = { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "French" }] };
  const catalog = contentCatalog(source, "en", "one");
  expect(catalog.entries.map(entry => entry.selection)).toEqual([selection]);
  expect(JSON.stringify(catalog)).not.toMatch(/secret|hidden|Private body/);
  expect(contentCatalog(source, "fr", "one").entries).toEqual([]);
  expect(selectContent(catalog, { context: "one", selection: { id: "page:home", type: "page", kind: "document" } })).toEqual(selection);
  for (const input of [{ context: "stale", selection }, { context: "one", selection: { ...selection, token: "secret" } }, { context: "one", selection: { ...selection, id: "page:missing" } }]) expect(() => selectContent(catalog, input)).toThrow();
});

test("password-containing ancestors and secret-like fields are never readable or replaceable", () => {
  const native = structuredClone(manifest);
  native.schema!.documents[0].fields.push({ key: "site", label: "Site", type: "object", fields: [{ key: "heading", label: "Heading", type: "string" }, { key: "apiKey", label: "API key", type: "string" }, { key: "refreshToken", label: "Refresh token", type: "string" }, { key: "credentials", label: "Credentials", type: "object", fields: [{ key: "password", label: "Password", type: "password" }] }] });
  const draft = { ...values, site: { heading: "Public", apiKey: "never-expose", refreshToken: "never-expose", credentials: { password: "never-expose" } } };
  const snapshot = draftSnapshot(native, selection, undefined, "one", draft);
  expect(JSON.stringify(snapshot)).not.toContain("never-expose");
  expect(snapshot.fields.map(field => field.path)).toContain("site.heading");
  for (const path of ["site", "site.apiKey", "site.credentials"]) expect(() => updateDraftField(native, selection, undefined, "one", draft, { context: "one", path, value: {} })).toThrow();
});

test("structured input rejects getters, foreign prototypes, ambiguous stable keys and resource exhaustion", () => {
  const native = structuredClone(manifest);
  native.schema!.documents[0].fields.push({ key: "cards", label: "Cards", type: "array", items: [{ type: "object", fields: [{ key: "caption", label: "Caption", type: "string" }] }] });
  const draft = { ...values, cards: [] };
  const replace = (value: unknown) => updateDraftField(native, selection, undefined, "one", draft, { context: "one", path: "cards", value });
  const getter = Object.defineProperty({}, "caption", { enumerable: true, get() { throw new Error("getter executed"); } });
  const inheritedArray = Object.setPrototypeOf([{ _key: "k", caption: "Inherited array" }], Object.create(Array.prototype));
  let accessed = false;
  const arrayGetter = Object.defineProperty([], "0", { enumerable: true, get() { accessed = true; return { _key: "k", caption: "Getter" }; } });
  expect(() => replace(inheritedArray)).toThrow();
  expect(() => replace(arrayGetter)).toThrow();
  expect(accessed).toBe(false);
  for (const value of [[{ _key: "0", caption: "Bad" }], [{ _key: "__proto__", caption: "Bad" }], [{ _key: "same" }, { _key: "same" }], [getter], [Object.create({ caption: "Inherited" })], new Array(1001).fill("x"), [{ _key: "k", caption: "x".repeat(20_001) }]]) expect(() => replace(value)).toThrow();
  expect(draft.cards).toEqual([]);
});

test("schema references and asset URLs pass native validation and never accept arbitrary metadata", () => {
  const native = structuredClone(manifest);
  native.documents = [{ id: "page:other", type: "page", slug: "other", data: { title: "Other" } }];
  native.schema!.documents[0].fields.push({ key: "related", label: "Related", type: "reference", to: ["page"] }, { key: "file", label: "File", type: "file", accept: ".pdf" });
  expect(updateDraftField(native, selection, undefined, "one", values, { context: "one", path: "related", value: { _ref: "page:other" } }).related).toEqual({ _ref: "page:other" });
  expect(updateDraftField(native, selection, undefined, "one", values, { context: "one", path: "file", value: "/guide.pdf" }).file).toBe("/guide.pdf");
  for (const [path, value] of [["related", { _ref: "page:missing" }], ["related", { _ref: "page:other", _secret: "hidden" }], ["file", "javascript:x"], ["file", "/image.png"]]) expect(() => updateDraftField(native, selection, undefined, "one", values, { context: "one", path, value })).toThrow();
});

test("literal legacy keys cannot be reinterpreted as nested paths", () => {
  const legacy: Manifest = { pages: [{ slug: "home", label: "Home", groups: [{ id: "hero.secret", label: "Hero", fields: [{ key: "title", label: "Title", type: "string" }] }], values: { "hero.secret": { title: "Visible" }, hero: { secret: { title: "Hidden" } } } }] };
  expect(draftSnapshot(legacy, { kind: "page", slug: "home" }, undefined, "one", legacy.pages[0].values).fields).toEqual([]);
});

test.each([null, [], 1, true, NaN, Infinity, "x".repeat(20_001)])("rejects invalid scalar input without partial edits", value => {
  expect(() => updateDraftField(manifest, selection, "en", "one", values, { context: "one", path: "title", value })).toThrow();
  expect(values.title).toBe("Home");
});

