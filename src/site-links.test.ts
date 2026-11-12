import { expect, test } from "vitest";
import { parseConfig, type RigelConfig } from "./config";
import { rigelManifestPlugin } from "./vite/manifest-plugin";

test("site links preserve ordered replacement and explicit disabling in the manifest", () => {
  for (const siteLinks of [[{ label: "Docs", href: "https://example.com/docs?q=help#start" }, { label: "Home", href: "/" }], []]) {
    const config = parseConfig({ siteLinks } as Partial<RigelConfig>);
    expect((config as typeof config & { siteLinks: unknown }).siteLinks).toEqual(siteLinks);
    const plugin = rigelManifestPlugin(config) as unknown as { load(id: string): string };
    expect(plugin.load("\0virtual:rigel-manifest")).toContain("siteLinks: " + JSON.stringify(siteLinks));
  }
});

test("site links reject malformed entries and unsafe destinations", () => {
  for (const siteLinks of [null, {}, [null], [{ label: "", href: "/" }], [{ label: "Docs", href: 1 }], ...["javascript:alert(1)", "data:text/html,bad", "//evil.test", "/\\evil.test", "https://user:pass@example.com", "http://example.com", "https:example.com", " https://example.com", "/\nevil", "mailto:user@example.com"].map(href => [{ label: "Link", href }])]) {
    expect(() => parseConfig({ siteLinks } as Partial<RigelConfig>)).toThrow(/siteLinks/);
  }
});

test("site links allow relative and HTTPS destinations plus loopback HTTP without mutating caller links", () => {
  for (const href of ["/", "/docs?topic=cms#start", "./docs", "../docs", "docs/start", "#help", "https://example.com/path", "http://localhost:4321/", "http://127.0.0.1:4321/", "http://[::1]:4321/"]) {
    const siteLinks = [{ label: "Docs", href }];
    const config = parseConfig({ siteLinks } as Partial<RigelConfig>) as RigelConfig & { siteLinks: typeof siteLinks };
    expect(config.siteLinks).toEqual(siteLinks);
    expect(config.siteLinks).not.toBe(siteLinks);
    expect(config.siteLinks[0]).not.toBe(siteLinks[0]);
  }
  expect((parseConfig() as RigelConfig & { siteLinks?: unknown }).siteLinks).toBeUndefined();
});
