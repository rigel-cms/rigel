import MarkdownIt from "markdown-it";
import type { Mark, Node as MarkdownNode } from "prosemirror-model";
import { parseVisualMarkdown } from "./rich-markdown";
import { articleMarkdown } from "../../article-render";
import { validateBody, type ArticleBody, type ArticleNode } from "../../article-body";

const renderer = new MarkdownIt({ html: true });

const FORMATS: Record<string, number> = { strong: 1, em: 2, code: 16 };

function textFormat(marks: readonly Mark[]): number {
  return marks.reduce((bits, mark) => bits | (FORMATS[mark.type.name] ?? 0), 0);
}

function linkHref(marks: readonly Mark[]): string | null {
  const link = marks.find(mark => mark.type.name === "link");
  return link && typeof link.attrs.href === "string" ? link.attrs.href : null;
}

function textNode(text: string, format: number): ArticleNode {
  return { type: "text", version: 1, text, format, detail: 0, mode: "normal", style: "" };
}

function inline(nodes: readonly MarkdownNode[]): ArticleNode[] {
  const result: ArticleNode[] = [];
  const parts = nodes.map(node => ({ node, href: node.type.name === "text" ? linkHref(node.marks) : null }));
  for (let index = 0; index < parts.length; index++) {
    const { node, href } = parts[index];
    if (node.type.name === "hard_break") { result.push({ type: "linebreak", version: 1 }); continue; }
    if (node.type.name !== "text") return [];
    const children = [textNode(node.text!, textFormat(node.marks))];
    while (index + 1 < parts.length && parts[index + 1].href === href && parts[index + 1].node.type.name === "text") {
      index++;
      children.push(textNode(parts[index].node.text!, textFormat(parts[index].node.marks)));
    }
    if (href) result.push({ type: "link", version: 1, url: href, children });
    else result.push(...children);
  }
  return result;
}

function block(node: MarkdownNode): ArticleNode | null {
  const children = () => [...node.content.content].map(block).filter((child): child is ArticleNode => !!child);
  const inlineChildren = () => inline([...node.content.content]);
  if (node.type.name === "paragraph") return { type: "paragraph", version: 1, children: inlineChildren(), direction: null, format: "", indent: 0, textFormat: 0, textStyle: "" };
  if (node.type.name === "heading") return { type: "heading", version: 1, tag: `h${node.attrs.level}`, children: inlineChildren(), direction: null, format: "", indent: 0 };
  if (node.type.name === "blockquote") return { type: "quote", version: 1, children: children() };
  if (node.type.name === "bullet_list") return { type: "list", version: 1, listType: "bullet", tag: "ul", start: 1, children: children() };
  if (node.type.name === "ordered_list") return { type: "list", version: 1, listType: "number", tag: "ol", start: Number(node.attrs.order) || 1, children: children() };
  if (node.type.name === "list_item") return { type: "listitem", version: 1, value: 1, children: children() };
  if (node.type.name === "code_block") return { type: "code", version: 1, language: null, children: node.textContent ? [textNode(node.textContent, 0)] : [] };
  if (node.type.name === "horizontal_rule") return { type: "divider", version: 1 };
  if (node.type.name === "image") return { type: "image", version: 1, src: String(node.attrs.src ?? ""), alt: String(node.attrs.alt ?? "") };
  return null;
}

export function markdownToBody(source: string): ArticleBody | null {
  const doc = parseVisualMarkdown(source);
  if (!doc) return null;
  const blocks = [...doc.content.content].map(block);
  if (blocks.some(item => !item)) return null;
  const body = { root: { type: "root", version: 1, children: blocks as ArticleNode[], direction: null, format: "", indent: 0 } } as ArticleBody;
  try {
    validateBody(body);
  } catch {
    return null;
  }
  return renderer.render(source).trimEnd() === renderer.render(articleMarkdown(body)).trimEnd() ? body : null;
}
