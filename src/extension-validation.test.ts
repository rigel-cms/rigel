import { expect, test } from "vitest";
import { defineExtension, resolveExtensions, validateBlockData, type RigelExtension } from "./extensions";
import { validateBody } from "./article-body";

const component = (() => {}) as never;
const command = { name: "insert-note", label: "Note", run() {} };
const block = { name: "note", label: "Note", editor: component, render: component, validate() {} };
const extension = (): RigelExtension => ({ name: "notes", commands: [{ ...command }], blocks: [{ ...block }] });
const body = (node: unknown) => ({ root: { type: "root", version: 1, children: [node] } });
const node = { type: "extension", version: 1, name: "note", data: { text: "Hi" } };

test("registration preserves components and functions without mutating modules", () => {
  const module = defineExtension(extension());
  const resolved = resolveExtensions([module]);
  expect(resolved).toEqual({ commands: module.commands, blocks: module.blocks, groups: [] });
  expect(resolved.commands[0].run).toBe(command.run);
  expect(resolved.blocks[0].render).toBe(component);
  expect(resolveExtensions([])).toEqual({ commands: [], blocks: [], groups: [] });
});

test("groups preserve registration order and components in a separate namespace", () => {
  const group = { name: "note", label: "Notes", button: component };
  const module = { ...extension(), groups: [group, { name: "bold", label: "Formatting" }] };
  const resolved = resolveExtensions([module]);
  expect(resolved.groups).toEqual(module.groups);
  expect(resolved.groups[0]).toBe(group);
  expect(resolved.groups[0].button).toBe(component);
  expect(resolved.commands).toEqual(module.commands);
  expect(resolved.blocks).toEqual(module.blocks);
});

test("groups reject invalid shapes, identifiers, labels, components and duplicates", () => {
  const group = { name: "notes", label: "Notes" };
  for (const groups of [null, {}, Array(1), [null], [Object.create(group)], [{ label: "Notes" }], [{ ...group, extra: true }], [{ ...group, [Symbol()]: true }], [Object.defineProperty({ ...group }, "button", { get() { throw new Error("getter ran"); }, enumerable: true })]]) expect(() => resolveExtensions([{ name: "notes", groups } as never])).toThrow(/extension/);
  for (const name of ["", "Note", "a_b", "a/b", "a".repeat(65), "constructor", "prototype", "__proto__"]) expect(() => resolveExtensions([{ name: "notes", groups: [{ ...group, name }] } as never])).toThrow(/identifier/);
  for (const bad of [{ label: "" }, { label: " " }, { label: 1 }, { button: {} }, { button: undefined }]) expect(() => resolveExtensions([{ name: "notes", groups: [{ ...group, ...bad }] } as never])).toThrow(/extension/);
  expect(() => resolveExtensions([{ name: "notes", groups: [group, group] } as never])).toThrow(/duplicate/);
  expect(() => resolveExtensions([{ name: "notes", groups: [group] }, { name: "other", groups: [group] }] as never)).toThrow(/duplicate/);
});

test("command group references resolve after all modules regardless of declaration order", () => {
  const grouped = { ...command, group: "notes" };
  const groups = [{ name: "notes", label: "Notes" }];
  const registration = { name: "group-owner", groups };
  const consumer = { name: "commands", commands: [grouped, { ...grouped, name: "hidden-note", toolbar: false }] };
  for (const modules of [[consumer, registration], [registration, consumer], [{ ...consumer, groups }]]) {
    const resolved = resolveExtensions(modules);
    expect(resolved.groups).toEqual(groups);
    expect(resolved.commands).toEqual(consumer.commands);
    expect(resolved.commands[1].toolbar).toBe(false);
  }
});

test("command groups reject invalid identifiers and missing registrations", () => {
  const groups = [{ name: "notes", label: "Notes" }];
  for (const group of [undefined, null, 1, "", "Note", "a_b", "a/b", "a".repeat(65), "constructor", "prototype", "__proto__"]) expect(() => resolveExtensions([{ name: "notes", groups, commands: [{ ...command, group }] }] as never)).toThrow(/identifier/);
  expect(() => resolveExtensions([{ name: "notes", commands: [{ ...command, group: "missing" }] }])).toThrow(/unknown extension group: missing/);
  expect(() => resolveExtensions([{ ...extension(), commands: [{ ...command, group: "note", toolbar: false }] }])).toThrow(/unknown extension group: note/);
});

