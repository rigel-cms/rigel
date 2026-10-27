import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "svelte/compiler";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(file => /\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts"));
const catalogs = import.meta.glob<Record<string, string>>("./en/*.json", { eager: true, import: "default" });
const messages = Object.assign({}, ...Object.values(catalogs)) as Record<string, string>;
const translations = import.meta.glob<Record<string, string>>(["./ru/*.json", "./es/*.json", "./fr/*.json", "./zh/*.json", "./ja/*.json", "./it/*.json", "./de/*.json", "./nl/*.json"], { eager: true, import: "default" });

function walk(value: unknown, visit: (node: Record<string, unknown>) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) { for (const item of value) walk(item, visit); return; }
  const node = value as Record<string, unknown>;
  if (node.type === "Attribute" && !["aria-label", "aria-description", "title", "alt", "placeholder", "data-tooltip"].includes(String(node.name))) return;
  visit(value as Record<string, unknown>);
  for (const item of Object.values(value)) walk(item, visit);
}

describe("Editor catalog coverage", () => {
  it.each(["ru", "es", "fr", "zh", "ja", "it", "de", "nl"])("covers every English message in %s with matching interpolation parameters", language => {
    const placeholders = (value: string) => [...value.matchAll(/\{([a-zA-Z][\w]*)\}/g)].map(match => match[1]).sort();
    for (const [file, english] of Object.entries(catalogs)) {
      const translated = translations[file.replace("/en/", `/${language}/`)];
      expect(translated, file).toBeDefined();
      for (const [key, value] of Object.entries(english)) {
        expect(typeof translated?.[key] === "string" && translated[key].trim().length > 0, key).toBe(true);
        expect(placeholders(translated[key]), key).toEqual(placeholders(value));
      }
      for (const [key, value] of Object.entries(translated)) {
        const source = english[key] ?? english[key.replace(/\.(zero|two|few|many)$/, ".other")];
        expect(source, key).toBeDefined();
        expect(placeholders(value), key).toEqual(placeholders(source));
      }
    }
  });

  it("keeps nonempty namespaced keys unique across all English files", () => {
    const keys = new Set<string>();
    for (const [file, catalog] of Object.entries(catalogs)) {
      const namespace = path.basename(file, ".json");
      for (const [key, value] of Object.entries(catalog)) {
        expect(key.startsWith(namespace + "."), key).toBe(true);
        expect(keys.has(key), key).toBe(false);
        expect(typeof value === "string" && value.trim().length > 0, key).toBe(true);
        keys.add(key);
      }
    }
  });

  it("resolves every statically referenced translation key", () => {
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(path.join(root, file), "utf8");
      for (const match of source.matchAll(/(?:\$t|translate|systemMessage|message)\(\s*["']((?:shell|media|fields|richtext|connection|system|validation|local|defaults)\.[^"']+)["']/g)) {
        if (!(match[1] in messages) && !(`${match[1]}.other` in messages)) missing.push(`${file}: ${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("keeps literal English template text and accessibility labels in catalogs", () => {
    const allowed = /^(Rigel|CMS|Rigel CMS|GitHub|Pexels|Pixabay|Unsplash|YouTube|Vimeo|English|Español|Русский|Français|Italiano|https:\/\/…)$/;
    const remaining: string[] = [];
    for (const file of files.filter(file => file.endsWith(".svelte"))) {
      const source = readFileSync(path.join(root, file), "utf8");
      const ast = parse(source, { modern: true });
      walk(ast.fragment, node => {
        if (node.type === "Text" && typeof node.data === "string") {
          const text = node.data.trim();
          if (/[A-Za-z]{2}/.test(text) && !allowed.test(text)) remaining.push(`${file}: ${text}`);
        }
      });
    }
    expect(remaining).toEqual([]);
  });
});
