import type { CopyField, Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import type { FieldDef, Schema } from "../../schema/types";
import { isPlainObject, objectDef, validateDocument } from "../../schema/validate";
import { cloneJson, resolvePath, setPath } from "../../schema/paths";
import { validateCollectionValues } from "../../manifest/collections";
import { parseVisualMarkdown } from "./rich-markdown";
import { validateBody, type ArticleBody } from "../../article-body";
import { markdownToBody } from "./markdown-blocks";
import { validateMenu } from "../../manifest/menu";
import { contentForLocale } from "../../manifest/content-locales";

const safeSegment = (key: string) => /^[A-Za-z0-9_-]+$/.test(key) && !["__proto__", "constructor", "prototype"].includes(key);
const contentKey = (key: string) => safeSegment(key) && !/(?:password|secret|api[_-]?key|(?:access|refresh|api|auth)[_-]?token|^token$|(?:private|signing)[_-]?key|session|credential)/i.test(key);
const emptySchema: Schema = { documents: [], objects: [] };
type DraftField = FieldDef & { legacyList?: boolean };

export function assertToolJson(value: unknown, stringLimit = 20_000) {
  let nodes = 0, size = 0;
  const visit = (value: unknown, depth: number) => {
    if (++nodes > 10_000 || depth > 32) throw new Error("Draft payload exceeds the resource budget.");
    if (value === null || typeof value === "boolean") return;
    if (typeof value === "string") {
      size += value.length;
      if (value.length > stringLimit || size > 1_000_000) throw new Error("Draft payload exceeds the text budget.");
      return;
    }
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) {
      if (value.length > 1000) throw new Error("Too many draft items.");
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("Expected a plain JSON array.");
      for (let index = 0; index < value.length; index++) {
        const property = Object.getOwnPropertyDescriptor(value, String(index));
        if (!property?.enumerable || !Object.hasOwn(property, "value")) throw new Error("Unsafe array property.");
        visit(property.value, depth + 1);
      }
      return;
    }
    if (!isPlainObject(value)) throw new Error("Expected plain JSON draft values.");
    for (const key of Reflect.ownKeys(value)) {
      const property = Object.getOwnPropertyDescriptor(value, key)!;
      if (typeof key !== "string" || !safeSegment(key) || !property.enumerable || !Object.hasOwn(property, "value")) throw new Error("Unsafe draft property.");
      visit(property.value, depth + 1);
    }
  };
  visit(value, 0);
}

function childFields(schema: Schema, field: FieldDef): FieldDef[] {
  return field.of ? objectDef(schema, field.of).fields : field.fields ?? [];
}

function itemField(schema: Schema, field: FieldDef, value: unknown): FieldDef {
  const items = field.items ?? [];
  const item = isPlainObject(value) && typeof value._type === "string"
    ? items.find(item => item.type === "object" && item.name === value._type)
    : items.find(item => item.type === "reference" && isPlainObject(value) && typeof value._ref === "string") ?? items.find(item => item.type === "object" && !item.name && isPlainObject(value)) ?? items.find(item => item.type !== "object" && item.type !== "reference" && typeof value === (item.type === "boolean" ? "boolean" : item.type === "number" ? "number" : "string"));
  if (!item) throw new Error("Unsupported array item type.");
  return { ...item, key: field.key, label: field.label, ...(item.type === "object" && item.name ? { of: item.name } : {}) };
}

function editable(schema: Schema, field: FieldDef, depth = 0): boolean {
  if (depth > 12 || field.type === "password" || !contentKey(field.key)) return false;
  if (field.type === "object") return childFields(schema, field).every(child => editable(schema, child, depth + 1));
  if (field.type === "array") return (field.items ?? []).every(item => editable(schema, { ...item, key: field.key, label: field.label, ...(item.type === "object" && item.name ? { of: item.name } : {}) }, depth + 1));
  return true;
}

