import { expect, test, vi } from "vitest";
import type { APIContext } from "astro";
import frenchMessages from "../editor/i18n/fr/local.json" with { type: "json" };
import germanMessages from "../editor/i18n/de/local.json" with { type: "json" };
import dutchMessages from "../editor/i18n/nl/local.json" with { type: "json" };

vi.mock("virtual:rigel-config", () => ({ default: {} }));

const { requestTranslator } = await import("../editor/i18n/server");
const { POST } = await import("./local-media");
const origin = "http://localhost:4321";
const request = (language: string) => new Request(origin, { method: "POST", headers: { Origin: origin, "Accept-Language": language, "Content-Type": "application/unknown" } });

test("local route uses request language with unchanged error status and text envelope", async () => {
  const [french, english] = await Promise.all(["fr-CA, en;q=0.5", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(french.status).toBe(415);
  expect(await french.text()).toBe(frenchMessages["local.unsupportedMedia"]);
  expect(english.status).toBe(415);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("local route serves the shipped Russian catalog without changing the English request", async () => {
  const [russian, english] = await Promise.all(["ru-RU", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(russian.status).toBe(415);
  expect(await russian.text()).toMatch(/[А-Яа-яЁё]/);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("local route serves the shipped Spanish catalog without changing the English request", async () => {
  const [spanish, english] = await Promise.all(["es-ES", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(spanish.status).toBe(415);
  expect(await spanish.text()).toMatch(/tipo|archivo|formato/i);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("local route serves Simplified Chinese without changing the English request", async () => {
  const [chinese, english] = await Promise.all(["zh-CN", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(chinese.status).toBe(415);
  expect(await chinese.text()).toMatch(/[\u4e00-\u9fff]/);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("local route serves Japanese without changing the English request", async () => {
  const [japanese, english] = await Promise.all(["ja-JP", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(japanese.status).toBe(415);
  expect(await japanese.text()).toMatch(/[\u3040-\u30ff]/);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("local route serves Italian without changing the English request", async () => {
  const [italian, english] = await Promise.all(["it-IT", "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(italian.status).toBe(415);
  expect(await italian.text()).toMatch(/tipo|file|formato/i);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test.each([
  ["de-DE", germanMessages],
  ["nl-NL", dutchMessages],
] as const)("local route serves %s without changing the English request", async (language, messages) => {
  const [localized, english] = await Promise.all([language, "en"].map(language => POST({ request: request(language) } as APIContext)));
  expect(localized.status).toBe(415);
  expect(await localized.text()).toBe(messages["local.unsupportedMedia"]);
  expect(english.status).toBe(415);
  expect(await english.text()).toBe("Unsupported or mismatched media type/filename");
});

test("request locale negotiation is strict, weighted and isolated", () => {
  const french = requestTranslator(request("en;q=0.2, fr-FR;q=0.9"));
  expect(french("local.mediaTooLarge", { limit: 5 })).toBe(frenchMessages["local.mediaTooLarge"].replace("{limit}", "5"));
  expect(french("local.fileNotFound")).toBe(frenchMessages["local.fileNotFound"]);
  for (const language of ["pt", "french", "fr_FR", "fr;q=0", "fr;q=2", "fr;q=nope", "en;q=1, fr;q=0.5"]) {
    expect(requestTranslator(request(language))("local.unsupportedMedia")).toBe("Unsupported or mismatched media type/filename");
  }
  expect(french("local.unsupportedMedia")).toBe(frenchMessages["local.unsupportedMedia"]);
});
