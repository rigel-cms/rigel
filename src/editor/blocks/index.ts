import { HeadingNode } from "@lexical/rich-text";
import type { LexicalNode } from "lexical";
import type { ICONS } from "../lib/icons";
import { QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { LinkNode } from "@lexical/link";
import { CodeNode } from "@lexical/code";
import { TableNode, TableRowNode, TableCellNode } from "@lexical/table";
import { ImageNode, create as image } from "./image";
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
  { value: "paragraph", label: "Paragraph", icon: "paragraph", create: paragraph },
  { value: "h1", label: "Heading 1", icon: "heading1", create: h1 },
  { value: "h2", label: "Heading 2", icon: "heading2", create: h2 },
  { value: "h3", label: "Heading 3", icon: "heading3", create: h3 },
  { value: "h4", label: "Heading 4", icon: "heading4", create: h4 },
  { value: "h5", label: "Heading 5", icon: "heading5", create: h5 },
  { value: "h6", label: "Heading 6", icon: "heading6", create: h6 },
  { value: "quote", label: "Quote", icon: "quotes", create: quote },
  { value: "bullet", label: "Bulleted list", icon: "listBullets", create: bullet },
  { value: "number", label: "Numbered list", icon: "listNumbers", create: number },
  { value: "code", label: "Code block", icon: "code", create: code },
  { value: "image", label: "Image", icon: "image", create: image },
  { value: "divider", label: "Divider", icon: "minus", create: divider },
  { value: "table", label: "Table", icon: "table", create: table },
];
export const blockNodes = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode, ImageNode, DividerNode, TableNode, TableRowNode, TableCellNode];
