import { expect, test } from "vitest";
import { loadManifest } from "./loader";
import type { CopyPage } from "./types";

const home: CopyPage = {
  slug: "home",
  label: "Homepage",
  groups: [
    {
      id: "hero",
      label: "Hero",
      fields: [
        { key: "title", type: "string", label: "Headline" },
        { key: "subtitle", type: "text", label: "Subheadline" },
      ],
    },
  ],
  values: { hero: { title: "Hello", subtitle: "World" } },
};

test("loads copy modules into a manifest, sorted by slug", () => {
  const about: CopyPage = { slug: "about", label: "About", groups: home.groups, values: {} };
  const manifest = loadManifest([home, about]);
  expect(manifest.pages.map((p) => p.slug)).toEqual(["about", "home"]);
});

test("preserves groups and fields", () => {
  const manifest = loadManifest([home]);
  expect(manifest.pages[0].groups[0].fields[0].key).toBe("title");
  expect(manifest.pages[0].values.hero.title).toBe("Hello");
});

test("accepts multiple groups and pages", () => {
  const manifest = loadManifest([home]);
  expect(manifest.pages).toHaveLength(1);
  expect(manifest.pages[0]).toBe(home);
});

test("does not mutate the input order", () => {
  const pages: CopyPage[] = [
    { slug: "zebra", label: "Z", groups: home.groups, values: {} },
    { slug: "alpha", label: "A", groups: home.groups, values: {} },
  ];
  loadManifest(pages);
  expect(pages[0].slug).toBe("zebra");
});

test("rejects a page without a slug", () => {
  const bad = { slug: "", label: "X", groups: home.groups, values: {} } as CopyPage;
  expect(() => loadManifest([bad])).toThrow(/missing slug/);
});

test("rejects a group without fields", () => {
  const bad: CopyPage = {
    slug: "x",
    label: "X",
    groups: [{ id: "g", label: "G", fields: [] }],
    values: {},
  };
  expect(() => loadManifest([bad])).toThrow(/missing id or fields/);
});

test("rejects a group without an id", () => {
  const bad: CopyPage = {
    slug: "x",
    label: "X",
    groups: [{ id: "", label: "G", fields: home.groups[0].fields }],
    values: {},
  };
  expect(() => loadManifest([bad])).toThrow();
});

test("rejects modules without groups", () => {
  const bad = { slug: "x", label: "X", groups: [], values: {} } as CopyPage;
  expect(() => loadManifest([bad])).toThrow();
});
