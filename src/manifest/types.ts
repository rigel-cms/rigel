import type { MenuDocument } from "./menu";

export type CopyField =
  | { key: string; type: "string"; label: string; placeholder?: string }
  | { key: string; type: "text"; label: string }
  | { key: string; type: "markdown"; label: string }
  | { key: string; type: "image"; label: string }
  | { key: string; type: "list"; label: string; item: { fields: CopyField[] } };

export interface CopyGroup {
  id: string;
  label: string;
  fields: CopyField[];
}

export interface CopyPage {
  slug: string;
  locale?: string;
  label: string;
  shared?: boolean;
  category?: string;
  groups: CopyGroup[];
  values: Record<string, Record<string, unknown>>;
}

export interface GitHubBackendConfig {
  repo: string;
  branch: string;
  publishBranch: string;
  repoRoot: string;
  authOrigin: string;
  appSlug: string;
  copyDir: string;
  jsonOutput?: import("../json-output").JsonOutput;
  collections: { name: string; folder: string }[];
  menus?: { folder: string; maxDepth: number };
}

export interface Manifest {
  contentLocales?: import("../config").ContentLocalesConfig;
  backend?: "github";
  github?: GitHubBackendConfig;
  sidebar?: import("./navigation").SidebarEntry[];
  preview?: import("../preview").PreviewConfig;
  pages: CopyPage[];
  collections?: ManifestCollection[];
  menus?: { maxDepth: number; entries: MenuDocument[] };
  schema?: import("../schema/types").Schema;
  documents?: import("../schema/types").ContentDocument[];
}

export interface CollectionField {
  key: string;
  label: string;
  labelKey?: string;
  type: "string" | "text" | "boolean" | "date" | "tags" | "markdown" | "image" | "reference";
  to?: string;
  multiple?: boolean;
  required?: boolean;
  options?: import("./references").ReferenceOption[];
}

export interface CollectionPost {
  slug: string;
  frontmatter: Record<string, unknown>;
  body: import("../article-body").ArticleBody;
}

export interface ManifestCollection {
  name: string;
  locale?: string;
  label: string;
  listTitle?: string;
  fields: CollectionField[];
  columns?: string[];
  posts: CollectionPost[];
}

export function defineCopy(page: CopyPage): CopyPage {
  return page;
}