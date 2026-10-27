import { afterEach, expect, test, vi } from "vitest";
import { get } from "svelte/store";

vi.mock("virtual:rigel-i18n", async () => ({ default: {
  en: { ...(await import("./en/shell.json")).default, ...(await import("./en/local.json")).default },
  es: { ...(await import("./es/shell.json")).default, ...(await import("./es/local.json")).default },
} }));

import { availableLocales, locale, setLocale, translate } from "./index";
import { requestTranslator } from "./server";
import { getSettings, setSettings } from "../lib/settings";
import spanish from "./es/local.json";

afterEach(() => { setLocale("en"); vi.unstubAllGlobals(); });

test("only configured languages activate in the editor and request translator", () => {
  expect(availableLocales).toEqual(["en", "es"]);
  setLocale("es-ES");
  expect(get(locale)).toBe("es");
  expect(translate("shell.save")).toBe("Guardar");
  setLocale("fr-FR");
  expect(get(locale)).toBe("en");
  expect(translate("shell.save")).toBe("Save");
  const request = (language: string) => new Request("http://localhost/", { headers: { "Accept-Language": language } });
  expect(requestTranslator(request("fr;q=1, es;q=0.5"))("local.unsupportedMedia")).toBe(spanish["local.unsupportedMedia"]);
  expect(requestTranslator(request("fr"))("local.unsupportedMedia")).toBe("Unsupported or mismatched media type/filename");
});

test("saved excluded languages reset to English; selected languages persist", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
  expect(getSettings().language).toBe("en");
  values.set("rigelcms.settings", JSON.stringify({ language: "fr" }));
  expect(getSettings().language).toBe("en");
  setSettings({ language: "es" });
  expect(getSettings().language).toBe("es");
  expect(get(locale)).toBe("es");
});
