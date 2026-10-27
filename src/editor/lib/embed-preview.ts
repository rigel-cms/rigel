import { embedProviderLabel, embedWatchUrl, safeEmbed } from "./embeds";
import { t, translate } from "../i18n";

const labels = new WeakMap<HTMLElement, () => string>();

function mediaLabel(element: HTMLElement, text: () => string) {
  element.dataset.rigelMediaLabel = "";
  labels.set(element, text);
  element.textContent = text();
}

export function subscribeMediaLabels(root: HTMLElement) {
  return t.subscribe(() => {
    for (const element of root.querySelectorAll<HTMLElement>("[data-rigel-media-label]")) {
      const text = labels.get(element)?.();
      if (text !== undefined && element.textContent !== text) element.textContent = text;
    }
  });
}

export function createVideoOverlay(doc: Document, label: () => string, url: string, editable = false): HTMLElement {
  const overlay = doc.createElement("div");
  overlay.contentEditable = "false";
  overlay.style.cssText = "position:absolute;inset:0;display:grid;place-items:center;padding:1rem;background:#0006";
  const card = doc.createElement("div");
  card.style.cssText = "box-sizing:border-box;width:100%;max-width:360px;padding:1rem;background:#18181b;color:white;border:1px solid #52525b;font:14px/1.5 system-ui;text-align:left";
  const heading = doc.createElement("strong");
  mediaLabel(heading, label);
  const link = doc.createElement("div");
  link.textContent = url;
  link.style.cssText = "margin:0.5rem 0 1rem;overflow-wrap:anywhere;color:#e4e4e7";
  const edit = doc.createElement("button");
  edit.type = "button";
  edit.dataset.rigelEditVideo = "";
  edit.addEventListener("pointerdown", event => event.stopPropagation());
  edit.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); edit.click(); }
  });
  mediaLabel(edit, () => translate("media.editVideo"));
  edit.hidden = !editable;
  edit.style.cssText = "min-height:44px;padding:0.5rem 0.75rem;border:1px solid #d4d4d8;background:white;color:#18181b;font:inherit;cursor:pointer";
  card.append(heading, link, edit);
  overlay.append(card);
  return overlay;
}

export function createEmbedPreview(value: unknown, doc: Document, editable = false): HTMLElement {
  const figure = doc.createElement("figure");
  figure.className = "media-embed";
  figure.style.cssText = "max-width:100%;min-width:0;margin-inline:0";
  const ref = safeEmbed(value);
  if (!ref) return figure;
  const title = typeof (value as { title?: unknown }).title === "string" ? (value as { title: string }).title : "";
  figure.dataset.rigelEmbed = ref.provider;
  figure.dataset.rigelVideoId = ref.id;
  const poster = doc.createElement("div");
  poster.style.cssText = "position:relative;width:100%;min-width:0;aspect-ratio:16/9;min-height:220px;overflow:hidden;background:#18181b";
  if (ref.provider === "youtube") {
    const image = doc.createElement("img");
    image.src = `https://i.ytimg.com/vi/${ref.id}/hqdefault.jpg`;
    image.alt = "";
    image.loading = "lazy";
    image.referrerPolicy = "no-referrer";
    image.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;margin:0";
    image.onerror = () => { image.hidden = true; };
    poster.append(image);
  }
  const caption = doc.createElement("figcaption");
  mediaLabel(caption, () => translate("media.embedCaption", { provider: embedProviderLabel(ref), title: title || translate("media.video") }));
  caption.style.cssText = "margin-top:0.5rem;font-size:0.875rem;line-height:1.5";
  poster.append(createVideoOverlay(doc, () => translate("media.providerVideo", { provider: embedProviderLabel(ref) }), embedWatchUrl(ref), editable));
  figure.append(poster, caption);
  return figure;
}
