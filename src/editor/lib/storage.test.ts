import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getSettings, setSettings } from "./settings";
import { getKeys, setKeys } from "./images";
import { eraseData } from "./storage";

let entries: Map<string, string>;
beforeEach(() => {
  entries = new Map();
  vi.stubGlobal("localStorage", {
    get length() { return entries.size; },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

test("sidebar collapse is a validated preference and survives unrelated settings updates", () => {
  expect(getSettings().userPref).toMatchObject({ sidebarCollapsed: false });
  entries.set("rigelcms.settings", JSON.stringify({ userPref: { sidebarCollapsed: true } }));
  expect(getSettings().userPref).toMatchObject({ sidebarCollapsed: true });
  setKeys({ pexels: "test-key" });
  expect(getSettings().userPref).toMatchObject({ sidebarCollapsed: true });
  for (const sidebarCollapsed of ["true", 1, null, {}]) {
    entries.set("rigelcms.settings", JSON.stringify({ userPref: { sidebarCollapsed } }));
    expect(getSettings().userPref).toMatchObject({ sidebarCollapsed: false });
  }
});

test("article editing experience defaults to sidebar and persists without affecting other preferences", () => {
  expect(getSettings().userPref.editorExperience).toBe("sidebar");
  setSettings({ userPref: { ...getSettings().userPref, editorExperience: "inline" } });
  setSettings({ theme: "dark" });
  expect(getSettings().userPref.editorExperience).toBe("inline");
  for (const editorExperience of [null, true, "unknown"]) {
    entries.set("rigelcms.settings", JSON.stringify({ userPref: { editorExperience } }));
    expect(getSettings().userPref.editorExperience).toBe("sidebar");
  }
});

test("preview split validates stored proportions and safely falls back", () => {
  for (const previewSplit of [0.2, 0.5, 0.8]) {
    setSettings({ userPref: { previewSplit, mediaView: "grid" } });
    expect(getSettings().userPref.previewSplit).toBe(previewSplit);
  }
  for (const previewSplit of [-1, 0, 1, "0.6", null, {}, Infinity]) {
    entries.set("rigelcms.settings", JSON.stringify({ userPref: { previewSplit } }));
    expect(getSettings().userPref.previewSplit).toBe(0.5);
  }
  entries.set("rigelcms.settings", "broken JSON");
  expect(getSettings().userPref.previewSplit).toBe(0.5);
  localStorage.getItem = () => { throw new Error("Storage unavailable"); };
  expect(getSettings().userPref.previewSplit).toBe(0.5);
});

test("migrates legacy settings and API keys into one settings store on save", () => {
  entries.set("rigel.settings", JSON.stringify({ theme: "dark", devMode: true }));
  entries.set("rigel.user", "Legacy name");
  entries.set("rigel.keys", JSON.stringify({ pixabay: "test-key" }));
  setSettings(getSettings());
  setKeys(getKeys());
  expect(JSON.parse(entries.get("rigelcms.settings")!)).toEqual({
    theme: "dark", language: "en", devMode: true, highContrast: false,
    apiKeys: { pixabay: "test-key" },
    userPref: { previewSplit: 0.5, mediaView: "grid", sidebarCollapsed: false, editorExperience: "sidebar" },
  });
  expect([...entries.keys()].sort()).toEqual(["rigelcms.settings"]);
});

test("keeps keys inside settings without clobbering preferences", () => {
  setSettings({ userPref: { previewSplit: 0.3, mediaView: "list" } });
  setKeys({ pexels: "test-key" });
  expect(getSettings().userPref.previewSplit).toBe(0.3);
  expect(getSettings().userPref.mediaView).toBe("list");
  setSettings({ theme: "dark" });
  expect(getKeys().pexels).toBe("test-key");
  expect(getSettings().userPref.mediaView).toBe("list");
});

test("prefers current settings and drops obsolete display names", () => {
  entries.set("rigel.settings", JSON.stringify({ theme: "dark", userName: "Old" }));
  entries.set("rigelcms.settings", JSON.stringify({ theme: "light", userName: "" }));
  expect(getSettings()).toMatchObject({ theme: "light", language: "en", devMode: false, highContrast: false });
});

test("failed migration keeps legacy values", () => {
  entries.set("rigel.keys", JSON.stringify({ pexels: "test-key" }));
  localStorage.setItem = () => { throw new Error("Storage unavailable"); };
  expect(() => setKeys(getKeys())).toThrow("Storage unavailable");
  expect(entries.has("rigel.keys")).toBe(true);
});

test("erase removes only the Rigel namespace and known legacy keys", () => {
  for (const key of ["rigelcms.settings", "rigelcms.keys", "rigelcms.mediaView", "rigelcms.files", "rigel.settings", "rigel.keys", "rigel.user", "site.preferences", "rigelcms-other", "rigel.other"]) entries.set(key, "value");
  eraseData();
  expect([...entries.keys()]).toEqual(["site.preferences", "rigelcms-other", "rigel.other"]);
});