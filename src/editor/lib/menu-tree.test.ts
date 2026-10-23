import { expect, test } from "vitest";
import { editMenuItem, menuRows, moveMenuItem } from "./menu-tree";
import type { MenuItem } from "../../manifest/menu";

const item = (id: string, children: MenuItem[] = []): MenuItem => ({ id, label: id, url: "/", children });

test("moves subtrees, reorders siblings and outdents without mutating input", () => {
  const items = [item("a", [item("child")]), item("b"), item("c")];
  const nested = moveMenuItem(items, "a", "b", "inside", 3);
  expect(menuRows(nested).map(r => [r.item.id, r.depth])).toEqual([["b", 1], ["a", 2], ["child", 3], ["c", 1]]);
  const out = moveMenuItem(nested, "a", "b", "after", 3);
  expect(out.map(i => i.id)).toEqual(["b", "a", "c"]);
  expect(moveMenuItem(out, "c", "b", "before", 3).map(i => i.id)).toEqual(["c", "b", "a"]);
  expect(moveMenuItem(nested, "a", null, "after", 3).map(i => i.id)).toEqual(["b", "c", "a"]);
  expect(items.map(i => i.id)).toEqual(["a", "b", "c"]);
  expect(items[0].children[0].id).toBe("child");
});

test("rejects cycles, nonexistent targets and depth overflow for the entire subtree", () => {
  const items = [item("a", [item("child")]), item("b")];
  expect(() => moveMenuItem(items, "a", "child", "inside", 3)).toThrow(/itself/);
  expect(() => moveMenuItem(items, "a", "a", "after", 3)).toThrow(/itself/);
  expect(() => moveMenuItem(items, "a", "b", "inside", 2)).toThrow(/limit/);
  expect(() => moveMenuItem(items, "a", "missing", "after", 3)).toThrow(/target/);
  expect(() => moveMenuItem(items, "missing", "b", "after", 3)).toThrow(/not found/);
});

test("edits and removes nested items without losing unrelated siblings", () => {
  const items = [item("a", [item("child")]), item("b")];
  expect(editMenuItem(items, "child", i => ({ ...i, label: "Updated" }))[0].children[0].label).toBe("Updated");
  expect(editMenuItem(items, "a", () => null).map(i => i.id)).toEqual(["b"]);
});
