import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { rigelManifestPlugin } from "./manifest-plugin";
import type { ContentLocalesConfig, RigelConfig } from "../config";
import type { Manifest } from "../manifest/types";
import { contentForLocale } from "../manifest/content-locales";

const contentLocales: ContentLocalesConfig = { defaultLocale: "en", locales: [{ code: "en", label: "English" }, { code: "fr", label: "Français" }] };

test("generated local and GitHub manifests transport identical content metadata and validate copy annotations", async () => {
  await mkdir("_temp", { recursive: true });
  const directory = await mkdtemp(path.resolve("_temp/content-locales-"));
  try {
    for (const folder of ["copy", "pages", "blog"]) await mkdir(path.join(directory, folder));
    await writeFile(path.join(directory, "copy/contact.ts"), 'export default { slug: "contact", label: "Contact", locale: "fr", groups: [], values: {} };');
    await writeFile(path.join(directory, "pages/home.json"), '{"title":"Home"}');
    await writeFile(path.join(directory, "entry.js"), 'export { default } from "virtual:rigel-manifest";');
    const cfg: RigelConfig = { copyDir: "copy", backend: "local", contentLocales, collections: [{ name: "blog", folder: "blog", locale: "fr", fields: [] }], schema: { objects: [], documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", locale: "en", fields: [{ key: "title", label: "Title", type: "string" }] }] } };
    const bundle = async (config: RigelConfig): Promise<Manifest> => {
      const result = await build({ configFile: false, root: directory, logLevel: "silent", plugins: [rigelManifestPlugin(config, undefined, pathToFileURL(directory + path.sep))], build: { write: false, minify: false, lib: { entry: path.join(directory, "entry.js"), formats: ["es"] } } });
      const output = Array.isArray(result) ? result[0].output : "output" in result ? result.output : [];
      const code = output.flatMap(file => file.type === "chunk" ? [file.code] : []).join("\n");
      return (await import("data:text/javascript," + encodeURIComponent(code))).default;
    };
    const local = await bundle(cfg), github = await bundle({ ...cfg, backend: "github", repo: "owner/site" });
    expect(local.contentLocales).toEqual(contentLocales);
    expect(local.pages[0].locale).toBe("fr");
    expect(local.collections![0].locale).toBe("fr");
    expect(local.schema!.documents[0].locale).toBe("en");
    expect(github).toMatchObject(local);
    expect(contentForLocale(local, "fr").documents).toEqual([]);
    expect(contentForLocale(local, "en").pages).toEqual([]);
    const disabled = await bundle({ ...cfg, contentLocales: undefined });
    expect(disabled).not.toHaveProperty("contentLocales");
    expect(contentForLocale(disabled, "en")).toBe(disabled);
    await writeFile(path.join(directory, "copy/contact.ts"), 'export default { slug: "contact", label: "Contact", locale: "de", groups: [], values: {} };');
    await expect(bundle(cfg)).rejects.toThrow(/unknown content locale de/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
