import { DecoratorNode, type LexicalEditor, type NodeKey } from "lexical";
import type { BlockData } from "../../extensions";
import { validateBlockData } from "../../extensions";

export function cloneBlockData(data: unknown): BlockData {
  validateBlockData(data);
  return JSON.parse(JSON.stringify(data));
}

export class ExtensionNode extends DecoratorNode<null> {
  __name: string;
  __data: BlockData;
  static getType() { return "extension"; }
  static clone(node: ExtensionNode) { return new ExtensionNode(node.__name, node.__data, node.__key); }
  constructor(name: string, data: BlockData, key?: NodeKey) { super(key); this.__name = name; this.__data = cloneBlockData(data); }
  static importJSON(raw: unknown) { const node = raw as { name: string; data: BlockData }; return new ExtensionNode(node.name, node.data); }
  exportJSON() { return { type: "extension", version: 1, name: this.__name, data: cloneBlockData(this.__data) }; }
  setData(data: BlockData) { this.getWritable().__data = cloneBlockData(data); }
  createDOM(_config: unknown, editor: LexicalEditor) {
    const element = (editor.getRootElement()?.ownerDocument ?? document).createElement("div");
    element.contentEditable = "false";
    element.dataset.rigelExtensionEditor = this.__name;
    return element;
  }
  updateDOM() { return false; }
  decorate() { return null; }
  isInline() { return false; }
  getTextContent() { return this.__name; }
}
