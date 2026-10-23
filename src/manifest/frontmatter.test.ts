import { expect, test } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

const DOC = `---
slug: "hello-world"
title: "Hello, world"
date: "2026-09-13"
draft: true
tags: ["a", "b"]
---
# Head

Body text.
`;

test("parses frontmatter keys, booleans, arrays, quoted strings", () => {
  const p = parseFrontmatter(DOC);
  expect(p.slug).toBe("hello-world");
  expect(p.frontmatter.title).toBe("Hello, world");
  expect(p.frontmatter.date).toBe("2026-09-13");
  expect(p.frontmatter.draft).toBe(true);
  expect(p.frontmatter.tags).toEqual(["a", "b"]);
  expect(p.body).toContain("# Head");
});

test("body split keeps markdown intact", () => {
  const p = parseFrontmatter(DOC);
  expect(p.body).toBe("# Head\n\nBody text.\n");
});

test("no frontmatter → whole file is body", () => {
  const p = parseFrontmatter("# Just a post\n");
  expect(p.frontmatter).toEqual({});
  expect(p.body).toContain("# Just");
});

test("round-trips to identical file", () => {
  const once = parseFrontmatter(DOC);
  const out = serializeFrontmatter(once);
  expect(parseFrontmatter(out)).toEqual(once);
});

test("edited values serialize correctly", () => {
  const p = parseFrontmatter(DOC);
  p.frontmatter.title = "Renamed";
  p.frontmatter.draft = false;
  p.body = "# New body\n";
  const out = serializeFrontmatter(p);
  expect(out).toContain('title: "Renamed"');
  expect(out).toContain("draft: false");
  expect(out.endsWith("# New body\n")).toBe(true);
});
