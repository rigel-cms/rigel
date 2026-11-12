import MarkdownIt from "markdown-it";
import type { Manifest, CopyField } from "./types";
import type { Selection } from "./navigation";
import type { FieldDef } from "../schema/types";
import type { MenuItem } from "./menu";

const markdown = new MarkdownIt({ html: true });
export type MediaUsageEntry = { label: string; group: string; locale?: string; target: Selection };

export function mediaUsage(manifest: Manifest, url: string) {
  const entries: MediaUsageEntry[] = [];
  let complete = manifest.backend !== "github";
  const path = (value: unknown) => {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "";
    try { return decodeURIComponent(value.split(/[?#]/)[0]); } catch { return ""; }
  };
  const matches = (value: unknown) => !!path(value) && path(value) === path(url);
  function richtext(value: unknown): boolean {
    if (typeof value === "string") {
      const visit = (tokens: ReturnType<typeof markdown.parse>): boolean => tokens.map(token => {
        if (token.type === "html_inline" || token.type === "html_block") complete = false;
        const nested = token.children ? visit(token.children) : false;
        return matches(token.attrGet("src")) || matches(token.attrGet("href")) || nested;
      }).some(Boolean);
      return visit(markdown.parse(value, {}));
    }
    if (!value || typeof value !== "object") return false;
    const node = value as Record<string, unknown>;
    if (node.type === "extension") complete = false;
    const nested = richtext(node.root) || Array.isArray(node.children) && node.children.map(richtext).some(Boolean);
    return (["image", "video"].includes(String(node.type)) && (matches(node.src) || matches(node.poster) || matches(node.url))) || node.type === "link" && matches(node.url) || nested;
  }
  function fields(definitions: (FieldDef | CopyField)[], values: unknown): boolean {
    if (!values || typeof values !== "object") return false;
    let found = false;
    for (const field of definitions) {
      const value = (values as Record<string, unknown>)[field.key];
      if (["image", "file", "url"].includes(field.type)) found = matches(value) || found;
      else if (field.type === "markdown") found = richtext(value) || found;
      else if (field.type === "list" && Array.isArray(value)) found = value.map(item => fields(field.item.fields, item)).some(Boolean) || found;
      else if (field.type === "object") found = fields(field.fields ?? manifest.schema?.objects.find(object => object.name === field.of)?.fields ?? [], value) || found;
      else if (field.type === "array" && Array.isArray(value)) for (const item of value) {
        const definition = field.items?.find(definition => definition.type === "object" && definition.name === item?._type) ?? field.items?.[0];
        if (definition?.type === "object") found = fields(definition.fields ?? manifest.schema?.objects.find(object => object.name === definition.name)?.fields ?? [], item) || found;
        else if (definition && ["image", "file", "url"].includes(definition.type)) found = matches(item) || found;
        else if (definition?.type === "markdown") found = richtext(item) || found;
      }
    }
    return found;
  }
  for (const page of manifest.pages) if (page.groups.map(group => fields(group.fields, page.values[group.id])).some(Boolean)) entries.push({ label: page.label, group: "", locale: page.locale, target: { kind: "page", slug: page.slug } });
  for (const doc of manifest.documents ?? []) {
    if (doc.loaded && doc.loaded !== "complete") { complete = false; continue; }
    const type = manifest.schema?.documents.find(type => type.name === doc.type);
    if (type && fields(type.fields, doc.data)) entries.push({ label: String(doc.data.title || doc.data.name || doc.slug), group: type.title, locale: type.locale, target: { kind: "document", type: doc.type, id: doc.id } });
  }
  for (const collection of manifest.collections ?? []) {
    if (collection.index && collection.index.state !== "complete") complete = false;
    for (const post of collection.posts) {
      if (!post.body) complete = false;
      const body = richtext(post.body);
      if (fields(collection.fields as FieldDef[], post.frontmatter) || body) entries.push({ label: String(post.frontmatter.title || post.slug), group: collection.label, locale: collection.locale, target: { kind: "post", collection: collection.name, slug: post.slug } });
    }
  }
  const links = (items: MenuItem[]): boolean => items.some(item => matches(item.url) || links(item.children));
  for (const menu of manifest.menus?.entries ?? []) if (links(menu.items)) entries.push({ label: menu.title, group: "", target: { kind: "menu", slug: menu.slug } });
  return { entries, complete };
}

export function mediaDeletion(manifest: Manifest, url: string) {
  const { entries, complete } = mediaUsage(manifest, url);
  return { blocked: entries.length > 0, count: entries.length, unverified: !complete };
}
