import { render } from "svelte/server";
import extensions from "virtual:rigel-extensions";
import { resolveExtensions, type BlockData } from "./extensions";
import { renderArticle as renderBody, articleMarkdown as markdownBody, type ArticleRenderOptions, type ArticleMarkdownOptions } from "./article-render";
import type { ArticleBody } from "./article-body";

export type { ArticleRenderOptions, ArticleMarkdownOptions } from "./article-render";

const registry = resolveExtensions(extensions);

function blockFor(name: string, data: BlockData) {
  const block = registry.blocks.find(block => block.name === name);
  if (!block) throw new Error(`No renderer registered for extension block "${name}"`);
  block.validate(data);
  return block;
}

export function renderArticle(body: ArticleBody, options: ArticleRenderOptions & { onHead?: (head: string) => void } = {}): string {
  const head = new Set<string>();
  let index = 0;
  const html = renderBody(body, {
    ...options,
    renderExtension: (name, data) => {
      const block = blockFor(name, data);
      if (options.renderExtension) return options.renderExtension(name, data);
      const output = render(block.render, { props: { data }, idPrefix: `rigel-extension-${index++}-` });
      if (output.head) head.add(output.head);
      return output.body;
    },
  });
  const renderedHead = [...head].join("");
  if (options.onHead) { options.onHead(renderedHead); return html; }
  return renderedHead + html;
}

export function articleMarkdown(body: ArticleBody, options: ArticleMarkdownOptions = {}): string {
  return markdownBody(body, {
    extensionMarkdown: (name, data) => {
      const block = registry.blocks.find(block => block.name === name);
      block?.validate(data);
      return options.extensionMarkdown ? options.extensionMarkdown(name, data) : block?.toMarkdown?.(data);
    },
  });
}
