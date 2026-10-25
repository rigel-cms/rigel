import type { CollectionField } from "./manifest/types";
import { validateSchema } from "./schema/validate";
import type { Schema } from "./schema/types";
import { validateSidebar, type SidebarEntry } from "./manifest/navigation";
import { withSeoFields } from "./manifest/seo";
import { previewBaseUrl } from "./preview-urls";
import type { JsonOutput } from "./json-output";
import { DEFAULT_MAX_FILE_SIZE } from "./media-types";

export interface RigelConfig {
  copyDir: string;
  mediaDir?: string;
  maxFileSize?: number;
  preview?: import("./preview").PreviewConfig;
  backend: "local" | "github";
  jsonOutput?: JsonOutput;
  demo?: boolean;
  collections?: CollectionConfig[];
  menus?: { folder: string; maxDepth?: number };
  schema?: Schema;
  sidebar?: SidebarEntry[];
  repo?: string;
  branch?: string;
  publishBranch?: string;
  repoRoot?: string;
  authOrigin?: string;
  appSlug?: string;
  users?: string[];
}

export interface CollectionConfig {
  name: string;
  label?: string;
  listTitle?: string;
  folder: string;
  fields: CollectionField[];
  columns?: string[];
}

const DEFAULTS: Pick<RigelConfig, "copyDir" | "backend"> = {
  copyDir: "src/content/copy",
  backend: "local",
};

export function parseConfig(options: Partial<RigelConfig> = {}): RigelConfig {
  const cfg = { ...DEFAULTS, ...options };
  if (cfg.maxFileSize === undefined) cfg.maxFileSize = DEFAULT_MAX_FILE_SIZE;
  if (!Number.isSafeInteger(cfg.maxFileSize) || cfg.maxFileSize <= 0) throw new Error("rigel: maxFileSize must be a positive integer in bytes");
  if (cfg.jsonOutput === undefined) cfg.jsonOutput = "pretty";
  if (cfg.jsonOutput !== "pretty" && cfg.jsonOutput !== "minified") throw new Error("rigel: jsonOutput must be pretty or minified");
  if (cfg.demo === undefined) cfg.demo = true;
  if (typeof cfg.demo !== "boolean") throw new Error("rigel: demo must be boolean");
  if (cfg.preview) {
    cfg.preview = { ...cfg.preview };
    for (const key of ["liveUrl", "draftUrl"] as const) if (cfg.preview[key] !== undefined) cfg.preview[key] = previewBaseUrl(cfg.preview[key]);
  }
  if (cfg.mediaDir !== undefined && (typeof cfg.mediaDir !== "string" || !cfg.mediaDir.split("/").every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(part)))) throw new Error("rigel: mediaDir must be a relative folder inside publicDir");
  if (cfg.backend === "github") {
    if (typeof cfg.repo !== "string" || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\/[a-zA-Z0-9_.-]+$/.test(cfg.repo) || [".", ".."].includes(cfg.repo.split("/")[1])) throw new Error("rigel: github backend requires `repo: owner/name`");
    cfg.branch ??= "drafts";
    cfg.publishBranch ??= "main";
    cfg.repoRoot ??= "";
    cfg.authOrigin ??= "https://auth.rigelcms.dev";
    cfg.appSlug ??= "rigel-cms";
    const safePath = (value: unknown): value is string => typeof value === "string" && value.split("/").every(part => /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(part));
    for (const folder of [cfg.copyDir, ...(cfg.repoRoot === "" ? [] : [cfg.repoRoot]), ...(cfg.collections ?? []).map(c => c.folder), ...(cfg.schema?.documents ?? []).map(d => d.folder)]) if (!safePath(folder)) throw new Error("rigel: github content paths must be safe relative folders");
    for (const branch of [cfg.branch, cfg.publishBranch]) if (typeof branch !== "string" || !branch || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(branch) || branch.includes("..") || branch.includes("@{") || branch.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock")) || branch === "@" || branch.startsWith("-")) throw new Error("rigel: invalid github branch");
    if (cfg.branch === cfg.publishBranch) throw new Error("rigel: drafts branch must differ from publishBranch");
    if (typeof cfg.appSlug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cfg.appSlug)) throw new Error("rigel: invalid github appSlug");
    try {
      const url = new URL(cfg.authOrigin);
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) throw new Error();
      cfg.authOrigin = url.origin;
    } catch { throw new Error("rigel: authOrigin must be an HTTPS origin (HTTP is allowed on loopback)"); }
  }
  if (cfg.menus !== undefined) {
    const menus = cfg.menus;
    if (!menus || typeof menus.folder !== "string" || !menus.folder.split("/").every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_. -]*$/.test(part)))
      throw new Error("rigel: menus.folder must be a relative folder inside the site root");
    const maxDepth = menus.maxDepth === undefined ? 3 : menus.maxDepth;
    if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 10)
      throw new Error("rigel: menus.maxDepth must be an integer from 1 to 10");
    cfg.menus = { folder: menus.folder, maxDepth };
  }
  if (cfg.schema !== undefined) {
    const declared = validateSchema(cfg.schema);
    const schema = cfg.demo ? declared : validateSchema({ ...declared, documents: declared.documents.filter(type => !type.demo) });
    cfg.schema = { ...schema, documents: schema.documents.map(type => {
      if (type.shared) return type;
      const fields = withSeoFields(type.fields.map(field => field.key === "title" && field.label === "Title" ? { ...field, label: "Page name" } : field));
      if (!fields.some(field => field.key === "draft")) fields.push({ key: "draft", label: "Draft", type: "boolean" });
      return { ...type, fields };
    }) };
  }
  if (cfg.collections) cfg.collections = cfg.collections.map(collection => ({ ...collection, fields: withSeoFields(collection.fields) }));
  for (const collection of cfg.collections ?? []) {
    for (const field of collection.fields) {
      if (field.required !== undefined && typeof field.required !== "boolean") throw new Error(`rigel: ${collection.name}.${field.key}: required must be boolean`);
      if (field.type !== "reference") continue;
      if (field.multiple !== undefined && typeof field.multiple !== "boolean") throw new Error(`rigel: ${collection.name}.${field.key}: multiple must be boolean`);
      if ((field.to !== undefined ? 1 : 0) + (field.options !== undefined ? 1 : 0) !== 1) throw new Error(`rigel: ${collection.name}.${field.key}: reference requires either to or options`);
      if (field.to !== undefined && !cfg.schema?.documents.some(type => type.name === field.to)) throw new Error(`rigel: ${collection.name}.${field.key}: unknown reference target`);
      if (field.options !== undefined) {
        if (!Array.isArray(field.options) || field.options.some(option => !option || typeof option.value !== "string" || !option.value.trim() || typeof option.label !== "string" || !option.label.trim() || ["photo", "description", "email", "url"].some(key => key in option && typeof option[key as keyof typeof option] !== "string")) || new Set(field.options.map(option => option.value)).size !== field.options.length) throw new Error(`rigel: ${collection.name}.${field.key}: invalid reference options`);
      }
    }
  }
  if (cfg.sidebar !== undefined) validateSidebar(cfg.sidebar);

  return cfg;
}
