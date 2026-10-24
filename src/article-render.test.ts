import { expect, test } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { createEditor } from "lexical";
import { blockNodes, blockTypes } from "./editor/blocks";
import { emptyBody, validateBody, type ArticleBody, type ArticleNode } from "./article-body";
import { renderArticle, articleMarkdown } from "./article-render";

const text = (value: string, format = 0) => ({ type: "text", version: 1, text: value, format, detail: 0, mode: "normal", style: "" });
const block = (type: string, children: unknown[] = [], extra = {}) => ({ type, version: 1, children, direction: null, format: "", indent: 0, ...extra });
const body = (children: unknown[]) => ({ root: block("root", children) }) as ArticleBody;

test("one allowlisted renderer covers every v1 block and escapes text and attributes", () => {
  const state = body([
    block("paragraph", [text('<script>alert("x")</script>', 3)]),
    ...[1, 2, 3, 4, 5, 6].map(level => block("heading", [text("Heading")], { tag: `h${level}` })),
    block("quote", [text("Quote")]),
    block("list", [block("listitem", [text("Item")])], { listType: "bullet" }),
    block("list", [block("listitem", [text("Number")])], { listType: "number", start: 3 }),
    block("code", [text("<img onerror=alert(1)>\nconst x = 2;")]),
    block("paragraph", [block("link", [text("Link")], { url: "/about/?q=\"quoted\"" }), text("strike", 4), text("inline", 16)]),
    { type: "image", version: 1, src: "/demo/landscape.jpg", alt: '\" onerror=\"alert(1)', credit: "Credit", creditURL: "https://example.org/" },
    { type: "divider", version: 1 },
  ]);
  const html = renderArticle(state);
  expect(html).toContain("<em><strong>&lt;script&gt;");
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "pre", "code", "s", "a", "figure", "img", "figcaption", "hr"]) expect(html).toContain(`<${tag}`);
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('<img onerror');
  expect(html).toContain('alt="&quot; onerror=&quot;alert(1)"');
  const original = JSON.stringify(state);
  const markdown = articleMarkdown(state);
  expect(markdown).toContain("## Heading");
  expect(markdown).toContain("> Quote");
  expect(markdown).toContain("3. Number");
  expect(markdown).toContain("~~strike~~");
  expect(JSON.stringify(state)).toBe(original);
});

test("all six heading levels preserve content through Lexical, HTML and Markdown", () => {
  const editor = createEditor({ nodes: blockNodes, onError: error => { throw error; } });
  for (const level of [1, 2, 3, 4, 5, 6]) {
    const state = body([block("heading", [text("Heading", 1)], { tag: `h${level}` })]);
    const loaded = editor.parseEditorState(JSON.stringify(state)).toJSON();
    expect(renderArticle(loaded)).toBe(`<h${level}><strong>Heading</strong></h${level}>`);
    expect(articleMarkdown(loaded)).toBe(`${"#".repeat(level)} **Heading**\n`);
    expect(blockTypes.find(block => block.value === `h${level}`)?.icon).toBe(`heading${level}`);
  }
});

test("image links survive Lexical, public HTML and Markdown with safe URL validation", () => {
  const image = { type: "image", version: 1, src: "/demo/landscape.jpg", alt: "Linked photo", url: '/about/?q="photo"' };
  const state = body([image]);
  const editor = createEditor({ nodes: blockNodes, onError: error => { throw error; } });
  expect(editor.parseEditorState(JSON.stringify(state)).toJSON().root.children[0]).toMatchObject(image);
  expect(renderArticle(state)).toContain('<a href="/about/?q=&quot;photo&quot;"><img');
  expect(articleMarkdown(state)).toContain('[![Linked photo](</demo/landscape.jpg>)](</about/?q="photo">)');
  for (const url of ["javascript:alert(1)", "data:text/html,x", 123]) expect(() => validateBody(body([{ ...image, url }]))).toThrow();
});

