import MarkdownIt from "markdown-it";
import { MarkdownParser, defaultMarkdownParser, defaultMarkdownSerializer, schema } from "prosemirror-markdown";
import type { Node } from "prosemirror-model";

const tokenizer = new MarkdownIt({ html: true });
const parser = new MarkdownParser(schema, tokenizer, defaultMarkdownParser.tokens);
export { schema };
export const serializeMarkdown = (doc: Node) => defaultMarkdownSerializer.serialize(doc);

export function safeMarkdownUrl(url: string): boolean {
  return !/[\s\u0000-\u001f\u007f\\]/.test(url) && !url.startsWith("//") && (!/^[a-z][a-z\d+.-]*:/i.test(url) || /^(https?:|mailto:)/i.test(url));
}

export function parseVisualMarkdown(source: string): Node | null {
  try {
    const env: { references?: unknown } = {};
    tokenizer.parse(source, env);
    if (env.references) return null;
    const doc = parser.parse(source);
    let safe = true;
    doc.descendants(node => {
      if (node.type.name === "image" && !safeMarkdownUrl(node.attrs.src)) safe = false;
      if (node.marks.some(mark => mark.type.name === "link" && !safeMarkdownUrl(mark.attrs.href))) safe = false;
    });
    if (!safe || tokenizer.render(source) !== tokenizer.render(serializeMarkdown(doc))) return null;
    return doc;
  } catch {
    return null;
  }
}
