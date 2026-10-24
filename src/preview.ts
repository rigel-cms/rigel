import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { pageRoute } from "./schema/paths";
import { slugify } from "./slugs";
import { renderArticle } from "./article-render";
import { createEmbedPreview } from "./editor/lib/embed-preview";
import { safePreviewUrl, previewBaseUrl } from "./preview-urls";
export { safePreviewUrl } from "./preview-urls";

export interface PreviewDocumentMapping {
  url: string;
  index?: string;
}

export interface PreviewConfig {
  liveUrl?: string;
  draftUrl?: string;
  pages?: Record<string, string>;
  collections?: Record<string, { url: string; new: string }>;
  documents?: Record<string, PreviewDocumentMapping>;
}
export interface PreviewTarget {
  kind: "page" | "post" | "menu" | "document";
  slug: string;
  urlSlug?: string;
  collection?: string;
  type?: string;
}

export function previewPath(config: PreviewConfig, target: PreviewTarget, isNew = false): string | null {
  const mapping = target.kind === "post" ? config.collections?.[target.collection ?? ""] : undefined;
  const path = target.kind === "document" ? pageRoute(target.slug, config.documents?.[target.type ?? ""]) : target.kind === "page" ? config.pages?.[target.slug] : mapping ? (isNew ? mapping.new : mapping.url.replaceAll("{slug}", encodeURIComponent(target.slug))) : undefined;
  return typeof path === "string" && /^\/(?!\/)/.test(path) && !/[\\\s?#]/.test(path) && !/%(?:2e|2f|5c)/i.test(path) && !path.split("/").some(part => part === "." || part === "..") && !/^\/rigel(?:\/|$)/.test(path) ? path : null;
}

export function previewUrl(config: PreviewConfig, target: PreviewTarget, mode: "live" | "draft" | "website" = "draft", isNew = false): string | null {
  if (mode !== "draft" && target.kind !== "page" && target.urlSlug !== undefined) {
    const slug = slugify(target.urlSlug);
    if (!slug) return null;
    target = { ...target, slug };
  }
  const path = previewPath(config, target, mode === "draft" && (target.kind === "post" || isNew));
  const base = mode === "live" ? config.liveUrl : config.draftUrl;
  if (!path || base === undefined) return path;
  try { return new URL(path.slice(1), previewBaseUrl(base)).href; } catch { return null; }
}

export function anchorValue(values: unknown, path: string): { found: boolean; value: unknown } {
  let value = values;
  for (const key of path.split(".")) {
    if (!value || typeof value !== "object") return { found: false, value: undefined };
    if (Array.isArray(value)) {
      const item = (value as Record<string, unknown>[]).find((entry) => entry && typeof entry === "object" && entry._key === key);
      if (item === undefined) return { found: false, value: undefined };
      value = item;
      continue;
    }
    if (["__proto__", "constructor", "prototype"].includes(key) || !Object.hasOwn(value, key)) return { found: false, value: undefined };
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}


const markdown = new MarkdownIt({ html: false, linkify: false });
const rendered = new WeakMap<Element, string>();

export interface PatchDocuments {
  editingBody?: Element | null;
  documents?: Record<string, Record<string, unknown>>;
  primary?: string;
}

function rebindTree(root: Element | DocumentFragment, update: (element: Element) => void) {
  if (root.nodeType === 1) update(root as Element);
  for (const child of root.children) {
    rebindTree(child, update);
    if (child.tagName === "TEMPLATE") rebindTree((child as HTMLTemplateElement).content, update);
  }
}

export function patchPreview(doc: Document, values: Record<string, unknown>, body: "" | import("./article-body").ArticleBody, options: PatchDocuments = {}) {
  const sourceFor = (element: Element): Record<string, unknown> | undefined => {
    const id = element.getAttribute("data-rigel-doc");
    if (id === "") return {};
    if (id === null || id === options.primary) return values;
    if (options.documents && Object.hasOwn(options.documents, id)) return options.documents[id];
    return !options.primary ? values : undefined;
  };
  const get = (element: Element, path: string) => {
    const source = sourceFor(element);
    if (source === undefined) return { found: false, value: undefined };
    if (path === "$body") return { found: true, value: body };
    return { found: true, value: anchorValue(source, path).value };
  };
  const syncStructure = (root: Element) => {
    if (root.hasAttribute("data-rigel-reference")) {
      const reference = get(root, root.getAttribute("data-rigel-reference")!).value;
      const id = reference && typeof reference === "object" && "_ref" in reference ? String(reference._ref) : "";
      const target = root.querySelector("[data-rigel-reference-target]");
      for (const child of target ? [target] : [...root.children]) rebindTree(child, element => {
        if (element.hasAttribute("data-rigel-doc")) element.setAttribute("data-rigel-doc", id);
      });
    }
    const path = root.getAttribute("data-rigel-each");
    if (path) {
      const result = get(root, path);
      if (result.found) {
        const items = Array.isArray(result.value) ? result.value as Record<string, unknown>[] : [];
        const templates = [...root.children].filter(element => element.hasAttribute("data-rigel-item-template")) as HTMLTemplateElement[];
        const keyOf = (element: Element) => element.getAttribute("data-rigel-item") ?? element.getAttribute("data-rigel-key");
        const existing = new Map([...root.children].filter(element => keyOf(element) !== null).map(element => [keyOf(element)!, element]));
        const keep = new Set<Element>();
        let previous: Element | null = null;
        for (const item of items) {
          if (!item || typeof item._key !== "string") continue;
          const key = item._key;
          let element = existing.get(key);
          if (element?.hasAttribute("data-rigel-section") && element.getAttribute("data-rigel-section") !== item._type) { element.remove(); element = undefined; }
          if (!element) {
            const template = templates.find(template => template.getAttribute("data-rigel-item-template") === (item._type ?? ""));
            element = template?.content.firstElementChild?.cloneNode(true) as Element | undefined;
            if (!element) continue;
            rebindTree(element, node => {
              for (const attr of [...node.attributes]) {
                if (!attr.name.startsWith("data-rigel-")) continue;
                const prefix = `${path}.__item__`;
                if (attr.value === prefix || attr.value.startsWith(`${prefix}.`)) node.setAttribute(attr.name, `${path}.${key}${attr.value.slice(prefix.length)}`);
              }
            });
            element.setAttribute(element.hasAttribute("data-rigel-section") ? "data-rigel-key" : "data-rigel-item", key);
          }
          const next: Element | null = previous ? previous.nextElementSibling : root.firstElementChild;
          if (next !== element) root.insertBefore(element, next);
          keep.add(element);
          previous = element;
        }
        for (const element of existing.values()) if (!keep.has(element)) element.remove();
      }
    }
    for (const child of [...root.children]) if (child.tagName !== "TEMPLATE") syncStructure(child);
  };
  syncStructure(doc.documentElement);
  for (const element of doc.querySelectorAll<HTMLElement>("[data-rigel-if]")) {
    const result = get(element, element.getAttribute("data-rigel-if")!);
    if (result.found) element.hidden = !result.value;
  }
  for (const el of doc.querySelectorAll<HTMLElement>("[data-rigel-text]")) {
    const result = get(el, el.dataset.rigelText!);
    if (!result.found) continue;
    const text = result.value === null || result.value === undefined ? "" : String(result.value);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of doc.querySelectorAll<HTMLElement>("[data-rigel-richtext]")) {
    if (el === options.editingBody) continue;
    const result = get(el, el.dataset.rigelRichtext!);
    if (!result.found) continue;
    const blocks = el.dataset.rigelRichtext === "$body";
    const source = blocks ? JSON.stringify(result.value) : typeof result.value === "string" ? result.value : "";
    if (rendered.get(el) === source) continue;
    rendered.set(el, source);
    const fragment = DOMPurify.sanitize(blocks ? (result.value ? renderArticle(result.value as import("./article-body").ArticleBody, { preview: true }) : "") : markdown.render(source), {
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_TAGS: ["p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "aside", "figure", "figcaption", "pre", "code", "strong", "em", "s", "u", "mark", "sub", "sup", "a", "img", "br", "hr", "table", "thead", "tbody", "tr", "th", "td", ...(blocks ? ["video"] : [])],
      ALLOWED_ATTR: ["href", "src", "alt", "title", "start", "scope", ...(blocks ? ["controls", "preload", "playsinline", "poster", "class"] : [])],
    });
    if (blocks) for (const marker of fragment.querySelectorAll<HTMLElement>("[data-rigel-embed]")) {
      marker.replaceWith(createEmbedPreview({ provider: marker.dataset.rigelEmbed, id: marker.dataset.rigelVideoId, title: marker.dataset.rigelVideoTitle }, doc));
    }
    for (const link of fragment.querySelectorAll("[href], [src]")) {
      for (const attr of ["href", "src"]) if (link.hasAttribute(attr) && !safePreviewUrl(link.getAttribute(attr)!, attr === "src")) link.removeAttribute(attr);
    }
    el.replaceChildren(fragment);
  }
  for (const [anchor, attr, tag] of [["image", "src", "IMG"], ["alt", "alt", "IMG"], ["href", "href", "A"]]) {
    for (const el of doc.querySelectorAll(`[data-rigel-${anchor}]`)) {
      if (el.tagName !== tag) continue;
      const result = get(el, el.getAttribute(`data-rigel-${anchor}`)!);
      if (!result.found) continue;
      const value = result.value === null || result.value === undefined ? "" : String(result.value);
      if (attr === "alt" || safePreviewUrl(value, attr === "src")) {
        if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
      } else el.removeAttribute(attr);
    }
  }
}
