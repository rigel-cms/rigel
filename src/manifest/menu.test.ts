import { expect, test } from "vitest";
import { validateMenu, type MenuItem } from "./menu";
import { parseConfig } from "../config";

const item: MenuItem = { id: "home", label: "Home", url: "/", children: [] };
const menu = { slug: "main-nav", title: "Main navigation", items: [item] };

test.each([true, false])("preserves the new-tab flag at every level: %s", (newTab) => {
  const value = { ...menu, items: [{ ...item, newTab, children: [{ ...item, id: "child", newTab }] }] };
  expect(validateMenu(value, 3)).toEqual(value);
});

test.each(["true", "false", 1, 0, null, {}])("rejects a nonboolean new-tab flag %j", (newTab) => {
  expect(() => validateMenu({ ...menu, items: [{ ...item, newTab }] }, 3)).toThrow(/newTab/);
});

test("validates a menu and enforces root level one", () => {
  expect(validateMenu(menu, 1)).toEqual(menu);
  const nested = { ...menu, items: [{ ...item, children: [{ ...item, id: "child" }] }] };
  expect(() => validateMenu(nested, 1)).toThrow(/depth/);
  expect(validateMenu(nested, 2)).toEqual(nested);
});

test.each([null, [], {}, { ...menu, slug: "../main" }, { ...menu, title: " " }, { ...menu, items: [null] }, { ...menu, items: [{ ...item, children: null }] }])("rejects invalid shape %j", (value) => {
  expect(() => validateMenu(value, 3)).toThrow();
});

test("default depth permits two child levels, not three", () => {
  let branch = { ...item };
  for (let depth = 2; depth <= 4; depth++) {
    branch = { ...item, id: `level-${depth}`, children: [branch] };
    if (depth <= 3) expect(validateMenu({ ...menu, items: [branch] }, 3)).toBeDefined();
    else expect(() => validateMenu({ ...menu, items: [branch] }, 3)).toThrow(/depth/);
  }
});

test("rejects duplicate ids across branches", () => {
  expect(() => validateMenu({ ...menu, items: [item, { ...item, id: "other", children: [item] }] }, 3)).toThrow(/Duplicate/);
});

test.each(["javascript:alert(1)", "data:text/html,test", "vbscript:x", "//evil.test", "\\evil.test", "java\nscript:alert(1)", " /home", "", "ftp://host/file"])("rejects unsafe URL %s", (url) => {
  expect(() => validateMenu({ ...menu, items: [{ ...item, url }] }, 3)).toThrow();
});

test.each(["/about", "about", "../about", "#section", "?page=1", "https://example.org", "http://example.org", "mailto:hi@example.org", "tel:+123"])("accepts safe URL %s", (url) => {
  expect(validateMenu({ ...menu, items: [{ ...item, url }] }, 3).items[0].url).toBe(url);
});

test("defaults configured menus to depth three without mutating options", () => {
  const menus = { folder: "src/menus" };
  expect(parseConfig({ menus }).menus).toEqual({ ...menus, maxDepth: 3 });
  expect(menus).not.toHaveProperty("maxDepth");
});

test.each([0, 11, 1.5, NaN, Infinity, null, "3"])("rejects invalid configured depth %s", (maxDepth) => {
  expect(() => parseConfig({ menus: { folder: "menus", maxDepth: maxDepth as number } })).toThrow(/maxDepth/);
  expect(() => validateMenu(menu, maxDepth as number)).toThrow(/maxDepth/);
});

test.each([1, 10])("accepts configured depth boundary %s", (maxDepth) => {
  expect(parseConfig({ menus: { folder: "menus", maxDepth } }).menus?.maxDepth).toBe(maxDepth);
});

test.each(["", ".", "..", "../menus", "/menus", "src/../menus", "src//menus", "src\\menus", "menus/*", "menus/"])("rejects unsafe folder %s", (folder) => {
  expect(() => parseConfig({ menus: { folder } })).toThrow(/folder/);
});
