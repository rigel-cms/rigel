import type { Component } from "svelte";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type BlockData = { [key: string]: JsonValue };

export interface ExtensionSelection {
  text: string;
  blockType: string;
  block?: { name: string; data: BlockData };
}

export interface ExtensionContext {
  readonly selection: ExtensionSelection;
  insertText(text: string): void;
  insertBlock(name: string, data: BlockData): void;
  updateBlock(data: BlockData): void;
}

export interface ExtensionButtonProps {
  label: string;
  disabled: boolean;
  onclick: () => void;
}

export interface ExtensionBlockProps {
  data: BlockData;
  onchange: (data: BlockData) => void;
}

export interface ExtensionCommand {
  name: string;
  label: string;
  slash?: string;
  toolbar?: boolean;
  group?: string;
  button?: Component<ExtensionButtonProps>;
  run: (context: ExtensionContext) => void | Promise<void>;
}

export interface ExtensionBlock {
  name: string;
  label: string;
  editor: Component<ExtensionBlockProps>;
  render: Component<{ data: BlockData }>;
  validate: (data: BlockData) => void;
  toMarkdown?: (data: BlockData) => string;
}

export interface RigelExtension {
  name: string;
  commands?: ExtensionCommand[];
  blocks?: ExtensionBlock[];
  groups?: ExtensionGroup[];
}

export function defineExtension<T extends RigelExtension>(extension: T): T {
  return extension;
}

const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);
const builtins = new Set(["paragraph", "h1", "h2", "h3", "h4", "h5", "h6", "quote", "bullet", "number", "code", "image", "divider", "table", "video", "youtube", "vimeo", "bold", "italic", "underline", "strikethrough", "subscript", "superscript", "highlight", "link", "undo", "redo", "clear", "clear-formatting"]);

export function validateExtensionName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value) || forbiddenKeys.has(value)) throw new Error("rigel: invalid extension identifier");
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function objectShape(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!plainObject(value) || required.some(key => !Object.hasOwn(value, key))) throw new Error("rigel: invalid extension object");
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (typeof key !== "string" || ![...required, ...optional].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) throw new Error("rigel: invalid extension property");
  }
}

export function validateBlockData(value: unknown): asserts value is BlockData {
  if (!plainObject(value)) throw new Error("rigel: extension data must be a plain JSON object");
  let nodes = 0;
  const ancestors = new Set<object>();
  function check(item: unknown, depth: number) {
    if (++nodes > 10000 || depth > 16) throw new Error("rigel: extension data exceeds depth or node limit");
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item)) return;
    if (typeof item !== "object" || !item || (!Array.isArray(item) && !plainObject(item)) || ancestors.has(item)) throw new Error("rigel: extension data must be finite plain JSON without cycles");
    ancestors.add(item);
    const array = Array.isArray(item);
    if (array && Object.getPrototypeOf(item) !== Array.prototype) throw new Error("rigel: extension data must contain plain JSON arrays");
    if (array && item.length > 10000) throw new Error("rigel: extension data exceeds node limit");
    const keys = Reflect.ownKeys(item);
    if (array && keys.length !== item.length + 1) throw new Error("rigel: extension data contains a sparse or decorated array");
    for (const key of keys) {
      if (array && key === "length") continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
      if (typeof key !== "string" || forbiddenKeys.has(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) throw new Error("rigel: extension data contains a non-JSON property");
      check(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
  }
  check(value, 0);
  if (new TextEncoder().encode(JSON.stringify(value)).length > 100000) throw new Error("rigel: extension data exceeds 100000 UTF-8 bytes");
}

export interface ExtensionGroup {
  name: string;
  label: string;
  button?: Component<ExtensionButtonProps>;
}

export function resolveExtensions(modules: RigelExtension[]): { commands: ExtensionCommand[]; blocks: ExtensionBlock[]; groups: ExtensionGroup[] } {
  if (!Array.isArray(modules)) throw new Error("rigel: extensions must be an array");
  const commands: ExtensionCommand[] = [], blocks: ExtensionBlock[] = [], groups: ExtensionGroup[] = [];
  const modulesSeen = new Set<string>(), names = new Set<string>(), slashes = new Set<string>(), groupNames = new Set<string>();
  function unique(name: unknown, seen: Set<string>, builtin = false) {
    validateExtensionName(name);
    if (seen.has(name) || builtin && builtins.has(name)) throw new Error(`rigel: duplicate or reserved extension name: ${name}`);
    seen.add(name);
  }
  for (const module of modules) {
    objectShape(module, ["name"], ["commands", "blocks", "groups"]);
    unique(module.name, modulesSeen);
    for (const kind of ["commands", "blocks", "groups"] as const) {
      if (!Object.hasOwn(module, kind)) continue;
      const entries = module[kind];
      if (!Array.isArray(entries)) throw new Error(`rigel: extension ${kind} must be an array`);
      for (const entry of entries) {
        objectShape(entry, kind === "commands" ? ["name", "label", "run"] : kind === "blocks" ? ["name", "label", "editor", "render", "validate"] : ["name", "label"], kind === "commands" ? ["slash", "toolbar", "button", "group"] : kind === "blocks" ? ["toMarkdown"] : ["button"]);
        unique(entry.name, kind === "groups" ? groupNames : names, kind !== "groups");
        if (typeof entry.label !== "string" || !entry.label.trim()) throw new Error("rigel: extension label is required");
        for (const key of kind === "commands" ? ["run", "button"] : kind === "blocks" ? ["editor", "render", "validate", "toMarkdown"] : ["button"]) {
          if (Object.hasOwn(entry, key) && typeof entry[key] !== "function") throw new Error(`rigel: extension ${key} must be a function/component`);
        }
        if (kind === "commands") {
          if (Object.hasOwn(entry, "toolbar") && typeof entry.toolbar !== "boolean") throw new Error("rigel: extension toolbar must be boolean");
          if (Object.hasOwn(entry, "slash")) unique(entry.slash, slashes, true);
          if (Object.hasOwn(entry, "group")) validateExtensionName(entry.group);
          commands.push(entry as unknown as ExtensionCommand);
        } else if (kind === "blocks") blocks.push(entry as unknown as ExtensionBlock);
        else groups.push(entry as unknown as ExtensionGroup);
      }
    }
  }
  for (const command of commands) {
    if (command.group !== undefined && !groupNames.has(command.group)) throw new Error(`rigel: unknown extension group: ${command.group}`);
  }
  return { commands, blocks, groups };
}

export function validateExtensionBlocks(body: unknown, blocks: ExtensionBlock[]): void {
  const children = (body as { root?: { children?: unknown[] } } | null)?.root?.children;
  if (!Array.isArray(children)) return;
  for (const raw of children) {
    if (!raw || typeof raw !== "object" || (raw as { type?: unknown }).type !== "extension") continue;
    const node = raw as { name: string; data: unknown };
    validateExtensionName(node.name);
    validateBlockData(node.data);
    blocks.find(block => block.name === node.name)?.validate(node.data);
  }
}