function fieldValue(schema: Schema, field: DraftField, value: unknown, strict: boolean, item = false): unknown {
  if (value === undefined && !strict) return null;
  if (field.type === "password") throw new Error("Password fields are unavailable.");
  if (field.type === "array") {
    if (!Array.isArray(value)) { if (!strict) return null; throw new Error("Expected an array."); }
    return value.map(value => fieldValue(schema, itemField(schema, field, value), value, strict, !field.legacyList));
  }
  if (field.type === "object" || field.type === "reference") {
    if (!isPlainObject(value)) { if (!strict) return null; throw new Error("Expected an object."); }
    const fields = field.type === "object" ? childFields(schema, field).filter(field => field.type !== "password" && contentKey(field.key)) : [];
    const keys = [...fields.map(field => field.key), ...(item ? ["_key", ...(field.of ? ["_type"] : [])] : []), ...(field.type === "reference" ? ["_ref"] : [])];
    if (strict && Object.keys(value).some(key => !keys.includes(key))) throw new Error("Unknown or secret draft property.");
    const next: Record<string, unknown> = {};
    for (const key of keys) {
      if (!Object.hasOwn(value, key)) continue;
      const child = fields.find(field => field.key === key);
      if (child) next[key] = fieldValue(schema, child, value[key], strict);
      else if (typeof value[key] === "string") {
        if (strict && key === "_key" && (!safeSegment(value[key]) || /^\d+$/.test(value[key]))) throw new Error("Use a nonnumeric safe stable key.");
        next[key] = value[key];
      }
      else if (strict) throw new Error("Expected a string identifier.");
    }
    return next;
  }
  const expected = field.type === "boolean" ? "boolean" : field.type === "number" ? "number" : "string";
  if (typeof value !== expected || (typeof value === "number" && !Number.isFinite(value))) { if (!strict) return null; throw new Error("Invalid field value type."); }
  if (strict) {
    if (field.type === "markdown" && !parseVisualMarkdown(value as string)) throw new Error("Use supported visual Markdown without raw HTML or unsafe links.");
    validateDocument({ documents: [{ name: "draft", title: "Draft", type: "document", folder: "draft", fields: [{ ...field, key: "value" }] }], objects: schema.objects }, "draft", "draft", { value }, []);
  }
  return value;
}

function copyField(field: CopyField): DraftField {
  return field.type === "list" ? { key: field.key, label: field.label, type: "array", legacyList: true, items: [{ type: "object", fields: field.item.fields.map(copyField) }] } : field;
}

function draftFields(manifest: Manifest, selection: Selection | null, values: Record<string, unknown>) {
  const schema = manifest.schema ?? emptySchema;
  const fields: { path: string; field: DraftField }[] = [];
  const walk = (definitions: DraftField[], prefix = "", depth = 0) => {
    if (depth > 12) return;
    for (const field of definitions) {
      if (!contentKey(field.key) || field.type === "password") continue;
      const path = prefix ? `${prefix}.${field.key}` : field.key;
      if (editable(schema, field)) fields.push({ path, field });
      const value = resolvePath(values, path).value;
      if (field.type === "object" && isPlainObject(value)) walk(childFields(schema, field), path, depth + 1);
      if (field.type === "array" && Array.isArray(value) && !field.legacyList) for (const item of value) {
        if (!isPlainObject(item) || typeof item._key !== "string" || !safeSegment(item._key) || /^\d+$/.test(item._key)) continue;
        const def = itemField(schema, field, item);
        if (def.type === "object") walk(childFields(schema, def), `${path}.${item._key}`, depth + 1);
      }
    }
  };
  if (selection?.kind === "document") {
    const type = schema.documents.find(type => type.name === selection.type);
    if (!type) throw new Error("Open an existing document.");
    walk(type.fields);
  } else if (selection?.kind === "page") {
    const page = manifest.pages.find(page => page.slug === selection.slug);
    if (!page) throw new Error("Open an existing page.");
    for (const group of page.groups) if (contentKey(group.id)) walk(group.fields.map(copyField), group.id);
  } else if (selection?.kind === "post") {
    const collection = manifest.collections?.find(entry => entry.name === selection.collection);
    if (!collection) throw new Error("Open an existing collection entry.");
    walk(collection.fields.map(field => field.type === "tags" || (field.type === "reference" && field.multiple) ? { key: field.key, label: field.label, required: field.required, type: "array", items: [{ type: "string" }] } : field.type === "reference" ? { key: field.key, label: field.label, type: "string", required: field.required } : { key: field.key, label: field.label, type: field.type as FieldDef["type"], required: field.required }));
  } else throw new Error("Draft tools support existing content only. Open a page, document or article.");
  return fields;
}

