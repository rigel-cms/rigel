import type { Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import { contentForLocale, selectionInContent } from "../../manifest/content-locales";

const RESERVED_PATHS = new Set(["pages", "collections", "menus", "media", "copy", "content", "documents"]);
const typePath = (type: string) => RESERVED_PATHS.has(type) || type === "page" ? ["content", type] : [type];

export function selectionHash(selection: Selection | null, locale?: string): string {
  let parts: string[] = [];
  const query = new URLSearchParams();
  if (locale) query.set("locale", locale);
  if (selection) switch (selection.kind) {
    case "page": parts = ["copy", selection.slug]; break;
    case "pages": parts = ["pages"]; if (selection.category !== undefined) query.set("category", selection.category); break;
    case "document": parts = [...(selection.type === "page" ? ["pages"] : typePath(selection.type)), selection.id.slice(selection.type.length + 1)]; break;
    case "documents": parts = typePath(selection.type); break;
    case "collection": parts = ["collections", selection.name]; break;
    case "post": parts = ["collections", selection.collection, selection.slug]; break;
    case "menu": parts = ["menus", selection.slug]; break;
    default: parts = [selection.kind];
  }
  return parts.length || query.size ? `#/${parts.map(encodeURIComponent).join("/")}${query.size ? `?${query}` : ""}` : "";
}

export function resolveHash(hash: string, manifest: Manifest): { selection: Selection | null; locale: string | undefined } {
  const fallback = { selection: null, locale: manifest.contentLocales?.defaultLocale };
  try {
    if (!hash || hash === "#" || hash === "#/") return fallback;
    if (!hash.startsWith("#/")) return fallback;
    const [path, search = ""] = hash.slice(2).split("?");
    const parts = path ? path.split("/").map(decodeURIComponent) : [];
    if (parts.some(part => !part || /[\u0000-\u001f\u007f]/.test(part))) return fallback;
    const query = new URLSearchParams(search);
    const locale = query.get("locale") ?? manifest.contentLocales?.defaultLocale;
    if (locale !== undefined && !manifest.contentLocales?.locales.some(entry => entry.code === locale)) return fallback;
    const content = contentForLocale(manifest, locale);
    const [kind, key, id] = parts;
    const documentTarget = (type: string, slug: string): Selection | null => {
      const doc = content.documents?.find(doc => doc.type === type && doc.id === `${type}:${slug}`);
      return doc ? { kind: "document", type, id: doc.id } : null;
    };
    let selection: Selection | null = null;
    if (kind === "pages" && parts.length === 1) selection = { kind: "pages", ...(query.has("category") ? { category: query.get("category")! } : {}) };
    else if (kind === "pages" && parts.length === 2) selection = documentTarget("page", key) ?? (content.pages.some(page => page.slug === key) ? { kind: "page", slug: key } : null);
    else if (kind === "copy" && parts.length === 2 && content.pages.some(page => page.slug === key)) selection = { kind: "page", slug: key };
    else if (kind === "documents" && parts.length === 2) selection = { kind: "documents", type: key };
    else if (kind === "documents" && parts.length === 3 && content.documents?.some(doc => doc.type === key && doc.id === id)) selection = { kind: "document", type: key, id };
    else if (kind === "collections" && parts.length === 2) selection = { kind: "collection", name: key };
    else if (kind === "collections" && parts.length === 3 && content.collections?.some(collection => collection.name === key && (collection.posts.some(post => post.slug === id) || collection.storageSlugs?.includes(id)))) selection = { kind: "post", collection: key, slug: id };
    else if (kind === "menus" && parts.length === 1 && content.menus) selection = { kind: "menus" };
    else if (kind === "menus" && parts.length === 2 && content.menus?.entries.some(menu => menu.slug === key)) selection = { kind: "menu", slug: key };
    else if (kind === "media" && parts.length === 1) selection = { kind: "media" };
    else if (kind === "content" && parts.length === 2) selection = { kind: "documents", type: key };
    else if (kind === "content" && parts.length === 3) selection = documentTarget(key, id);
    else if (!RESERVED_PATHS.has(kind) && parts.length === 1) selection = { kind: "documents", type: kind };
    else if (!RESERVED_PATHS.has(kind) && parts.length === 2) selection = documentTarget(kind, key);
    else if (parts.length) return fallback;
    return selectionInContent(content, selection) ? { selection, locale } : fallback;
  } catch { return fallback; }
}

export function createHashNavigation(
  apply: (hash: string) => void,
  guard: (action: () => void) => void,
  blocked: () => boolean,
  browser: Window = window,
) {
  const { history, location } = browser;
  const stateIndex = () => Number.isSafeInteger(history.state?.rigelNavigation) ? history.state.rigelNavigation as number : undefined;
  let index = stateIndex() ?? 0;
  let hash = location.hash;
  let observed = "";
  let returning: (() => void) | null = null;
  let replay = false;
  const signature = () => JSON.stringify([stateIndex(), location.hash]);
  const stamp = (position: number) => ({ ...history.state, rigelNavigation: position });
  history.replaceState(stamp(index), "", `${location.pathname}${location.search}${hash}`);
  observed = signature();

  function changed() {
    if (signature() === observed) return;
    let nextIndex = stateIndex();
    if (nextIndex === undefined || (nextIndex === index && location.hash !== hash)) {
      nextIndex = index + 1;
      history.replaceState(stamp(nextIndex), "", `${location.pathname}${location.search}${location.hash}`);
    }
    observed = signature();
    if (returning) {
      if (nextIndex !== index) { history.go(index - nextIndex); return; }
      const resume = returning;
      returning = null;
      resume();
      return;
    }
    if (!replay && blocked()) {
      const delta = nextIndex - index;
      returning = () => guard(() => { replay = true; history.go(delta); });
      history.go(-delta);
      return;
    }
    replay = false;
    index = nextIndex;
    hash = location.hash;
    apply(hash);
  }

  browser.addEventListener("popstate", changed);
  browser.addEventListener("hashchange", changed);
  return {
    write(next: string, replace = false) {
      if (returning || replay || next === hash) return;
      if (!replace) index += 1;
      hash = next;
      history[replace ? "replaceState" : "pushState"](stamp(index), "", `${location.pathname}${location.search}${hash}`);
      observed = signature();
    },
    destroy() {
      browser.removeEventListener("popstate", changed);
      browser.removeEventListener("hashchange", changed);
    },
  };
}
