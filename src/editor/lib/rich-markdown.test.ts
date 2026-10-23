import { expect, test } from "vitest";
import { parseVisualMarkdown, serializeMarkdown, safeMarkdownUrl } from "./rich-markdown";

test("round-trips supported Markdown without losing structure", () => {
  const source = '# Heading\n\n**Bold** and *italic* with `code` and [link](https://example.com).\n\n> Quote\n\n- First\n- Second\n\n3. Third\n4. Fourth\n\n```js\nconst x = 1;\n```\n\n![Alt](/image.png "Title")\n\n---';
  const doc = parseVisualMarkdown(source);
  expect(doc).not.toBeNull();
  expect(parseVisualMarkdown(serializeMarkdown(doc!))?.toJSON()).toEqual(doc!.toJSON());
});

test("keeps unsupported and raw HTML documents in source mode", () => {
  for (const source of ['<script>alert(1)</script>', 'Before <span>custom</span>', '| A | B |\n| - | - |\n| a | b |', '~~removed~~', '[ref]: https://example.com\n\nText', 'Text\n\n[^1]: footnote']) {
    expect(parseVisualMarkdown(source), source).toBeNull();
  }
});

test("accepts only safe web, mail and relative URLs", () => {
  for (const url of ['https://example.com', 'http://example.com', 'mailto:a@example.com', '/image.png', '../page', '#anchor']) expect(safeMarkdownUrl(url)).toBe(true);
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', 'vbscript:foo', 'java\nscript:alert(1)', '//evil.test', '\\evil.test']) expect(safeMarkdownUrl(url)).toBe(false);
});
