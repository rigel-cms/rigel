declare module "virtual:rigel-manifest" {
  import type { CopyPage, ManifestCollection } from "@rigel-cms/rigel/content";
  export const pages: CopyPage[];
  export const collections: ManifestCollection[];
  export const documents: import("@rigel-cms/rigel/content").ContentDocument[];
  export const menus: import("@rigel-cms/rigel/content").Manifest["menus"];
  const manifest: import("@rigel-cms/rigel/content").Manifest;
  export default manifest;
}

declare module "virtual:rigel-content" {
  import type { ContentDocument } from "@rigel-cms/rigel/content";
  export const documents: ContentDocument[];
  export function getDocument(id: string): ContentDocument | undefined;
  export function derefDocument(value: unknown): ContentDocument | undefined;
}

declare module "virtual:rigel-config" {
  import type { RigelConfig } from "@rigel-cms/rigel";
  const config: Pick<RigelConfig, "copyDir" | "backend" | "jsonOutput" | "demo" | "collections" | "menus" | "mediaDir" | "schema" | "preview"> & { publicDir?: string; root?: string };
  export default config;
}
