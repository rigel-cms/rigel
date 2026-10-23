import { readFileSync, readdirSync, statSync } from "node:fs";
import { expect, test } from "vitest";
import { SIDEBAR_ICONS } from "../../manifest/navigation";

const folder = new URL("../assets/sidebar/", import.meta.url);

test("the sidebar uses a small, licensed local SVG set matching its allowed names", () => {
  const files = readdirSync(folder).filter(name => name.endsWith(".svg"));
  expect(files.sort()).toEqual(SIDEBAR_ICONS.map(name => `${name}.svg`).sort());
  let bytes = 0;
  for (const file of files) {
    const url = new URL(file, folder);
    const svg = readFileSync(url, "utf8");
    expect(svg).toContain('viewBox="0 0 256 256"');
    expect(svg).not.toMatch(/<script|<foreignObject|\son\w+=|\shref=/i);
    bytes += statSync(url).size;
  }
  expect(bytes).toBeLessThan(32 * 1024);
  expect(readFileSync(new URL("LICENSE", folder), "utf8")).toContain("MIT License");
});