test("registration rejects wrong shapes, unknown keys, invalid identifiers and inherited properties", () => {
  for (const modules of [null, {}, Array(1), [null], [{ ...extension(), extra: true }], [Object.create(extension())]]) expect(() => resolveExtensions(modules as never)).toThrow();
  for (const name of ["", "Note", "a_b", "a/b", "a".repeat(65), "constructor", "prototype", "__proto__"]) {
    expect(() => resolveExtensions([{ ...extension(), name }])).toThrow();
    expect(() => resolveExtensions([{ name: "notes", blocks: [{ ...block, name }] }])).toThrow();
  }
  for (const bad of [{ run: undefined }, { label: " " }, { slash: "image" }, { slash: "/note" }, { toolbar: "yes" }, { button: {} }, { extra: true }]) expect(() => resolveExtensions([{ name: "notes", commands: [{ ...command, ...bad } as never] }])).toThrow();
  for (const bad of [{ editor: {} }, { render: undefined }, { validate: false }, { toMarkdown: "x" }, { label: "" }, { extra: true }]) expect(() => resolveExtensions([{ name: "notes", blocks: [{ ...block, ...bad } as never] }])).toThrow();
  expect(() => resolveExtensions([{ name: "notes", commands: Array(1) }])).toThrow();
  expect(() => resolveExtensions([{ name: "notes", blocks: Array(1) }])).toThrow();
});

test("duplicate registrations and built-in overrides fail across modules", () => {
  expect(() => resolveExtensions([extension(), extension()])).toThrow();
  expect(() => resolveExtensions([extension(), { name: "other", commands: [command] }])).toThrow();
  expect(() => resolveExtensions([extension(), { name: "other", blocks: [block] }])).toThrow();
  expect(() => resolveExtensions([{ name: "notes", commands: [{ ...command, name: "note" }], blocks: [block] }])).toThrow();
  expect(() => resolveExtensions([{ name: "notes", commands: [{ ...command, slash: "note" }, { ...command, name: "another", slash: "note" }] }])).toThrow();
  for (const name of ["paragraph", "h1", "h2", "h3", "h4", "h5", "h6", "quote", "bullet", "number", "code", "image", "divider", "table", "video", "youtube", "vimeo", "bold", "undo"]) expect(() => resolveExtensions([{ name: "notes", commands: [{ ...command, name }] }])).toThrow();
});

test("block data allows only bounded finite plain JSON without lossy serialization", () => {
  const shared = { ok: true };
  for (const value of [{}, { nested: [null, false, 1, "x", {}] }, { a: shared, b: shared }, Object.create(null)]) expect(() => validateBlockData(value)).not.toThrow();
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  for (const value of [null, [], 1, { x: undefined }, { x: NaN }, { x: Infinity }, { x: 1n }, { x() {} }, { x: new Date() }, { x: new Map() }, { x: Array(1) }, cycle, JSON.parse('{"__proto__":{}}'), { constructor: 1 }, { x: { prototype: 1 } }, { [Symbol()]: 1 }, Object.defineProperty({}, "x", { get() { throw new Error("getter ran"); }, enumerable: true }), Object.defineProperty({}, "x", { value: 1 })]) expect(() => validateBlockData(value)).toThrow(/extension/i);
  expect(() => validateBlockData({ x: "x".repeat(99992) })).not.toThrow();
  expect(() => validateBlockData({ x: "x".repeat(99993) })).toThrow();
  expect(() => validateBlockData({ x: "é".repeat(50000) })).toThrow();
  expect(() => validateBlockData({ x: Array(9998).fill(null) })).not.toThrow();
  expect(() => validateBlockData({ x: Array(9999).fill(null) })).toThrow();
  let nested: unknown = null;
  for (let i = 0; i < 16; i++) nested = { x: nested };
  expect(() => validateBlockData(nested)).not.toThrow();
  expect(() => validateBlockData({ x: nested })).toThrow();
});

test("generic extension envelope is exact, root-only, safe even without registration", () => {
  expect(() => validateBody(body(node))).not.toThrow();
  for (const bad of [{ ...node, children: [] }, { ...node, extra: true }, { ...node, name: "Bad" }, { ...node, version: 2 }, { ...node, data: null }, { ...node, data: { value: undefined } }, Object.create(node), { type: "paragraph", version: 1, children: [node] }, { type: "quote", version: 1, children: [node] }]) expect(() => validateBody(body(bad))).toThrow();
});
