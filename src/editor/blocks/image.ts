import { DecoratorNode, type NodeKey } from "lexical";
import { safePreviewUrl } from "../../preview-urls";

export type ImageData = { src: string; alt: string; url?: string; credit?: string; creditURL?: string };
export class ImageNode extends DecoratorNode<null> {
  __image: ImageData;
  static getType() { return "image"; }
  static clone(node: ImageNode) { return new ImageNode(node.__image, node.__key); }
  constructor(image: ImageData = { src: "", alt: "" }, key?: NodeKey) { super(key); this.__image = image; }
  static importJSON(raw: unknown) { const image = raw as ImageData; return new ImageNode({ src: image.src, alt: image.alt, url: image.url, credit: image.credit, creditURL: image.creditURL }); }
  exportJSON() { return { ...this.__image, type: "image", version: 1 }; }
  setImage(image: Partial<ImageData>) { this.getWritable().__image = { ...this.getLatest().__image, ...image }; }
  createDOM() {
    const figure = document.createElement("figure");
    const image = document.createElement("img");
    if (safePreviewUrl(this.__image.src, true)) image.src = this.__image.src;
    image.alt = this.__image.alt;
    image.draggable = false;
    if (this.__image.url && safePreviewUrl(this.__image.url)) { const link = document.createElement("a"); link.href = this.__image.url; link.append(image); figure.append(link); }
    else figure.append(image);
    if (this.__image.credit) {
      const caption = document.createElement("figcaption");
      if (this.__image.creditURL && safePreviewUrl(this.__image.creditURL)) { const link = document.createElement("a"); link.href = this.__image.creditURL; link.textContent = this.__image.credit; caption.append(link); }
      else caption.textContent = this.__image.credit;
      figure.append(caption);
    }
    return figure;
  }
  updateDOM() { return true; }
  decorate() { return null; }
  isInline() { return false; }
  getTextContent() { return this.__image.alt; }
}
export const create = () => new ImageNode();
