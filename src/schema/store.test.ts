import { afterEach, beforeEach, expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { readDocuments, writeDocument, DocumentStoreError } from "./store";
import { validateSchema } from "./validate";
import type { Schema } from "./types";

const schema: Schema = validateSchema({
  documents: [
    {
      name: "page", title: "Pages", type: "document", folder: "content/pages",
      fields: [
        { key: "title", label: "Title", type: "string", required: true },
        { key: "sections", label: "Sections", type: "array", items: [{ type: "object", name: "hero" }] },
      ],
    },
    {
      name: "logoSet", title: "Logo sets", type: "document", folder: "content/shared", shared: true,
      fields: [{ key: "title", label: "Title", type: "string", required: true }],
    },
  ],
  objects: [{ name: "hero", title: "Hero", type: "section", fields: [{ key: "heading", label: "Heading", type: "string" }] }],
});

let root: string;

beforeEach(async () => {
  await mkdir("_temp", { recursive: true });
  root = await mkdtemp(path.resolve("_temp/schema-store-"));
  await mkdir(path.join(root, "content/pages"), { recursive: true });
  await mkdir(path.join(root, "content/shared"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const home = { _id: "page:home", _type: "page", slug: "home", title: "Home", sections: [{ _key: "k1", _type: "hero", heading: "Hi" }] };

test("writes, reads and sorts documents from declared folders", async () => {
  await writeDocument(schema, root, "page", "home", home, "create");
  await writeDocument(schema, root, "logoSet", "brands", { _id: "logoSet:brands", _type: "logoSet", title: "Brands" }, "create");
  const documents = await readDocuments(schema, root);
  expect(documents.map((doc) => doc.id)).toEqual(["page:home", "logoSet:brands"]);
  expect(documents.find((doc) => doc.id === "page:home")?.data).toEqual(home);
  expect(JSON.parse(await readFile(path.join(root, "content/pages/home.json"), "utf8"))).toEqual(home);
  expect((await readdir(path.join(root, "content/pages")))).toEqual(["home.json"]);
});

test("create refuses an existing file and update refuses a missing one", async () => {
  await writeDocument(schema, root, "page", "home", home, "create");
  await expect(writeDocument(schema, root, "page", "home", home, "create")).rejects.toThrow(/already exists/);
  await expect(writeDocument(schema, root, "page", "missing", home, "update")).rejects.toThrow(/No such document/);
  const updated = { ...home, title: "Homepage" };
  await writeDocument(schema, root, "page", "home", updated, "update");
  expect((await readDocuments(schema, root))[0].data.title).toBe("Homepage");
});

test("rejects unsafe slugs, symlinked files and oversized documents", async () => {
  await expect(writeDocument(schema, root, "page", "../escape", home, "create")).rejects.toThrow(DocumentStoreError);
  const target = path.join(root, "outside.json");
  await writeFile(target, JSON.stringify(home));
  await symlink(target, path.join(root, "content/pages/linked.json"));
  await expect(readDocuments(schema, root)).rejects.toThrow(/regular file/);
  const huge = { ...home, title: "x".repeat(1024 * 1024) };
  await expect(writeDocument(schema, root, "page", "huge", huge, "create")).rejects.toThrow(/1 MiB/);
});

test("read boundary rejects duplicate effective URL slugs and invalid stored metadata", async () => {
  await writeFile(path.join(root, "content/pages/one.json"), JSON.stringify({ title: "One", slug: "two" }));
  await writeFile(path.join(root, "content/pages/two.json"), JSON.stringify({ title: "Two" }));
  await expect(readDocuments(schema, root)).rejects.toThrow(/already used/);
  await rm(path.join(root, "content/pages/two.json"));
  await writeFile(path.join(root, "content/pages/one.json"), JSON.stringify({ title: "One", slug: "!!!" }));
  await expect(readDocuments(schema, root)).rejects.toThrow(/slug/);
});

test("surfaces invalid stored JSON and wrong types instead of silently dropping them", async () => {
  const broken = path.join(root, "content/pages/broken.json");
  await writeFile(broken, "{");
  await expect(readDocuments(schema, root)).rejects.toThrow();
  await rm(broken);
  await writeFile(path.join(root, "content/pages/wrong.json"), JSON.stringify({ _type: "logoSet" }));
  await expect(readDocuments(schema, root)).rejects.toThrow(/_type must be page/);
});

test("creates a declared folder that does not exist yet", async () => {
  const fresh: Schema = validateSchema({
    documents: [{ name: "page", title: "Pages", type: "document", folder: "content/fresh/deep", fields: [{ key: "title", label: "Title", type: "string" }] }],
    objects: [],
  });
  const document = { _id: "page:first", _type: "page", title: "First" };
  await writeDocument(fresh, root, "page", "first", document, "create");
  expect((await readDocuments(fresh, root))[0].data).toEqual(document);
});

test("accepts a document with an explicit empty sections array and no template residue", async () => {
  const empty = { _id: "page:bare", _type: "page", slug: "bare", title: "Bare", sections: [] };
  await writeDocument(schema, root, "page", "bare", empty, "create");
  expect((await readDocuments(schema, root))[0].data).toEqual(empty);
});

test("creation policy rejects additions but permits editing declared entries", async () => {
  await writeDocument(schema, root, "page", "home", home, "create");
  const fixed: Schema = { ...schema, documents: schema.documents.map(type => ({ ...type, creatable: false })) };
  await expect(writeDocument(fixed, root, "page", "extra", home, "create")).rejects.toMatchObject({ status: 403 });
  await writeDocument(fixed, root, "page", "home", { ...home, title: "Edited" }, "update");
  expect((await readDocuments(fixed, root))[0].data.title).toBe("Edited");
});

test("concurrent different document identities cannot claim the same URL slug", async () => {
  const results = await Promise.allSettled(["one", "two"].map(slug => writeDocument(schema, root, "page", slug, { title: "Race", slug: "shared-url" }, "create")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
});

test("concurrent creates cannot overwrite an author or another new document", async () => {
  const results = await Promise.allSettled(["One", "Two"].map(title => writeDocument(schema, root, "page", "home", { ...home, title }, "create")));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  expect(["One", "Two"]).toContain((await readDocuments(schema, root))[0].data.title);
});