test("extra inline formats round-trip safely through Lexical, HTML and Markdown", () => {
  const editor = createEditor({ nodes: blockNodes, onError: error => { throw error; } });
  for (const [format, tag] of [[8, "u"], [32, "sub"], [64, "sup"], [128, "mark"]] as const) {
    const state = body([block("paragraph", [text("<script>unsafe</script>", format)])]);
    const loaded = editor.parseEditorState(JSON.stringify(state)).toJSON();
    const html = `<${tag}>&lt;script&gt;unsafe&lt;/script&gt;</${tag}>`;
    expect(renderArticle(loaded)).toBe(`<p>${html}</p>`);
    expect(articleMarkdown(loaded)).toBe(`${html}\n`);
  }
  expect(renderArticle(body([block("paragraph", [text("Both", 8 | 4)])]))).toBe("<p><u><s>Both</s></u></p>");
  for (const format of [-1, 256, 1024, 2 ** 32]) expect(() => validateBody(body([block("paragraph", [text("No", format)])]))).toThrow();
});

test("rejects unknown nodes, unsafe URLs, styles, invalid hierarchy and excessive trees", () => {
  for (const node of [
    { type: "script", version: 1 },
    block("callout", [text("Unsupported")]),
    block("heading", [text("No")], { tag: "h7" }),
    block("paragraph", [block("paragraph")]),
    block("paragraph", [block("link", [text("No")], { url: "javascript:alert(1)" })]),
    { type: "image", version: 1, src: "data:image/svg+xml,x", alt: "No" },
    block("paragraph", [{ ...text("No"), style: "background:url(https://example.org)" }]),
    block("paragraph", [text("x".repeat(1000001))]),
  ]) expect(() => validateBody(body([node]))).toThrow();
  expect(() => validateBody("# Markdown is no longer a body")).toThrow();
  expect(() => validateBody(emptyBody())).not.toThrow();
  expect(blockTypes.some(block => block.value === "callout")).toBe(false);
  expect(blockNodes.some(node => node.getType() === "callout")).toBe(false);
});

test("tables preserve cells, headers and formatting through Lexical, HTML and read-only Markdown", () => {
  const cell = (value: string, headerState = 0) => block("tablecell", [block("paragraph", [text(value)])], { headerState, colSpan: 1, rowSpan: 1, backgroundColor: null });
  const state = body([block("table", [
    block("tablerow", [cell("Product", 1), cell("Price", 1)]),
    block("tablerow", [cell("<script> | item"), cell("10")]),
  ])]);
  const editor = createEditor({ namespace: "table-test", nodes: blockNodes, onError: error => { throw error; } });
  const loaded = editor.parseEditorState(JSON.stringify(state)).toJSON();
  expect(renderArticle(loaded)).toBe(renderArticle(state));
  expect(renderArticle(state)).toContain('<thead><tr><th scope="col"><p>Product</p></th>');
  expect(renderArticle(state)).toContain('<td><p>&lt;script&gt; | item</p></td>');
  expect(articleMarkdown(state)).toContain('| Product | Price |\n| --- | --- |');
  expect(articleMarkdown(state)).toContain('\\<script\\> \\| item');
  const malformed = structuredClone(state) as unknown as { root: { children: ReturnType<typeof block>[] } };
  malformed.root.children[0].children[1] = block("tablerow", [cell("uneven")]);
  expect(() => validateBody(malformed)).toThrow(/rectangular/);
  for (const invalid of [
    block("table", []), block("tablerow", [cell("outside")]),
    block("table", [block("tablerow", [block("tablecell", [block("paragraph")], { headerState: 0, colSpan: 2 })])]),
    block("table", [block("tablerow", [{ ...cell("bad"), backgroundColor: "url(https://example.org/)" }])]),
    block("table", Array.from({ length: 51 }, () => block("tablerow", [cell("too tall")]))),
    block("table", [block("tablerow", Array.from({ length: 21 }, () => cell("too wide")))]),
  ]) expect(() => validateBody(body([invalid]))).toThrow();
});

test("all eight fixture article trees load in vanilla Lexical with no content loss", async () => {
  let count = 0;
  for (const collection of ["blog", "news"]) {
    const folder = `tests/fixtures/site/src/content/${collection}`;
    const files = await readdir(folder);
    expect(files.some(file => file.endsWith(".md"))).toBe(false);
    for (const file of files.filter(file => file.endsWith(".json"))) {
      const article = JSON.parse(await readFile(`${folder}/${file}`, "utf8"));
      validateBody(article.body);
      const editor = createEditor({ namespace: "test", nodes: blockNodes, onError: error => { throw error; } });
      const loaded = editor.parseEditorState(JSON.stringify(article.body));
      expect(renderArticle(loaded.toJSON())).toBe(renderArticle(article.body));
      expect(JSON.parse(JSON.stringify(loaded.toJSON()))).toEqual(article.body);
      count++;
    }
  }
  expect(count).toBe(8);
});