function fieldShape(schema: Schema, field: FieldDef, depth = 0): unknown {
  if (depth > 12) return null;
  return { type: field.type, ...(field.required ? { required: true } : {}), ...(field.min !== undefined ? { min: field.min } : {}), ...(field.max !== undefined ? { max: field.max } : {}),
    ...(field.type === "object" ? { fields: Object.fromEntries(childFields(schema, field).filter(field => field.type !== "password" && safeSegment(field.key)).map(field => [field.key, fieldShape(schema, field, depth + 1)])) } : {}),
    ...(field.type === "array" ? { items: field.items?.map(item => ({ ...(item.type === "object" && item.name ? { _type: item.name } : {}), shape: fieldShape(schema, { ...item, key: field.key, label: field.label, ...(item.type === "object" && item.name ? { of: item.name } : {}) }, depth + 1) })) } : {}),
    ...(field.type === "reference" ? { to: field.to } : {}) };
}

function menuDraft(manifest: Manifest, selection: Extract<Selection, { kind: "menu" }>, values: Record<string, unknown>, strict: boolean) {
  if (!manifest.menus?.entries.some(menu => menu.slug === selection.slug)) throw new Error("Open an existing menu.");
  const project = (items: unknown): unknown[] => {
    if (!Array.isArray(items)) throw new Error("Expected menu items.");
    return items.map(item => {
      if (!isPlainObject(item) || (strict && Object.keys(item).some(key => !["id", "label", "url", "newTab", "children"].includes(key)))) throw new Error("Unknown menu property.");
      return { id: item.id, label: item.label, url: item.url, ...(item.newTab === undefined ? {} : { newTab: item.newTab }), children: project(item.children) };
    });
  };
  return validateMenu({ slug: selection.slug, title: values.title, items: project(values.items) }, manifest.menus.maxDepth);
}

const bodyKeys = new Set("type version children text format direction indent textFormat textStyle detail mode style tag listType start value checked language highlightType url rel target title src alt credit creditURL width height poster caption muted controls provider id privacy colWidths headerState colSpan rowSpan backgroundColor verticalAlign".split(" "));
export function articleBodyValue(value: unknown, strict = true): ArticleBody {
  assertToolJson(value, 1_000_000);
  if (!isPlainObject(value) || (strict && Object.keys(value).some(key => key !== "root"))) throw new Error("Expected an article body envelope.");
  const project = (node: unknown): Record<string, unknown> => {
    if (!isPlainObject(node) || node.type === "extension") throw new Error("Custom extension blocks are not exposed to tools.");
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!bodyKeys.has(key)) { if (strict) throw new Error("Unknown body property."); continue; }
      if (key === "children" && Array.isArray(value)) next[key] = value.map(project);
      else if (key === "colWidths" && Array.isArray(value) && value.every(value => typeof value === "number")) next[key] = [...value];
      else if (value === null || ["string", "number", "boolean"].includes(typeof value)) next[key] = value;
      else throw new Error("Invalid body property.");
    }
    return next;
  };
  const body = { root: project(value.root) };
  validateBody(body);
  return body;
}

export function replaceArticleBody(selection: Selection | null, context: string, input: unknown): ArticleBody {
  const args = toolInput(input, context, ["context", "format", "value"]);
  if (selection?.kind !== "post") throw new Error("Open an article to replace its body.");
  const value = args.format === "markdown" && typeof args.value === "string" ? markdownToBody(args.value) : args.format === "article-body" ? args.value : null;
  if (!value) throw new Error("Use a native article-body or supported lossless visual Markdown, not raw HTML.");
  return articleBodyValue(value);
}

