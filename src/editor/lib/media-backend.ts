import config from "virtual:rigel-config";
import { get } from "svelte/store";
import { locale, translate } from "../i18n";
import type { Manifest } from "../../manifest/types";
import type { MediaMeta } from "../../media-metadata";
import { safeFileUrl } from "../../media-types";
import { listRemoteMedia, readRemoteMedia, readRemoteThumbnail, readRemoteMediaContent, resetRemoteMediaCache, uploadRemoteMedia, updateRemoteMedia, deleteRemoteMedia, type GitContext } from "./github-backend";
import { onFileCacheClear } from "./file-cache";
import type { MediaAsset } from "./media-library";

let current: (() => { ctx: GitContext; manifest: Manifest }) | undefined;
let onError: (error: unknown) => void = () => {};
const resets = new Set<() => void>();
const refreshes = new Set<() => void>();
const sources = new Set<() => void>();
let backend: (() => "github" | "demo" | undefined) | undefined;
export const mediaBackend = () => backend?.() ?? config.backend;

export function onMediaReset(reset: () => void, refresh: () => void = () => {}) {
  resets.add(reset); refreshes.add(refresh);
  return () => { resets.delete(reset); refreshes.delete(refresh); };
}
export function refreshMediaPreviews() { for (const refresh of refreshes) refresh(); }
let revision = 0;
export function resetMediaPreviews() { revision++; resetRemoteMediaCache(); for (const reset of resets) reset(); }
onFileCacheClear(() => { for (const clear of sources) clear(); });
export function configureMediaBackend(getContext: typeof current, error: typeof onError = () => {}, getBackend?: typeof backend) {
  resetMediaPreviews(); current = getContext; onError = error; backend = getBackend;
  return () => { resetMediaPreviews(); current = undefined; onError = () => {}; backend = undefined; };
}
function context() {
  if (!current) throw new Error(translate("connection.connectFirst"));
  return current();
}
export function mediaUploadGuard() {
  const request = revision, selectedBackend = mediaBackend();
  const active = selectedBackend === "github" ? context() : undefined;
  return () => {
    const next = selectedBackend === "github" ? context() : undefined;
    if (request !== revision || mediaBackend() !== selectedBackend || (active && (next?.ctx !== active.ctx || next?.manifest !== active.manifest))) throw new Error(translate("connection.reloadDraft"));
  };
}
async function remote<T>(operation: (ctx: GitContext, manifest: Manifest) => Promise<T>): Promise<T> {
  const active = context(), request = revision;
  const assertActive = () => { const next = context(); if (request !== revision || next.ctx !== active.ctx || next.manifest !== active.manifest) throw new Error(translate("connection.reloadDraft")); };
  try {
    assertActive();
    const result = await operation({ ...active.ctx, assertActive, mediaSession: active.ctx }, active.manifest);
    assertActive();
    return result;
  } catch (error) { onError(error); throw error; }
}
export async function listMedia(refresh = false): Promise<{ assets: MediaAsset[]; folder: string; writable: boolean }> {
  if (mediaBackend() === "github") {
    if (refresh) for (const clear of sources) clear();
    const assets = await remote((ctx, manifest) => listRemoteMedia(ctx, manifest, refresh));
    return { assets, folder: context().manifest.github?.mediaDir ?? "rigel-media", writable: true };
  }
  const response = await fetch("/rigel/media.json", { cache: "no-store", headers: { "Accept-Language": get(locale) } });
  if (!response.ok) throw new Error(translate("media.listingUnavailable"));
  const data = await response.json();
  return { ...data, assets: data.assets ?? data.images, writable: mediaBackend() !== "demo" && data.writable === true };
}
export function readMediaContent(manifest: Manifest, signal?: AbortSignal) {
  return remote(async (ctx, current) => {
    if (current !== manifest) throw new Error(translate("connection.reloadDraft"));
    const result = await readRemoteMediaContent(ctx, manifest, signal);
    if (result.error) onError(result.error);
    return result;
  });
}
async function local(method: string, body: unknown, failureKey?: string) {
  if (mediaBackend() === "demo") throw new Error(translate("shell.demoMediaReadOnly"));
  const response = await fetch("/rigel/api/local/media", { method, headers: { "Content-Type": "application/json", "Accept-Language": get(locale) }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(translate(failureKey ?? (method === "DELETE" ? "media.deleteFailed" : "media.metadataSaveFailedStatus"), { status: response.status }));
}
export async function saveMediaMetadata(body: unknown, failureKey?: string) {
  if (mediaBackend() === "github") return remote((ctx, manifest) => updateRemoteMedia(ctx, manifest, JSON.parse(JSON.stringify(body))));
  return local("PUT", body, failureKey);
}
export async function deleteMedia(url: string) {
  if (mediaBackend() === "github") return remote((ctx, manifest) => deleteRemoteMedia(ctx, manifest, url));
  return local("DELETE", { url });
}
export function uploadRepositoryMedia(file: File, metadata: MediaMeta = {}) {
  return remote((ctx, manifest) => uploadRemoteMedia(ctx, manifest, file, metadata));
}
function repositoryUrl(url: string) {
  if (mediaBackend() !== "github" || !safeFileUrl(url)) return false;
  const folder = context().manifest.github?.mediaDir ?? "rigel-media";
  return url.startsWith("/" + folder.split("/").map(encodeURIComponent).join("/") + "/");
}
export function mediaSource(node: Element, source: string) {
  const attribute = node.tagName === "A" ? "href" : "src";
  let objectURL = "", revision = 0, original = "";
  let observer: IntersectionObserver | undefined;
  function clear() {
    revision++;
    observer?.disconnect(); observer = undefined;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = "";
    if (original) node.removeAttribute(attribute);
  }
  function update(url: string) {
    clear(); original = url;
    let repository = false;
    try { repository = repositoryUrl(url.split(/[?#]/)[0]); } catch { node.removeAttribute(attribute); return; }
    if (!repository) { node.setAttribute(attribute, url); return; }
    node.setAttribute("data-rigel-media-url", url);
    node.removeAttribute(attribute);
    const request = revision, canonical = url.split(/[?#]/)[0], suffix = url.includes("#") ? "#" + url.split("#")[1] : "";
    const load = () => {
      if (request !== revision) return;
      void remote((ctx, manifest) => (node.tagName === "IMG" && node.closest?.(".thumb, .media-thumbnail") ? readRemoteThumbnail : readRemoteMedia)(ctx, manifest, canonical)).then(blob => {
        if (request !== revision) return;
        objectURL = URL.createObjectURL(blob);
        node.setAttribute(attribute, objectURL + suffix);
      }).catch(() => {});
    };
    if (typeof IntersectionObserver !== "undefined" && node.closest?.(".thumb, .media-thumbnail")) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); observer = undefined; load(); }
      }, { rootMargin: "0px" });
      observer.observe(node);
    } else load();
  }
  sources.add(clear);
  const stop = onMediaReset(clear, () => update(original));
  update(source);
  return { update, destroy() { clear(); sources.delete(clear); stop(); node.removeAttribute("data-rigel-media-url"); } };
}

export function mediaPreviews(root: HTMLElement) {
  const nodes = new Map<Element, { source: string; action: ReturnType<typeof mediaSource> }>();
  function scan() {
    for (const [node, state] of nodes) if (!root.contains(node)) { state.action.destroy(); nodes.delete(node); }
    for (const node of root.querySelectorAll("img[src], video[src], source[src], a[href], iframe[src]")) {
      const attribute = node.tagName === "A" ? "href" : "src", url = node.getAttribute(attribute)!;
      if (url.startsWith("blob:") || nodes.get(node)?.source === url) continue;
      let repository = false;
      try { repository = repositoryUrl(url.split(/[?#]/)[0]); } catch { continue; }
      if (!repository) continue;
      nodes.get(node)?.action.destroy();
      nodes.set(node, { source: url, action: mediaSource(node, url) });
    }
  }
  const observer = new MutationObserver(scan);
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "href"] });
  scan();
  return { destroy() { observer.disconnect(); for (const state of nodes.values()) state.action.destroy(); nodes.clear(); } };
}
