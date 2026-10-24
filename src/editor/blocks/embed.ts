import { DecoratorNode, type NodeKey } from "lexical";
import type { EmbedProvider } from "../lib/embeds";
import { createEmbedPreview } from "../lib/embed-preview";

export type EmbedData = { provider: EmbedProvider; id: string; title?: string; privacy: boolean };
export class EmbedNode extends DecoratorNode<null> {
  __embed: EmbedData;
  static getType() { return "embed"; }
  static clone(node: EmbedNode) { return new EmbedNode(node.__embed, node.__key); }
  constructor(embed: EmbedData = { provider: "youtube", id: "", privacy: true }, key?: NodeKey) { super(key); this.__embed = embed; }
  static importJSON(raw: unknown) { const embed = raw as EmbedData; return new EmbedNode({ provider: embed.provider, id: embed.id, title: embed.title, privacy: embed.privacy !== false }); }
  exportJSON() { return { ...this.__embed, type: "embed", version: 1 }; }
  createDOM() {
    return createEmbedPreview(this.__embed, document, true);
  }
  updateDOM() { return true; }
  decorate() { return null; }
  isInline() { return false; }
  getTextContent() { return this.__embed.title ?? ""; }
}
export const create = (embed?: EmbedData) => new EmbedNode(embed);
