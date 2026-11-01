import { expect, test } from "vitest";
import { markdownToBody } from "./markdown-blocks";
import { articleMarkdown } from "../../article-render";
import { validateBody } from "../../article-body";

const legal = "**Analytics are opt-in.** We use Google Analytics 4, but only after you accept cookies.\n\n## The short version\n\n- **Bullets** keep their emphasis.\n- Links such as [policies.google.com/privacy](https://policies.google.com/privacy) stay intact.\n\n### Contact\n\nEmail [us](mailto:hello@example.com) or read the [terms](/terms/).\n\n> A quoted notice.\n\n1. First step\n2. Second step\n\n---\n\nA closing paragraph with `inline code` and *emphasis*.";

test("converts supported Markdown into a validated article body", () => {
  const body = markdownToBody(legal);
  expect(body).not.toBeNull();
  expect(() => validateBody(body)).not.toThrow();
  expect(body!.root.children.map(node => node.type)).toEqual(["paragraph", "heading", "list", "heading", "paragraph", "quote", "list", "divider", "paragraph"]);
});

test("keeps the rendered Markdown identical after a conversion round trip", () => {
  const body = markdownToBody(legal)!;
  expect(articleMarkdown(body)).toContain("**Analytics are opt-in.**");
  expect(markdownToBody(articleMarkdown(body))).toEqual(body);
});

test("preserves inline emphasis, links and code as block formats", () => {
  const body = markdownToBody("Plain **bold** *italic* `code` [link](https://example.com).")!;
  const children = (body.root.children[0] as unknown as { children: { type: string; format?: number; text?: string; url?: string }[] }).children;
  expect(children.map(child => [child.type, child.format, child.text ?? child.url])).toEqual([
    ["text", 0, "Plain "],
    ["text", 1, "bold"],
    ["text", 0, " "],
    ["text", 2, "italic"],
    ["text", 0, " "],
    ["text", 16, "code"],
    ["text", 0, " "],
    ["link", undefined, "https://example.com"],
    ["text", 0, "."],
  ]);
});

test("keeps unsupported Markdown out of the block editor", () => {
  for (const source of [
    "```js\nconst x = 1;\n```",
    "<span>custom html</span>",
    "| a | b |\n| - | - |\n| 1 | 2 |",
    "Text with a hard\nline break",
    "![alt](/image.png \"title\")",
  ]) expect(markdownToBody(source), source).toBeNull();
});

test("only returns bodies that pass article validation", () => {
  expect(() => validateBody(markdownToBody("")!)).not.toThrow();
  expect(() => validateBody(markdownToBody("   \n\n  ")!)).not.toThrow();
  const unsafe = markdownToBody("[x](javascript:alert(1))")!;
  expect(validateBody(unsafe)).toBeUndefined();
  expect(JSON.stringify(unsafe)).not.toContain('"type":"link"');
});