test("Typography check demonstrates every editor block and inline format", async () => {
  const article = JSON.parse(await readFile("tests/fixtures/site/src/content/blog/typography-check.json", "utf8"));
  expect(article.frontmatter.title).toBe("Typography check");
  validateBody(article.body);
  const walk = (node: ArticleNode): ArticleNode[] => [node, ...(node.children ?? []).flatMap(walk)];
  const nodes = walk(article.body.root);
  const types = new Set(nodes.map(node => node.type === "heading" ? node.tag : node.type === "list" ? node.listType : node.type));
  for (const block of blockTypes) expect(types.has(block.value), block.label).toBe(true);
  for (const format of [1, 2, 4, 8, 16, 32, 64, 128]) expect(nodes.some(node => node.type === "text" && node.format === format), `Text format ${format}`).toBe(true);
  expect(types.has("linebreak")).toBe(true);
  expect(nodes.some(node => node.type === "link" && node.url?.startsWith("/"))).toBe(true);
  expect(nodes.some(node => node.type === "link" && node.url?.startsWith("https://"))).toBe(true);
  expect(nodes.some(node => node.type === "listitem" && node.children?.some(child => child.type === "list"))).toBe(true);
  expect(nodes.some(node => node.type === "image" && node.alt && node.credit && node.creditURL)).toBe(true);
  expect(nodes.some(node => node.type === "image" && node.alt && node.url)).toBe(true);
});

test("video and embed blocks survive Lexical, public HTML and Markdown", () => {
  const editor = createEditor({ nodes: blockNodes, onError: error => { throw error; } });
  const video = { type: "video", version: 1, src: "/rigel-media/abc.mp4", poster: "/rigel-media/abc.jpg", caption: "Site walkthrough" };
  const embed = { type: "embed", version: 1, provider: "youtube", id: "dQw4w9WgXcQ", title: "Launch tour", privacy: true };
  const state = body([video, embed]);
  const loaded = editor.parseEditorState(JSON.stringify(state)).toJSON();
  expect(loaded.root.children[0]).toMatchObject(video);
  expect(loaded.root.children[1]).toMatchObject(embed);
  const html = renderArticle(state);
  expect(html).toContain('<figure class="media-video"><video controls preload="metadata" playsinline src="/rigel-media/abc.mp4" poster="/rigel-media/abc.jpg">');
  expect(html).toContain("<figcaption>Site walkthrough</figcaption>");
  expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"');
  expect(html).toContain('title="Launch tour"');
  expect(html).toContain("loading=\"lazy\"");
  expect(html).not.toContain("youtube.com/embed/");
  expect(articleMarkdown(state)).toContain("[Video: Site walkthrough](</rigel-media/abc.mp4>)");
  expect(articleMarkdown(state)).toContain("[Launch tour](<https://www.youtube.com/watch?v=dQw4w9WgXcQ>)");
});

test("embed privacy can be switched off and invalid embeds are rejected at validation", () => {
  const embed = { type: "embed", version: 1, provider: "vimeo", id: "76979871", privacy: false };
  expect(renderArticle(body([embed]))).toContain('src="https://player.vimeo.com/video/76979871"');
  expect(renderArticle(body([{ ...embed, privacy: true }]))).toContain('src="https://player.vimeo.com/video/76979871?dnt=1"');
  for (const bad of [
    { ...embed, id: "abc" },
    { ...embed, provider: "example" },
    { ...embed, privacy: "yes" },
    { ...embed, title: 42 },
    { type: "embed", version: 1, provider: "youtube", id: "dQw4w9WgXcQ" },
  ]) expect(() => validateBody(body([bad]))).toThrow();
  for (const src of ["javascript:alert(1)", "https://example.com/a.mp4\n", 42]) expect(() => validateBody(body([{ type: "video", version: 1, src }]))).toThrow();
});