export function draftSnapshot(manifest: Manifest, selection: Selection | null, locale: string | undefined, context: string, values: Record<string, unknown>, body?: "" | ArticleBody) {
  const schema = manifest.schema ?? emptySchema;
  let fields;
  if (selection?.kind === "menu") {
    assertToolJson(values, 1_000_000);
    const menu = menuDraft(manifest, selection, values, false);
    fields = [{ path: "title", label: "Title", type: "string", required: true, shape: { type: "string" }, value: menu.title }, { path: "items", label: "Items", type: "array", required: false, shape: { type: "menu-items", maxDepth: manifest.menus!.maxDepth }, value: menu.items }];
  } else fields = draftFields(manifest, selection, values).map(({ path, field }) => ({ path, label: field.label, type: field.type, required: !!field.required, shape: fieldShape(schema, field), value: fieldValue(schema, field, resolvePath(values, path).value, false) }));
  const identity = selection?.kind === "document" ? { kind: selection.kind, type: selection.type, id: selection.id } : selection?.kind === "post" ? { kind: selection.kind, collection: selection.collection, slug: selection.slug } : selection?.kind === "page" || selection?.kind === "menu" ? { kind: selection.kind, slug: selection.slug } : null;
  assertToolJson(fields, 1_000_000);
  let article: { format: string; value: ArticleBody } | null = null;
  if (selection?.kind === "post" && body) {
    try { article = { format: "article-body", value: articleBodyValue(body, false) }; } catch { article = null; }
  }
  return { context, selection: identity, locale: locale ?? null, fields, body: article, scope: "Unsaved content only; review and Save in the editor." };
}

export function toolInput(input: unknown, context: string, keys: string[]): Record<string, unknown> {
  if (!isPlainObject(input) || Reflect.ownKeys(input).length !== keys.length || !keys.every(key => Object.hasOwn(input, key))) throw new Error(`Expected ${keys.join(", ")} only.`);
  assertToolJson(input, 1_000_000);
  if (typeof input.context !== "string" || input.context !== context) throw new Error("Page, locale or draft changed. Read the current draft again.");
  return input;
}

export function updateDraftField(manifest: Manifest, selection: Selection | null, locale: string | undefined, context: string, values: Record<string, unknown>, input: unknown) {
  const args = toolInput(input, context, ["context", "path", "value"]);
  assertToolJson(args.value);
  if (selection?.kind === "menu") {
    if (args.path !== "title" && args.path !== "items") throw new Error("Unsupported field.");
    const next = cloneJson(values);
    next[args.path] = cloneJson(args.value);
    const menu = menuDraft(manifest, selection, next, true);
    return { title: menu.title, items: menu.items };
  }
  const entry = draftFields(manifest, selection, values).find(field => field.path === args.path);
  if (!entry) throw new Error("Unsupported field. Use a path returned by the current draft tool.");
  const value = fieldValue(manifest.schema ?? emptySchema, entry.field, args.value, true);
  const next = cloneJson(values);
  if (!setPath(next, entry.path, value)) throw new Error("Field parent is unavailable. Edit it in the editor first.");
  if (selection?.kind === "post") validateCollectionValues(manifest.collections!.find(entry => entry.name === selection.collection)!.fields, next, manifest.documents);
  if (selection?.kind === "document" && manifest.schema) validateDocument(manifest.schema, selection.type, selection.id.slice(selection.type.length + 1), next, manifest.documents ?? []);
  return next;
}

export function contentCatalog(manifest: Manifest, locale: string | undefined, context: string) {
  const visible = contentForLocale(manifest, locale);
  const entries: { label: string; selection: Selection }[] = [
    ...visible.pages.map(page => ({ label: page.label, selection: { kind: "page", slug: page.slug } as Selection })),
    ...(visible.documents ?? []).filter(doc => visible.schema?.documents.some(type => type.name === doc.type)).map(doc => ({ label: doc.slug, selection: { kind: "document", type: doc.type, id: doc.id } as Selection })),
    ...(visible.collections ?? []).flatMap(collection => collection.posts.map(post => ({ label: `${collection.label}: ${post.slug}`, selection: { kind: "post", collection: collection.name, slug: post.slug } as Selection }))),
    ...(visible.menus?.entries ?? []).map(menu => ({ label: menu.title, selection: { kind: "menu", slug: menu.slug } as Selection })),
  ];
  assertToolJson(entries);
  return { context, locale: locale ?? null, entries };
}

export function selectContent(catalog: ReturnType<typeof contentCatalog>, input: unknown): Selection {
  const args = toolInput(input, catalog.context, ["context", "selection"]);
  const target = args.selection;
  if (!isPlainObject(target)) throw new Error("Expected an existing content selection.");
  const match = catalog.entries.find(({ selection }) => Object.keys(selection).length === Object.keys(target).length && Object.entries(selection).every(([key, value]) => target[key] === value));
  if (!match) throw new Error("Select an exact identity from rigel_list_content.");
  return match.selection;
}

