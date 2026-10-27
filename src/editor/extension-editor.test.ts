import { expect, test, vi } from "vitest";
import { createEditor, $getRoot } from "lexical";
import { emptyBody } from "../article-body";
import { ExtensionNode, cloneBlockData } from "./blocks/extension";
import { createExtensionPreview, extensionBlock, mountExtensionComponent, registerExtensionNodes } from "./lib/extension-preview";

const { update, mounted, unmounted, validate } = vi.hoisted(() => ({ update: vi.fn(), mounted: vi.fn(), unmounted: vi.fn(async () => {}), validate: vi.fn((data: Record<string, unknown>) => { if (typeof data.text !== "string") throw new Error("Text required"); }) }));
vi.mock("svelte", () => ({ mount: (...args: unknown[]) => { mounted(...args); return { update }; }, unmount: unmounted }));
vi.mock("./lib/ExtensionMount.svelte", () => ({ default: () => {} }));
vi.mock("virtual:rigel-extensions", () => ({ default: [{ name: "example", blocks: [{ name: "cta", label: "Call to action", editor: () => {}, render: () => {}, validate }] }] }));

function target() {
  return { isConnected: true, textContent: "", replaceChildren: vi.fn(), dispatchEvent: vi.fn(), ownerDocument: { defaultView: { CustomEvent: class { constructor(public type: string, public options: unknown) {} } } } } as unknown as HTMLElement;
}

test("extension JSON round-trips missing registrations without losing opaque data or adding children", () => {
  const editor = createEditor({ nodes: [ExtensionNode], onError: error => { throw error; } });
  const state = emptyBody();
  const node = { type: "extension", version: 1, name: "missing", data: { text: "<script>never execute</script>", nested: [{ enabled: false, count: 0 }] } };
  state.root.children = [node];
  editor.setEditorState(editor.parseEditorState(JSON.stringify(state)));
  expect(editor.getEditorState().toJSON().root.children).toEqual([node]);
  const copy = cloneBlockData(node.data); copy.nested = [];
  expect(node.data.nested).toHaveLength(1);
  editor.update(() => { const current = $getRoot().getFirstChild() as ExtensionNode; current.setData({ text: "changed" }); }, { discrete: true });
  expect(editor.getEditorState().toJSON().root.children[0]).toEqual({ ...node, data: { text: "changed" } });
});

test("registered component mounts on supplied document target and updates without remounting", async () => {
  mounted.mockClear(); unmounted.mockClear(); update.mockClear();
  const element = target(), raw = { text: "hello" };
  const stop = mountExtensionComponent(element, "cta", raw, () => {});
  await vi.waitFor(() => expect(mounted).toHaveBeenCalledTimes(1));
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(mounted.mock.calls[0]?.[1]).toMatchObject({ target: element, props: { data: raw, onchange: expect.any(Function) } });
  expect((mounted.mock.calls[0]?.[1] as { props: { data: unknown } }).props.data).not.toBe(raw);
  stop.update({ text: "next" });
  expect(update).toHaveBeenCalledWith({ text: "next" });
  expect(mounted).toHaveBeenCalledTimes(1);
  stop(); await Promise.resolve();
  expect(unmounted).toHaveBeenCalledTimes(1);
});

test("unknown, prototype and invalid blocks fail closed with readable opaque fallback", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(extensionBlock("constructor")).toBeUndefined();
    const missing = target(); mountExtensionComponent(missing, "missing", { text: "<img onerror=evil()>" });
    expect(missing.textContent).toContain("<img onerror=evil()>");
    const invalid = target(); mountExtensionComponent(invalid, "cta", { text: false });
    expect(invalid.textContent).toContain("Call to action");
    expect(invalid.dispatchEvent).toHaveBeenCalled();
  } finally { consoleError.mockRestore(); }
});

test("node lifecycle validates onchange, keeps its instance on edits, and cleans detached nodes and editor disposal", async () => {
  mounted.mockClear(); unmounted.mockClear(); update.mockClear();
  let observe = () => {};
  const element = target();
  Object.assign(element.ownerDocument.defaultView!, {
    MutationObserver: class { constructor(callback: () => void) { observe = callback; } observe() {} disconnect() {} },
    addEventListener() {}, removeEventListener() {},
  });
  const editor = createEditor({ nodes: [ExtensionNode], onError: error => { throw error; } });
  editor.update(() => { $getRoot().append(new ExtensionNode("cta", { text: "hello" })); }, { discrete: true });
  editor._headless = true;
  vi.spyOn(editor, "getRootElement").mockReturnValue(element);
  vi.spyOn(editor, "getElementByKey").mockReturnValue(element);
  const stop = registerExtensionNodes(editor);
  await vi.waitFor(() => expect(mounted).toHaveBeenCalledTimes(1));
  const props = (mounted.mock.calls[0]?.[1] as { props: { onchange: (data: unknown) => void } }).props;
  props.onchange({ text: "hello world" });
  expect(update).toHaveBeenCalledWith({ text: "hello world" });
  expect(mounted).toHaveBeenCalledTimes(1);
  expect((editor.getEditorState().toJSON().root.children[0] as unknown as { data: unknown }).data).toEqual({ text: "hello world" });
  Object.defineProperty(element, "isConnected", { value: false, configurable: true });
  observe();
  expect(unmounted).toHaveBeenCalledTimes(1);
  stop(); stop();
  expect(unmounted).toHaveBeenCalledTimes(1);
});

test("preview creation is inert JSON metadata, never HTML insertion", () => {
  const element = { dataset: {}, textContent: "" };
  const doc = { createElement: vi.fn(() => element) } as unknown as Document;
  expect(createExtensionPreview("cta", { text: "<script>evil()</script>" }, doc)).toBe(element);
  expect(element.dataset).toEqual({ rigelExtension: "cta", rigelExtensionData: '{"text":"<script>evil()</script>"}' });
  expect(element.textContent).toBe("Extension: cta");
});
