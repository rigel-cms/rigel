import { mediaMetadata } from "../../media-types";

export interface MediaAsset {
  url: string;
  name: string;
  type?: string;
  size?: number;
  modified?: string;
  title?: string;
  description?: string;
  alt?: string;
  author?: string;
}

export function assetFile(url: string): string {
  return decodeURIComponent(url.split("/").pop() ?? "");
}

export function modifiedMonth(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Date(value).toISOString().slice(0, 7);
}

const CURATED = new Set(['Images', 'Audio', 'Video', 'Documents', 'Spreadsheets', 'Archives']);
export function filterMedia(assets: MediaAsset[], search: string, type: string, month: string): MediaAsset[] {
  return assets.filter(asset => asset.name.toLowerCase().includes(search.trim().toLowerCase())
    && (!type || asset.type === type || assetCategory(asset) === type) && (!month || modifiedMonth(asset.modified) === month));
}
function assetCategory(asset: MediaAsset): string {
  const category = mediaMetadata(asset.name)?.category ?? '';
  if (!category) return 'Other';
  return CURATED.has(category) ? category : 'Other';
}

export function mediaSize(size?: number): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  return size < 1024 * 1024 ? `${Number((size / 1024).toFixed(1))} KB` : `${Number((size / (1024 * 1024)).toFixed(1))} MB`;
}
