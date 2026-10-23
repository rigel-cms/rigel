import { expect, test } from "vitest";
import { slugify } from "./slugify";

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
