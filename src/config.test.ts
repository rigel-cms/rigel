import { expect, test } from "vitest";
import { parseConfig } from "./config";

test("defaults to local backend + src/content/copy", () => {
  expect(parseConfig()).toEqual({
    copyDir: "src/content/copy",
    backend: "local",
    jsonOutput: "pretty",
    demo: true,
    maxFileSize: 2 * 1024 * 1024,
  });
});

test("maxFileSize is a positive byte count with no per-type ceiling", () => {
  for (const maxFileSize of [1, 2 * 1024 * 1024, 100 * 1024 * 1024]) expect(parseConfig({ maxFileSize }).maxFileSize).toBe(maxFileSize);
  for (const maxFileSize of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "2MB", null]) expect(() => parseConfig({ maxFileSize } as never)).toThrow(/maxFileSize/);
});

test("demo defaults on and false excludes demo documents without mutating the site schema", () => {
  const fields = [{ key: "name", label: "Name", type: "string" as const }];
  const schema = { objects: [], documents: [
    { name: "settings", title: "Site settings", type: "document" as const, folder: "settings", shared: true, singleton: true, fields },
    { name: "showcase", title: "Demo", type: "document" as const, folder: "demo", shared: true, singleton: true, demo: true, fields },
  ] };
  expect(parseConfig({ schema }).schema?.documents.map(type => type.name)).toEqual(["settings", "showcase"]);
  expect(parseConfig({ schema, demo: false }).schema?.documents.map(type => type.name)).toEqual(["settings"]);
  expect(schema.documents).toHaveLength(2);
  expect(parseConfig(parseConfig({ schema, demo: false })).schema?.documents.map(type => type.name)).toEqual(["settings"]);
  expect(parseConfig({ demo: undefined }).demo).toBe(true);
  for (const demo of ["false", 0, null]) expect(() => parseConfig({ demo } as never)).toThrow(/demo.*boolean/);
  expect(() => parseConfig({ schema: { ...schema, documents: [{ ...schema.documents[0], demo: "true" } as never] } })).toThrow(/demo.*boolean/);
});

test("document tables keep declared columns and reject invalid field keys", () => {
  const document = { name: "author", title: "Authors", type: "document" as const, folder: "authors", shared: true, columns: ["photo", "email"], fields: [
    { key: "name", label: "Name", type: "string" as const },
    { key: "photo", label: "Photo", type: "image" as const },
    { key: "email", label: "Email", type: "string" as const },
  ] };
  const schema = { documents: [document], objects: [] };
  expect(parseConfig({ schema }).schema?.documents[0].columns).toEqual(["photo", "email"]);
  for (const columns of ["email", [null], ["missing"]]) expect(() => parseConfig({ schema: { ...schema, documents: [{ ...document, columns } as never] } })).toThrow(/columns/);
});

test("jsonOutput defaults to pretty and only accepts declared formats", () => {
  expect(parseConfig({ jsonOutput: undefined }).jsonOutput).toBe("pretty");
  for (const jsonOutput of ["pretty", "minified"] as const) expect(parseConfig({ jsonOutput }).jsonOutput).toBe(jsonOutput);
  for (const jsonOutput of ["compact", "", "Pretty", null, false, 2, {}, ["pretty"]]) {
    expect(() => parseConfig({ jsonOutput } as never)).toThrow(/jsonOutput/);
  }
});

test("respects overrides", () => {
  expect(parseConfig({ copyDir: "content", backend: "local" }).copyDir).toBe("content");
});

test("github backend requires repo", () => {
  expect(() => parseConfig({ backend: "github" })).toThrow(/repo/);
});

test("github backend defaults branch to drafts", () => {
  expect(parseConfig({ backend: "github", repo: "a/b" }).branch).toBe("drafts");
});

test("github defaults are public, safe and use a separate workspace branch", () => {
  expect(parseConfig({ backend: "github", repo: "a/b" })).toMatchObject({ authOrigin: "https://auth.rigelcms.dev", appSlug: "rigel-cms", repoRoot: "", publishBranch: "main", branch: "drafts" });
  for (const options of [
    { repo: "a/b/c" }, { repo: "https://github.com/a/b" }, { repo: "a/.." },
    { repoRoot: "../site" }, { repoRoot: "/site" }, { repoRoot: "site\\content" },
    { copyDir: "/private/content" }, { collections: [{ name: "blog", folder: "../blog", fields: [] }] },
    { authOrigin: "https://auth.example/path" }, { authOrigin: "http://auth.example" }, { authOrigin: "https://user@auth.example" },
    { appSlug: "../bad" }, { branch: "main" }, { branch: "" }, { publishBranch: "bad..branch" },
  ]) expect(() => parseConfig({ backend: "github", repo: "a/b", ...options })).toThrow();
  expect(parseConfig({ backend: "github", repo: "a/b", repoRoot: "sites/web", authOrigin: "http://localhost:8787" }).repoRoot).toBe("sites/web");
});

test("explicit branch wins over the drafts default", () => {
  expect(parseConfig({ backend: "github", repo: "a/b", branch: "staging" }).branch).toBe("staging");
});

test("reference fields accept fixed arrays and reject ambiguous config", () => {
  const field = { key: "author", label: "Author", type: "reference" as const, options: [{ value: "alex", label: "Alex" }] };
  expect(parseConfig({ collections: [{ name: "blog", folder: "blog", fields: [field] }] }).collections?.[0].fields[0]).toEqual(field);
  for (const invalid of [{ ...field, multiple: "yes" }, { ...field, to: "author" }, { ...field, options: undefined }, { ...field, options: [field.options[0], field.options[0]] }, { ...field, options: undefined, to: "unknown" }]) {
    expect(() => parseConfig({ collections: [{ name: "blog", folder: "blog", fields: [invalid as never] }] })).toThrow(/reference|multiple/);
  }
});
