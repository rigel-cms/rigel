import { DecoratorNode, type NodeKey } from "lexical";
import { safePreviewUrl } from "../../preview-urls";

export type VideoData = { src: string; poster?: string; caption?: string };
export class VideoNode extends DecoratorNode<null> {
  __video: VideoData;
  static getType() { return "video"; }
  static clone(node: VideoNode) { return new VideoNode(node.__video, node.__key); }
  constructor(video: VideoData = { src: "" }, key?: NodeKey) { super(key); this.__video = video; }
  static importJSON(raw: unknown) { const video = raw as VideoData; return new VideoNode({ src: video.src, poster: video.poster, caption: video.caption }); }
  exportJSON() { return { ...this.__video, type: "video", version: 1 }; }
  createDOM() {
    const figure = document.createElement("figure");
    figure.className = "media-video";
    const video = document.createElement("video");
    if (safePreviewUrl(this.__video.src, true)) video.src = this.__video.src;
    if (this.__video.poster && safePreviewUrl(this.__video.poster, true)) video.poster = this.__video.poster;
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    figure.append(video);
    if (this.__video.caption) { const caption = document.createElement("figcaption"); caption.textContent = this.__video.caption; figure.append(caption); }
    return figure;
  }
  updateDOM() { return true; }
  decorate() { return null; }
  isInline() { return false; }
  getTextContent() { return this.__video.caption ?? ""; }
}
export const create = (video?: VideoData) => new VideoNode(video);
