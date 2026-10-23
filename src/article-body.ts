import type { SerializedEditorState } from "lexical";
import { safePreviewUrl } from "./preview-urls";

export type ArticleBody = SerializedEditorState;
export type ArticleNode = { type: string; version: number; children?: ArticleNode[]; text?: string; format?: number | string; tag?: string; listType?: string; start?: number; url?: string; src?: string; alt?: string; credit?: string; creditURL?: string; [key: string]: unknown };
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 20;

export function emptyBody(): ArticleBody {
  const paragraph = { type: "paragraph", version: 1, children: [], direction: null, format: "", indent: 0 };
  return { root: { type: "root", version: 1, children: [paragraph], direction: null, format: "", indent: 0 } };
}

export function validateBody(value: unknown): asserts value is ArticleBody {
  const types = new Set(["root", "paragraph", "heading", "quote", "list", "listitem", "code", "text", "linebreak", "link", "image", "divider", "table", "tablerow", "tablecell"]);
  let count = 0;
  let textSize = 0;
  function check(raw: unknown, parent = "", depth = 0) {
    if (++count > 10000 || depth > 32 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid or oversized article block tree");
    const node = raw as ArticleNode;
    if (!types.has(node.type) || node.version !== 1 || (node.type === "root") !== !parent) throw new Error("Unsupported article block");
    const inline = ["text", "linebreak", "link"];
    if (parent === "root" && (inline.includes(node.type) || ["listitem", "tablerow", "tablecell"].includes(node.type))) throw new Error("Expected an article block");
    if (node.type === "table" && parent !== "root") throw new Error("Nested tables are not supported");
    if (node.type === "tablerow" && parent !== "table" || node.type === "tablecell" && parent !== "tablerow") throw new Error("Invalid table structure");
    if (parent === "table" && node.type !== "tablerow" || parent === "tablerow" && node.type !== "tablecell" || parent === "tablecell" && node.type !== "paragraph") throw new Error("Invalid table content");
    if (node.type === "tablecell") {
      if (![0, 1, 2, 3].includes(Number(node.headerState)) || typeof node.headerState !== "number" || (node.colSpan ?? 1) !== 1 || (node.rowSpan ?? 1) !== 1) throw new Error("Invalid table cell or unsupported merged cells");
      if (node.backgroundColor || node.verticalAlign) throw new Error("Custom table cell styles are not supported");
    }
    for (const key of ["width", "height"]) if (node[key] !== undefined && (typeof node[key] !== "number" || !Number.isFinite(node[key]) || node[key] <= 0 || node[key] > 2000)) throw new Error("Invalid table dimensions");
    if (node.colWidths !== undefined && (!Array.isArray(node.colWidths) || node.colWidths.length > MAX_TABLE_COLUMNS || node.colWidths.some(width => typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 2000))) throw new Error("Invalid table column widths");
    if (parent === "list" && node.type !== "listitem") throw new Error("Lists require list items");
    if (["paragraph", "heading", "link", "code"].includes(parent) && !inline.includes(node.type)) throw new Error("Expected inline article content");
    if (node.type === "heading" && !["h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tag ?? "")) throw new Error("Use heading levels 1–6");
    if (node.type === "list" && !["bullet", "number"].includes(node.listType ?? "")) throw new Error("Unsupported list type");
    if (node.start !== undefined && (!Number.isInteger(node.start) || node.start < 1 || node.start > 1000000)) throw new Error("Invalid list start");
    if (node.type === "text" && (typeof node.text !== "string" || typeof node.format !== "number" || !Number.isInteger(node.format) || node.format < 0 || node.format > 255)) throw new Error("Invalid article text");
    if (node.type === "text" && (textSize += node.text!.length) > 1000000) throw new Error("Article text is too large");
    if (node.style || node.textStyle) throw new Error("Custom article styles are not supported");
    if (node.type === "image" && (typeof node.src !== "string" || typeof node.alt !== "string")) throw new Error("Images require a URL and alt text");
    if (node.type === "link" && typeof node.url !== "string") throw new Error("Links require a URL");
    if (node.type === "image" && !safePreviewUrl(node.src!, true)) throw new Error("Unsafe image URL");
    if (node.type === "image" && node.url !== undefined && (typeof node.url !== "string" || node.url && !safePreviewUrl(node.url))) throw new Error("Unsafe image link URL");
    if (node.type === "link" && !safePreviewUrl(node.url!)) throw new Error("Unsafe link URL");
    for (const key of ["credit", "creditURL"]) if (node[key] !== undefined && typeof node[key] !== "string") throw new Error("Invalid image credit");
    if (node.creditURL && !safePreviewUrl(node.creditURL)) throw new Error("Unsafe image credit URL");
    if (!["text", "linebreak", "image", "divider"].includes(node.type)) {
      if (!Array.isArray(node.children)) throw new Error("Article block requires children");
      for (const child of node.children) check(child, node.type, depth + 1);
      if (["table", "tablerow", "tablecell"].includes(node.type) && !node.children.length) throw new Error("Table elements cannot be empty");
      if (node.type === "table") {
        const columns = node.children[0]?.children?.length ?? 0;
        if (node.children.length > MAX_TABLE_ROWS || columns > MAX_TABLE_COLUMNS || node.children.some(row => row.children?.length !== columns)) throw new Error("Table must be rectangular and at most 50 rows by 20 columns");
      }
    } else if (node.children !== undefined) throw new Error("Unexpected article children");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a Lexical article body");
  check((value as ArticleBody).root);
}
