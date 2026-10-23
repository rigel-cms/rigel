import { expect, test } from "vitest";
import { slugify } from "./slugify";

test("suffixes duplicate titles with the first available number", () => {
  expect(slugify("Test post", ["test-post"])).toBe("test-post-2");
});

test("keeps free slugs and fills suffix gaps without stripping title numbers", () => {
  expect(slugify("Test post", ["test-post-2"])).toBe("test-post");
  expect(slugify("Test post", ["test-post", "test-post-2", "test-post-4"])).toBe("test-post-3");
  expect(slugify("Test post 2", ["test-post-2"])).toBe("test-post-2-2");
  expect(slugify("Café Über", ["cafe-uber"])).toBe("cafe-uber-2");
  expect(slugify("!!!", [""])).toBe("");
});

test("basic", () => {
  expect(slugify("My First Post")).toBe("my-first-post");
});

test("trims dashes", () => {
  expect(slugify("  --hello--  ")).toBe("hello");
});

test("collapses repeats", () => {
  expect(slugify("a   b——c")).toBe("a-b-c");
});

test("strips diacritics", () => {
  expect(slugify("Café Über")).toBe("cafe-uber");
});

test("strips emoji and symbols", () => {
  expect(slugify("Launch 🚀 Week!")).toBe("launch-week");
});

test("all-dummy input → empty", () => {
  expect(slugify("!!!")).toBe("");
  expect(slugify("🎉🎉")).toBe("");
});
