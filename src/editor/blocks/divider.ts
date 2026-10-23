import { DecoratorNode, type NodeKey, type SerializedLexicalNode } from "lexical";

export class DividerNode extends DecoratorNode<null> {
  static getType() { return "divider"; }
  static clone(node: DividerNode) { return new DividerNode(node.__key); }
  constructor(key?: NodeKey) { super(key); }
  static importJSON(_node: SerializedLexicalNode) { return new DividerNode(); }
  exportJSON() { return { type: "divider", version: 1 }; }
  createDOM() { return document.createElement("hr"); }
  updateDOM() { return false; }
  decorate() { return null; }
  isInline() { return false; }
}
export const create = () => new DividerNode();