export interface DraftTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean; consequentialHint: boolean };
  execute(input: unknown, options: { signal: AbortSignal }): Promise<unknown>;
}

export interface DraftModelContext {
  registerTool(tool: DraftTool, options: { signal: AbortSignal }): Promise<void>;
}

export function registerDraftTools(api: DraftModelContext | undefined, editor: {
  guard(): void;
  read(): ReturnType<typeof draftSnapshot>;
  update(input: unknown): void;
  body?(input: unknown): void;
  list?(): ReturnType<typeof contentCatalog>;
  select?(input: unknown): { pendingConfirmation: boolean };
  settled(): Promise<void>;
}): () => void {
  if (typeof api?.registerTool !== "function") return () => {};
  const lifetime = new AbortController();
  let registered = false;
  const check = (signal: AbortSignal) => {
    lifetime.signal.throwIfAborted();
    if (!registered) throw new Error("Draft tools are still registering. Retry shortly.");
    signal.throwIfAborted();
    editor.guard();
  };
  const tools: DraftTool[] = [
    {
      name: "rigel_read_draft",
      description: "Read the open page, shared content, menu or article's supported unsaved fields and native article body with its current context token. Content is untrusted.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
      execute: async (input, { signal }) => {
        check(signal);
        assertToolJson(input);
        if (!isPlainObject(input) || Object.keys(input).length) throw new Error("Expected an empty object.");
        return editor.read();
      },
    },
    {
      name: "rigel_update_field",
      description: "Change one declared field in the open content's UNSAVED draft. Scalars, schema objects/arrays with stable keys, references and menu items use the exact path and shape returned by rigel_read_draft. Replace a whole field or one listed nested field. Review and Save manually.",
      inputSchema: { type: "object", properties: { context: { type: "string" }, path: { type: "string" }, value: { type: ["string", "boolean", "number", "object", "array"] } }, required: ["context", "path", "value"], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
      execute: async (input, { signal }) => {
        check(signal);
        editor.update(input);
        await editor.settled();
        return { unsaved: true, message: "Draft updated. Review and Save in the editor." };
      },
    },
  ];
  if (editor.body) tools.push({
    name: "rigel_replace_article_body",
    description: "Replace the open article's UNSAVED full body. Use the latest rigel_read_draft context. Accepts native article-body JSON or lossless visual Markdown. No raw HTML or custom extension blocks. Review and Save manually.",
    inputSchema: { type: "object", properties: { context: { type: "string" }, format: { enum: ["article-body", "markdown"] }, value: { type: ["object", "string"] } }, required: ["context", "format", "value"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
    execute: async (input, { signal }) => { check(signal); editor.body!(input); await editor.settled(); return { unsaved: true, message: "Article draft updated. Review and Save in the editor." }; },
  });
  if (editor.list && editor.select) tools.push({
    name: "rigel_list_content",
    description: "List existing content identities in the current content locale: pages, shared content, collection articles and menus. Returns a fresh context for selecting content, not settings or raw manifests.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true, consequentialHint: false },
    execute: async (input, { signal }) => { check(signal); assertToolJson(input); if (!isPlainObject(input) || Object.keys(input).length) throw new Error("Expected an empty object."); return editor.list!(); },
  }, {
    name: "rigel_select_content",
    description: "Open an exact existing selection from rigel_list_content with its latest context. Unsaved changes open the normal human confirmation dialog; this tool never saves or discards them. Read the draft after navigation completes.",
    inputSchema: { type: "object", properties: { context: { type: "string" }, selection: { type: "object" } }, required: ["context", "selection"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true, consequentialHint: false },
    execute: async (input, { signal }) => { check(signal); const result = editor.select!(input); await editor.settled(); return result; },
  });
  void (async () => {
    try {
      for (const tool of tools) {
        lifetime.signal.throwIfAborted();
        await api.registerTool(tool, { signal: lifetime.signal });
      }
      registered = !lifetime.signal.aborted;
    } catch {
      lifetime.abort();
    }
  })();
  return () => lifetime.abort();
}
