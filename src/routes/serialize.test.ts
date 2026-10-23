import { expect, test } from "vitest";
import { applyValues, readValues, serializeValues, VALUES_RE } from "./serialize";

const MODULE = `import { defineCopy } from "@rigel-cms/rigel/content";

export default defineCopy({
  slug: "home",
  label: "Homepage",
  groups: [
    {
      id: "hero",
      label: "Hero",
      fields: [{ key: "title", type: "string", label: "Headline" }],
    },
  ],
  values: {
    hero: { title: "Old" },
  },
});
`;

const newValues = {
  hero: { title: "New", subtitle: "Multiline\ntext" },
  stats: {
    heading: "H",
    items: [
      { value: "1", label: "one" },
      { value: "2", label: "two" },
    ],
    empty: [],
    count: 42,
    on: true,
    nothing: null,
  },
};

test("reads data-only copy values and preserves surrounding source on compact saves", () => {
  const source = `export default defineCopy({values:{g:{text:'Héllo 🌍', n:-2, yes:true, nil:null, list:[1,2,],},}, label:'X'});`;
  expect(readValues(source)).toEqual({g:{text:'Héllo 🌍', n:-2, yes:true, nil:null, list:[1,2]}});
  const next = applyValues(source, {g:{text:'東京 $&'}});
  expect(readValues(next)).toEqual({g:{text:'東京 $&'}});
  expect(next.endsWith(", label:'X'});")).toBe(true);
});

test.each(["call()", "`template`", "{...other}", "{get x(){return 1}}", "{__proto__: {}}", "{x:1,x:2}", "NaN", "undefined"])("rejects executable or ambiguous literal %s", value => {
  expect(() => readValues(`export default defineCopy({values:${value}});`)).toThrow();
});

test("regex matches a hand-written values block", () => {
  expect(VALUES_RE.test(MODULE)).toBe(true);
});

test("applyValues swaps only the values block, keeps schema intact", () => {
  const out = applyValues(MODULE, newValues);
  expect(out).toContain('slug: "home"');
  expect(out).toContain('fields: [{ key: "title", type: "string", label: "Headline" }]');
  expect(out).toContain('title: "New"');
  expect(out).toContain("count: 42");
  expect(out).toContain("on: true");
  expect(out).toContain("nothing: null");
  expect(out).not.toContain('"Old"');
});

test("multiline strings are escaped as JSON, lists inline as objects", () => {
  const out = applyValues(MODULE, newValues);
  expect(out).toContain('"Multiline\\ntext"');
  expect(out).toContain('{ value: "1", label: "one" }');
  expect(out).toContain("empty: []");
});

test("round-trip: output of a save can be saved again", () => {
  const once = applyValues(MODULE, newValues);
  const twice = applyValues(once, newValues);
  expect(twice).toBe(once);
});

test("restoring original values reproduces the original values block semantics", () => {
  const touched = applyValues(MODULE, newValues);
  const restored = applyValues(touched, { hero: { title: "Old" } });
  expect(restored).toContain('title: "Old"');
  expect(restored).not.toContain('"Multiline');
  expect(restored).not.toContain("stats:");
  // schema above the values block is untouched
  expect(restored.split("values:")[0]).toBe(MODULE.split("values:")[0]);
});

test("rejects source without a matching values block", () => {
  expect(() => applyValues("export default defineCopy({});", newValues)).toThrow();
});

test("round-trips empty objects and quoted group names", () => {
  const values = { "group-name": { empty: {}, nested: { empty: {} } } };
  expect(readValues(applyValues(MODULE,values))).toEqual(values);
});

test("quotes keys that are not valid identifiers", () => {
  const out = serializeValues({ g: { "data-x": "1", ok: "2" } });
  expect(out).toContain('"data-x": "1"');
  expect(out).toContain("ok: \"2\"");
});
