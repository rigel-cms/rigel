import modules from "virtual:rigel-extensions";
import { mount, unmount } from "svelte";
import { $getRoot, $getNodeByKey, type LexicalEditor } from "lexical";
import { resolveExtensions } from "../../extensions";
import type { BlockData, ExtensionBlock } from "../../extensions";
import { ExtensionNode, cloneBlockData } from "../blocks/extension";


const resolved = resolveExtensions(modules);
export const extensionRegistry = {
  commands: Object.fromEntries(resolved.commands.map(command => [command.name, command])),
  blocks: Object.fromEntries(resolved.blocks.map(block => [block.name, block])),
};
export function extensionBlock(name: string): ExtensionBlock | undefined {
  return Object.hasOwn(extensionRegistry.blocks, name) ? extensionRegistry.blocks[name] : undefined;
}
export function reportExtensionError(target: HTMLElement, cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error("Rigel extension:", cause);
  target.dispatchEvent(new target.ownerDocument.defaultView!.CustomEvent("rigel-extension-error", { bubbles: true, detail: message }));
}
type ExtensionMountHandle = (() => void) & { update: (data: BlockData) => void };
export function mountExtensionComponent(target: HTMLElement, name: string, raw: unknown, onchange?: (data: BlockData) => void): ExtensionMountHandle {
  const report = (cause: unknown) => reportExtensionError(target, cause);
  const block = extensionBlock(name);
  const fallback = (data: unknown) => { target.textContent = `Unavailable extension: ${block?.label ?? name}\n${JSON.stringify(data, null, 2)}`; };
  const failed = Object.assign(() => {}, { update: fallback });
  target.replaceChildren();
  if (!block) { fallback(raw); return failed; }
  try {
    let data = cloneBlockData(raw);
    block.validate(cloneBlockData(data));
    let disposed = false;
    let component: { update: (data: BlockData) => void } | undefined;
    void import("./ExtensionMount.svelte").then(({ default: ExtensionMount }) => {
      if (disposed || !target.isConnected) return;
      component = mount(ExtensionMount, { target, props: { component: onchange ? block.editor : block.render, data, onchange, report } }) as unknown as { update: (data: BlockData) => void };
    }).catch(cause => { if (!disposed) { fallback(data); report(cause); } });
    return Object.assign(() => { disposed = true; if (component) void unmount(component).catch(report); }, { update: (next: BlockData) => {
      try { const copy = cloneBlockData(next); block.validate(cloneBlockData(copy)); data = copy; component?.update(copy); }
      catch (cause) { report(cause); }
    } });
  } catch (cause) { fallback(raw); report(cause); return failed; }
}
export function createExtensionPreview(name: string, data: unknown, doc: Document) {
  const element = doc.createElement("div");
  element.dataset.rigelExtension = name;
  element.dataset.rigelExtensionData = JSON.stringify(cloneBlockData(data));
  element.textContent = `Extension: ${name}`;
  return element;
}
const previewMounts = new WeakMap<HTMLElement, ExtensionMountHandle>();
export function mountExtensionPreviews(root: ParentNode): () => void {
  const doc = root.nodeType === 9 ? root as Document : root.ownerDocument!;
  const frame = doc.defaultView?.frameElement;
  const mounted = new Map<HTMLElement, { stop: ExtensionMountHandle; signature: string }>();
  const markers = () => [...(root.nodeType === 1 && (root as Element).hasAttribute("data-rigel-extension") ? [root as HTMLElement] : []), ...root.querySelectorAll<HTMLElement>("[data-rigel-extension]")];
  const sync = () => {
    if (frame && !frame.isConnected) { cleanup(); return; }
    for (const [element, entry] of mounted) if (!element.isConnected || !root.contains(element) || element.closest('[contenteditable="true"]')) { entry.stop(); mounted.delete(element); previewMounts.delete(element); }
    for (const element of markers()) {
      if (!element.isConnected || element.closest('[contenteditable="true"]')) continue;
      const signature = `${element.dataset.rigelExtension}\n${element.dataset.rigelExtensionData}`;
      const existing = mounted.get(element);
      if (existing?.signature === signature || (!existing && previewMounts.has(element))) continue;
      if (existing) { existing.stop(); mounted.delete(element); previewMounts.delete(element); }
      try {
        const stop = mountExtensionComponent(element, element.dataset.rigelExtension!, JSON.parse(element.dataset.rigelExtensionData ?? "null"));
        mounted.set(element, { stop, signature }); previewMounts.set(element, stop);
      } catch (cause) { element.textContent = "Extension unavailable"; reportExtensionError(element, cause); }
    }
  };
  const observer = new doc.defaultView!.MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-rigel-extension", "data-rigel-extension-data", "contenteditable"] });
  if (frame) observer.observe(frame.ownerDocument, { childList: true, subtree: true });
  const cleanup = () => { observer.disconnect(); for (const [element, entry] of mounted) { entry.stop(); previewMounts.delete(element); } mounted.clear(); doc.defaultView?.removeEventListener("pagehide", cleanup); };
  doc.defaultView?.addEventListener("pagehide", cleanup);
  sync();
  return cleanup;
}

export function registerExtensionNodes(editor: LexicalEditor) {
  const mounted = new Map<string, { element: HTMLElement; name: string; json: string; stop: ExtensionMountHandle }>();
  const doc = editor.getRootElement()!.ownerDocument;
  const frame = doc.defaultView?.frameElement;
  let disposed = false;
  const sync = () => {
    if (disposed) return;
    if (frame && !frame.isConnected) { cleanup(); return; }
    editor.getEditorState().read(() => {
      const nodes = new Map($getRoot().getChildren().filter((node): node is ExtensionNode => node instanceof ExtensionNode).map(node => [node.getKey(), node]));
      for (const [key, entry] of mounted) {
        const node = nodes.get(key), element = editor.getElementByKey(key);
        if (!node || !element?.isConnected || element !== entry.element || node.__name !== entry.name) { entry.stop(); mounted.delete(key); }
      }
      for (const [key, node] of nodes) {
        const element = editor.getElementByKey(key);
        if (!element?.isConnected) continue;
        const json = JSON.stringify(node.__data), existing = mounted.get(key);
        if (existing) { if (existing.json !== json) { existing.json = json; existing.stop.update(node.__data); } continue; }
        const stop = mountExtensionComponent(element, node.__name, node.__data, data => {
          try {
            const copy = cloneBlockData(data), block = extensionBlock(node.__name);
            if (disposed || !element.isConnected || !mounted.has(key) || !editor.isEditable() || !block) throw new Error("Extension editor is no longer active");
            block.validate(cloneBlockData(copy));
            editor.update(() => { const current = $getNodeByKey(key); if (current instanceof ExtensionNode) current.setData(copy); }, { discrete: true, tag: "history-push" });
          } catch (cause) { reportExtensionError(element, cause); }
        });
        mounted.set(key, { element, name: node.__name, json, stop });
      }
    });
  };
  const observer = new doc.defaultView!.MutationObserver(sync);
  observer.observe(doc, { childList: true, subtree: true });
  if (frame) observer.observe(frame.ownerDocument, { childList: true, subtree: true });
  const stopUpdates = editor.registerUpdateListener(sync);
  const cleanup = () => { if (disposed) return; disposed = true; stopUpdates(); observer.disconnect(); for (const entry of mounted.values()) entry.stop(); mounted.clear(); doc.defaultView?.removeEventListener("pagehide", cleanup); };
  doc.defaultView?.addEventListener("pagehide", cleanup);
  sync();
  return cleanup;
}
