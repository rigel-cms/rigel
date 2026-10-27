import type { SerializedEditorState } from "lexical";
import { safePreviewUrl } from "./preview-urls";
import { safeEmbed } from "./editor/lib/embeds";
import { systemMessage, type Translator } from "./editor/i18n/format";

export type ArticleBody = SerializedEditorState;
export type ArticleNode = { type: string; version: number; children?: ArticleNode[]; text?: string; format?: number | string; tag?: string; listType?: string; start?: number; url?: string; src?: string; alt?: string; credit?: string; creditURL?: string; [key: string]: unknown };
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 20;

export function emptyBody(): ArticleBody {
  const paragraph = { type: "paragraph", version: 1, children: [], direction: null, format: "", indent: 0 };
  return { root: { type: "root", version: 1, children: [paragraph], direction: null, format: "", indent: 0 } };
}

export function validateBody(value: unknown, message: Translator = systemMessage): asserts value is ArticleBody {
  const types = new Set(["root", "paragraph", "heading", "quote", "list", "listitem", "code", "text", "linebreak", "link", "image", "video", "embed", "divider", "table", "tablerow", "tablecell"]);
  let count = 0;
  let textSize = 0;
  function check(raw: unknown, parent = "", depth = 0) {
    if (++count > 10000 || depth > 32 || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(message("validation.body.invalidTree"));
    const node = raw as ArticleNode;
    if (!types.has(node.type) || node.version !== 1 || (node.type === "root") !== !parent) throw new Error(message("validation.body.unsupportedBlock"));
    const inline = ["text", "linebreak", "link"];
    if (parent === "root" && (inline.includes(node.type) || ["listitem", "tablerow", "tablecell"].includes(node.type))) throw new Error(message("validation.body.expectedBlock"));
    if (node.type === "table" && parent !== "root") throw new Error(message("validation.body.nestedTable"));
    if (node.type === "tablerow" && parent !== "table" || node.type === "tablecell" && parent !== "tablerow") throw new Error(message("validation.body.tableStructure"));
    if (parent === "table" && node.type !== "tablerow" || parent === "tablerow" && node.type !== "tablecell" || parent === "tablecell" && node.type !== "paragraph") throw new Error(message("validation.body.tableContent"));
    if (node.type === "tablecell") {
      if (![0, 1, 2, 3].includes(Number(node.headerState)) || typeof node.headerState !== "number" || (node.colSpan ?? 1) !== 1 || (node.rowSpan ?? 1) !== 1) throw new Error(message("validation.body.tableCell"));
      if (node.backgroundColor || node.verticalAlign) throw new Error(message("validation.body.tableCellStyles"));
    }
    for (const key of ["width", "height"]) if (node[key] !== undefined && (typeof node[key] !== "number" || !Number.isFinite(node[key]) || node[key] <= 0 || node[key] > 2000)) throw new Error(message("validation.body.tableDimensions"));
    if (node.colWidths !== undefined && (!Array.isArray(node.colWidths) || node.colWidths.length > MAX_TABLE_COLUMNS || node.colWidths.some(width => typeof width !== "number" || !Number.isFinite(width) || width <= 0 || width > 2000))) throw new Error(message("validation.body.tableColumnWidths"));
    if (parent === "list" && node.type !== "listitem") throw new Error(message("validation.body.listItems"));
    if (["paragraph", "heading", "link", "code"].includes(parent) && !inline.includes(node.type)) throw new Error(message("validation.body.inlineContent"));
    if (node.type === "heading" && !["h1", "h2", "h3", "h4", "h5", "h6"].includes(node.tag ?? "")) throw new Error(message("validation.body.headingLevel"));
    if (node.type === "list" && !["bullet", "number"].includes(node.listType ?? "")) throw new Error(message("validation.body.listType"));
    if (node.start !== undefined && (!Number.isInteger(node.start) || node.start < 1 || node.start > 1000000)) throw new Error(message("validation.body.listStart"));
    if (node.type === "text" && (typeof node.text !== "string" || typeof node.format !== "number" || !Number.isInteger(node.format) || node.format < 0 || node.format > 255)) throw new Error(message("validation.body.invalidText"));
    if (node.type === "text" && (textSize += node.text!.length) > 1000000) throw new Error(message("validation.body.textSize"));
    if (node.style || node.textStyle) throw new Error(message("validation.body.customStyles"));
    if (node.type === "image" && (typeof node.src !== "string" || typeof node.alt !== "string")) throw new Error(message("validation.body.imageRequired"));
    if (node.type === "link" && typeof node.url !== "string") throw new Error(message("validation.body.linkRequired"));
    if (node.type === "image" && !safePreviewUrl(node.src!, true)) throw new Error(message("validation.body.imageUrl"));
    if (node.type === "image" && node.url !== undefined && (typeof node.url !== "string" || node.url && !safePreviewUrl(node.url))) throw new Error(message("validation.body.imageLinkUrl"));
    if (node.type === "link" && !safePreviewUrl(node.url!)) throw new Error(message("validation.body.linkUrl"));
    if (node.type === "video" && (typeof node.src !== "string" || !safePreviewUrl(node.src, true))) throw new Error(message("validation.body.videoUrl"));
    if (node.type === "video" && node.poster !== undefined && (typeof node.poster !== "string" || !safePreviewUrl(node.poster, true))) throw new Error(message("validation.body.videoPosterUrl"));
    if (node.type === "video" && node.caption !== undefined && typeof node.caption !== "string") throw new Error(message("validation.body.videoCaption"));
    if (node.type === "video") for (const key of ["muted", "controls"]) if (node[key] !== undefined && typeof node[key] !== "boolean") throw new Error(message("validation.body.videoPlayback"));
    if (node.type === "embed" && (!safeEmbed(node) || typeof node.privacy !== "boolean")) throw new Error(message("validation.body.videoEmbed"));
    if (node.type === "embed" && node.title !== undefined && typeof node.title !== "string") throw new Error(message("validation.body.embedTitle"));
    for (const key of ["credit", "creditURL"]) if (node[key] !== undefined && typeof node[key] !== "string") throw new Error(message("validation.body.imageCredit"));
    if (node.creditURL && !safePreviewUrl(node.creditURL)) throw new Error(message("validation.body.imageCreditUrl"));
    if (!["text", "linebreak", "image", "video", "embed", "divider"].includes(node.type)) {
      if (!Array.isArray(node.children)) throw new Error(message("validation.body.childrenRequired"));
      for (const child of node.children) check(child, node.type, depth + 1);
      if (["table", "tablerow", "tablecell"].includes(node.type) && !node.children.length) throw new Error(message("validation.body.emptyTable"));
      if (node.type === "table") {
        const columns = node.children[0]?.children?.length ?? 0;
        if (node.children.length > MAX_TABLE_ROWS || columns > MAX_TABLE_COLUMNS || node.children.some(row => row.children?.length !== columns)) throw new Error(message("validation.body.tableSize"));
      }
    } else if (node.children !== undefined) throw new Error(message("validation.body.unexpectedChildren"));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message("validation.body.expectedBody"));
  check((value as ArticleBody).root);
}
