import { DecoratorNode, type NodeKey } from "lexical";
import { embedProviderLabel, embedSrc, type EmbedProvider, type EmbedRef } from "../lib/embeds";

export type EmbedData = { provider: EmbedProvider; id: string; title?: string; privacy: boolean };
export class EmbedNode extends DecoratorNode<null> {
  __embed: EmbedData;
  static getType() { return "embed"; }
  static clone(node: EmbedNode) { return new EmbedNode(node.__embed, node.__key); }
  constructor(embed: EmbedData = { provider: "youtube", id: "", privacy: true }, key?: NodeKey) { super(key); this.__embed = embed; }
  static importJSON(raw: unknown) { const embed = raw as EmbedData; return new EmbedNode({ provider: embed.provider, id: embed.id, title: embed.title, privacy: embed.privacy !== false }); }
  exportJSON() { return { ...this.__embed, type: "embed", version: 1 }; }
  createDOM() {
    const figure = document.createElement("figure");
    figure.className = "media-embed";
    const frame = document.createElement("iframe");
    frame.src = embedSrc(this.__embed as EmbedRef, this.__embed.privacy);
    frame.title = this.__embed.title || `${embedProviderLabel(this.__embed as EmbedRef)} video`;
    frame.loading = "lazy";
    frame.allow = "accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    frame.allowFullscreen = true;
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    figure.append(frame);
    return figure;
  }
  updateDOM() { return true; }
  decorate() { return null; }
  isInline() { return false; }
  getTextContent() { return this.__embed.title ?? ""; }
}
export const create = (embed?: EmbedData) => new EmbedNode(embed);
