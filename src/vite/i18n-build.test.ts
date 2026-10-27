import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { build } from "vite";
import { rigelManifestPlugin } from "./manifest-plugin";
import type { RigelConfig } from "../config";
import type { Dictionaries } from "../editor/i18n/format";

async function bundle(languages?: RigelConfig["languages"]) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [rigelManifestPlugin({ copyDir: "src/content/copy", backend: "local", languages })],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: "virtual:rigel-i18n", preserveEntrySignatures: "strict", output: { format: "es" } },
    },
  });
  if (!("output" in result)) throw new Error("Expected a single in-memory bundle");
  const chunks = result.output.filter(output => output.type === "chunk");
  expect(chunks).toHaveLength(1);
  const chunk = chunks[0];
  const url = `data:text/javascript,${encodeURIComponent(chunk.code)}`;
  const module = await import(url);
  expect(Object.keys(module)).toEqual(["default"]);
  return { dictionaries: module.default as Dictionaries, modules: Object.keys(chunk.modules) };
}

function expectLanguages(result: Awaited<ReturnType<typeof bundle>>, languages: string[]) {
  expect(Object.keys(result.dictionaries)).toEqual(languages);
  const expectedModules: string[] = [];
  for (const language of languages) {
    const directory = new URL(`../editor/i18n/${language}/`, import.meta.url);
    const catalogs = readdirSync(directory).filter(file => file.endsWith(".json")).sort();
    expect(catalogs).toHaveLength(9);
    const merged: Record<string, string> = {};
    for (const catalog of catalogs) {
      const file = new URL(catalog, directory);
      expectedModules.push(fileURLToPath(file));
      Object.assign(merged, JSON.parse(readFileSync(file, "utf8")));
    }
    expect(result.dictionaries[language]).toEqual(merged);
  }
  const catalogModules = result.modules.filter(id => /\/i18n\/[^/]+\/[^/]+\.json$/.test(id));
  expect(catalogModules.sort()).toEqual(expectedModules.sort());
}

test("default builds contain only the nine English and French catalogs", async () => {
  expectLanguages(await bundle(), ["en", "fr"]);
});

test("Spanish builds contain only English and Spanish catalogs", async () => {
  expectLanguages(await bundle(["es"]), ["en", "es"]);
});

test("empty language lists build English only", async () => {
  expectLanguages(await bundle([]), ["en"]);
});

test("parallel builds keep their language configuration independent", async () => {
  const [french, spanish, english] = await Promise.all([bundle(), bundle(["es"]), bundle([])]);
  expectLanguages(french, ["en", "fr"]);
  expectLanguages(spanish, ["en", "es"]);
  expectLanguages(english, ["en"]);
});
