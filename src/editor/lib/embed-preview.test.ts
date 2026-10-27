import { expect, test, vi } from "vitest";
import { get, writable } from "svelte/store";
import { $createNodeSelection, $getRoot, $getSelection, $setSelection, createEditor } from "lexical";
import { createEmptyHistoryState, registerHistory } from "@lexical/history";
import { EmbedNode } from "../blocks/embed";
import { VideoNode } from "../blocks/video";
import type { Translator } from "../i18n";
import { t } from "../i18n";
import { subscribeMediaLabels } from "./embed-preview";

vi.mock("../i18n", async () => {
  const { get, writable } = await import("svelte/store");
  const t = writable<Translator>((key, parameters) => `initial:${key}:${JSON.stringify(parameters)}`);
  return { t, translate: ((key, parameters) => get(t)(key, parameters)) satisfies Translator };
});

class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  style = { cssText: "" };
  textContent = "";
  constructor(public tagName: string) {}
  append(...elements: Element[]) { this.children.push(...elements); }
  addEventListener() {}
  querySelectorAll(): Element[] {
    return this.children.flatMap(child => [
      ...(Object.hasOwn(child.dataset, "rigelMediaLabel") ? [child] : []),
      ...child.querySelectorAll(),
    ]);
  }
}

test("media labels refresh in place without editing saved content, selection or history; cleanup unsubscribes", () => {
  const doc = { createElement: (tag: string) => new Element(tag) };
  vi.stubGlobal("document", doc);
  const root = new Element("div");
  const editor = createEditor({ nodes: [EmbedNode, VideoNode], onError: error => { throw error; } });
  const history = createEmptyHistoryState();
  const stopHistory = registerHistory(editor, history, 300);
  const stopLabels = subscribeMediaLabels(root as unknown as HTMLElement);
  try {
    editor.update(() => {
      const nodes = [
        new EmbedNode({ provider: "youtube", id: "dQw4w9WgXcQ", privacy: true }),
        new EmbedNode({ provider: "vimeo", id: "76979871", privacy: true, title: "Saved title" }),
        new VideoNode({ src: "/video.mp4", caption: "Saved caption" }),
      ];
      $getRoot().append(...nodes);
      for (const node of nodes) root.append(node.createDOM() as unknown as Element);
      const selection = $createNodeSelection();
      selection.add(nodes[0].getKey());
      $setSelection(selection);
    }, { discrete: true });
    const state = editor.getEditorState();
    const selection = state.read(() => $getSelection());
    const json = JSON.stringify(state.toJSON());
    const undo = [...history.undoStack];
    const redo = [...history.redoStack];
    const elements = root.querySelectorAll();
    expect(elements).toHaveLength(8);
    expect(elements.every(element => element.textContent.startsWith("initial:"))).toBe(true);
    const translate: Translator = (key, parameters) => `changed:${key}:${JSON.stringify(parameters)}`;
    (t as ReturnType<typeof writable<Translator>>).set(translate);
    expect(root.querySelectorAll()).toEqual(elements);
    expect(elements.every(element => element.textContent.startsWith("changed:"))).toBe(true);
    expect(elements.find(element => element.tagName === "figcaption")?.textContent).toContain("changed:media.video");
    expect(elements.some(element => element.textContent.includes("Saved title"))).toBe(true);
    expect(root.children[2].children[1].textContent).toBe("Saved caption");
    expect(editor.getEditorState()).toBe(state);
    expect(state.read(() => $getSelection())).toBe(selection);
    expect(JSON.stringify(state.toJSON())).toBe(json);
    expect(history.undoStack).toEqual(undo);
    expect(history.redoStack).toEqual(redo);
    stopLabels();
    (t as ReturnType<typeof writable<Translator>>).set((key) => `unsubscribed:${key}`);
    expect(elements.every(element => element.textContent.startsWith("changed:"))).toBe(true);
    expect(get(t)("media.video")).toBe("unsubscribed:media.video");
  } finally {
    stopLabels();
    stopHistory();
    vi.unstubAllGlobals();
  }
});
