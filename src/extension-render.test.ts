import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "svelte/compiler";
import type { Component } from "svelte";
import type { BlockData, RigelExtension } from "./extensions";
import { emptyBody, type ArticleBody } from "./article-body";
import { renderArticle as renderPure, articleMarkdown as markdownPure } from "./article-render";

const { extensions } = vi.hoisted(() => ({ extensions: [] as RigelExtension[] }));
vi.mock("virtual:rigel-extensions", () => ({ default: extensions }));
let article: typeof import("./article");
let directory: string;
const body = (data: BlockData = { text: "Hello" }, name = "cta"): ArticleBody => {
  const value = emptyBody();
  const node = { type: "extension", version: 1, name, data };
  value.root.children = [node];
  return value;
};

beforeAll(async () => {
  await mkdir("_temp", { recursive: true });
  directory = await mkdtemp(resolve("_temp/extension-render-"));
  const component = compile('<script>let { data } = $props();</script><svelte:head><meta name="extension-test" content={data.text} /></svelte:head><aside>{data.text}</aside><style>aside { color: red; }</style>', { filename: "Extension.svelte", generate: "server", css: "injected" });
  const file = resolve(directory, "Extension.mjs");
  await writeFile(file, component.js.code);
  const render = (await import(pathToFileURL(file).href)).default as Component<{ data: BlockData }>;
  extensions.push({ name: "fixture", blocks: [{ name: "cta", label: "CTA", editor: render, render, validate(data) { if (typeof data.text !== "string") throw new Error("Expected text"); }, toMarkdown: data => `CTA: ${data.text}` }] });
  article = await import("./article");
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

test("pure renderer fails loudly without a published renderer and emits escaped inert preview markers", () => {
  const state = body({ text: '\"<script>alert(1)</script> & ```' });
  expect(() => renderPure(state)).toThrow('No renderer registered for extension block "cta"');
  const callback = vi.fn(() => "trusted component HTML");
  const html = renderPure(state, { preview: true, renderExtension: callback });
  expect(callback).not.toHaveBeenCalled();
  expect(html).toContain('data-rigel-extension="cta"');
  expect(html).toContain('&quot;text&quot;:');
  expect(html).toContain('&lt;script&gt;');
  expect(html).not.toContain("<script>");
  expect(renderPure(state, { renderExtension: callback })).toBe("trusted component HTML");
});

test("Markdown preserves custom data with a fence longer than data backticks, or uses the explicit callback", () => {
  const data = { text: "```\n<script>x</script>", nested: { values: [1, true, null] } };
  const markdown = markdownPure(body(data));
  expect(markdown).toBe('````rigel-extension\n' + JSON.stringify({ type: "extension", version: 1, name: "cta", data }) + '\n````\n');
  expect(markdownPure(body(), { extensionMarkdown: () => "Custom text" })).toBe("Custom text\n");
});

test("public wrapper uses real Svelte SSR, escapes props, preserves head and component CSS", () => {
  const state = body({ text: '<script>alert("x")</script>' });
  const html = article.renderArticle(state);
  expect(html).toContain("&lt;script>");
  expect(html).not.toContain('<script>alert');
  expect(html).toContain('<meta name="extension-test"');
  expect(html).toContain("<style");
  expect(html).toContain("color:red");
  const head = vi.fn();
  const content = article.renderArticle(state, { onHead: head });
  expect(head).toHaveBeenCalledWith(expect.stringContaining('<meta name="extension-test"'));
  expect(content).not.toContain("<style");
  expect(content).toContain("<aside");
  expect(article.renderArticle(state, { preview: true })).toBe(renderPure(state, { preview: true }));
  expect(article.articleMarkdown(body())).toBe("CTA: Hello\n");
  expect(() => article.renderArticle(body({ text: 1 }))).toThrow("Expected text");
  expect(() => article.articleMarkdown(body({ text: 1 }))).toThrow("Expected text");
  expect(() => article.renderArticle(body({}, "missing"))).toThrow('No renderer registered');
  expect(article.articleMarkdown(body({}, "missing"))).toContain('"name":"missing"');
});
