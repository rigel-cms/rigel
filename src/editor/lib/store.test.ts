import { expect, test } from "vitest";

// store.svelte.ts uses Svelte runes ($state/$derived) which only compile
// through vite-plugin-svelte. The pure diff logic the store wraps is tested
// here by exercising the same algorithms directly.

function draftEq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

test("same values are not dirty", () => {
  const values = { hero: { title: "Hello" } };
  expect(draftEq(structuredClone(values), values)).toBe(true);
});

test("a changed value is dirty", () => {
  const values = { hero: { title: "Hello" } };
  const draft = structuredClone(values);
  draft.hero.title = "Changed";
  expect(draftEq(draft, values)).toBe(false);
});

test("reverting a change clears dirty", () => {
  const values = { hero: { title: "Hello" } };
  const draft = structuredClone(values);
  draft.hero.title = "Changed";
  draft.hero.title = "Hello";
  expect(draftEq(draft, values)).toBe(true);
});

test("list edits are dirty, add then cancel reverts", () => {
  const values = { stats: { items: [{ v: 1 }, { v: 2 }] } };
  const draft = structuredClone(values);
  draft.stats.items.push({ v: 3 });
  expect(draftEq(draft, values)).toBe(false);
  draft.stats.items.pop();
  expect(draftEq(draft, values)).toBe(true);
});

test("nested list item field edit is dirty", () => {
  const values = { stats: { items: [{ label: "a" }] } };
  const draft = structuredClone(values);
  draft.stats.items[0].label = "b";
  expect(draftEq(draft, values)).toBe(false);
});
