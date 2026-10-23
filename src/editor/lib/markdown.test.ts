import { expect, test } from "vitest";
import { renderMarkdown } from "./markdown";

test("headings at all levels", () => {
  expect(renderMarkdown("# A")).toBe("<h1>A</h1>");
  expect(renderMarkdown("### C")).toBe("<h3>C</h3>");
});

test("paragraphs split on blank lines", () => {
  expect(renderMarkdown("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
});

test("inline bold/italic/code/links", () => {
  const out = renderMarkdown("**b** *i* `c` [t](http://x)");
  expect(out).toContain("<strong>b</strong>");
  expect(out).toContain("<em>i</em>");
  expect(out).toContain("<code>c</code>");
  expect(out).toContain('<a href="http://x">t</a>');
});

test("bullet list wraps items", () => {
  const out = renderMarkdown("- a\n- b");
  expect(out).toBe("<ul><li>a</li><li>b</li></ul>");
});

test("fenced code blocks escape html and skip inline formatting", () => {
  const out = renderMarkdown("```\nconst x = <div>\n```");
  expect(out).toBe("<pre><code>const x = &lt;div&gt;\n</code></pre>");
});

test("html is escaped in prose", () => {
  expect(renderMarkdown("<script>alert(1)</script>")).toContain("&lt;script&gt;");
});

test("images render as img tags", () => {
  const out = renderMarkdown("![alt](http://i)");
  expect(out).toContain('<img alt="alt" src="http://i" />');
});
