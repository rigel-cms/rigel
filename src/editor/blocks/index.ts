import { translate } from "../i18n";
import { HeadingNode } from "@lexical/rich-text";
import type { LexicalNode } from "lexical";
import type { ICONS } from "../lib/icons";
import { QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { ImageNode, create as image } from "./image";
import { VideoNode } from "./video";
import { EmbedNode } from "./embed";
import { DividerNode, create as divider } from "./divider";
import { create as quote } from "./quote";
import { create as bullet } from "./bulleted-list";
import { create as number } from "./numbered-list";
import { create as code } from "./code";
import { create as paragraph } from "./paragraph";
import { create as h1 } from "./h1";
import { create as h2 } from "./h2";
import { create as h3 } from "./h3";
import { create as h4 } from "./h4";
import { create as h5 } from "./h5";
import { create as h6 } from "./h6";
import { create as table } from "./table";

export const blockTypes: { value: string; label: string; icon: keyof typeof ICONS; create: () => LexicalNode }[] = [
  { value: "paragraph", get label() { return translate("richtext.paragraph"); }, icon: "paragraph", create: paragraph },
  { value: "h1", get label() { return translate("richtext.heading", { level: 1 }); }, icon: "heading1", create: h1 },
  { value: "h2", get label() { return translate("richtext.heading", { level: 2 }); }, icon: "heading2", create: h2 },
  { value: "h3", get label() { return translate("richtext.heading", { level: 3 }); }, icon: "heading3", create: h3 },
  { value: "h4", get label() { return translate("richtext.heading", { level: 4 }); }, icon: "heading4", create: h4 },
  { value: "h5", get label() { return translate("richtext.heading", { level: 5 }); }, icon: "heading5", create: h5 },
  { value: "h6", get label() { return translate("richtext.heading", { level: 6 }); }, icon: "heading6", create: h6 },
  { value: "quote", get label() { return translate("richtext.quote"); }, icon: "quotes", create: quote },
  { value: "bullet", get label() { return translate("richtext.bulletedList"); }, icon: "listBullets", create: bullet },
  { value: "number", get label() { return translate("richtext.numberedList"); }, icon: "listNumbers", create: number },
  { value: "code", get label() { return translate("richtext.codeBlock"); }, icon: "code", create: code },
  { value: "image", get label() { return translate("richtext.image"); }, icon: "image", create: image },
  { value: "divider", get label() { return translate("richtext.divider"); }, icon: "minus", create: divider },
  { value: "table", get label() { return translate("richtext.table"); }, icon: "table", create: table },
];
export const blockNodes = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, ImageNode, VideoNode, EmbedNode, DividerNode, TableNode, TableRowNode, TableCellNode];
