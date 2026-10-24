import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getSettings, setSettings } from "./settings";
import { getKeys, setKeys } from "./images";
import { eraseData, readSession, writeSession, clearSession } from "./storage";

const config = { authOrigin: "https://auth.example", repo: "owner/site", branch: "drafts", appSlug: "rigel" };

test("persists only the scoped access token and original expiry across reads", () => {
  vi.useFakeTimers();
  try {
    const session = { accessToken: "ghu_fixture", expiresAt: Date.now() + 3600000 };
    writeSession(config, { ...session, refreshToken: "never-store", user: "not-trusted" } as typeof session);
    expect(readSession(config)).toEqual(session);
    vi.advanceTimersByTime(60000);
    expect(readSession(config)).toEqual(session);
    expect([...entries.values()].join()).not.toMatch(/never-store|not-trusted/);
    clearSession();
    expect(readSession(config)).toBeNull();
  } finally { vi.useRealTimers(); }
});

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

test("article editing experience defaults to inline and preserves an explicit sidebar preference", () => {
  expect(getSettings().userPref.editorExperience).toBe("inline");
  setSettings({ userPref: { ...getSettings().userPref, editorExperience: "sidebar" } });
  setSettings({ theme: "dark" });
  expect(getSettings().userPref.editorExperience).toBe("sidebar");
  for (const editorExperience of [undefined, null, true, "unknown", "inline"]) {
    entries.set("rigelcms.settings", JSON.stringify({ userPref: { editorExperience } }));
    expect(getSettings().userPref.editorExperience).toBe("inline");
  }
  entries.set("rigelcms.settings", "broken JSON");
  expect(getSettings().userPref.editorExperience).toBe("inline");
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
    userPref: { previewSplit: 0.5, mediaView: "grid", sidebarCollapsed: false, editorExperience: "inline" },
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

test.each([
  ["expired", { expiresAt: Date.now() - 1 }],
  ["near expiry", { expiresAt: Date.now() + 10000 }],
  ["unbounded expiry", { expiresAt: Date.now() + 90000000 }],
  ["wrong token", { accessToken: "ghs_not_a_user_token" }],
  ["wrong version", { version: 2 }],
  ["wrong scope", { scope: "other" }],
  ["string expiry", { expiresAt: "3600" }],
])("%s stored session is discarded", (_label, changes) => {
  writeSession(config, { accessToken: "ghu_fixture", expiresAt: Date.now() + 3600000 });
  entries.set("rigelcms.session", JSON.stringify({ ...JSON.parse(entries.get("rigelcms.session")!), ...changes }));
  expect(readSession(config)).toBeNull();
  expect(entries.has("rigelcms.session")).toBe(false);
});

test.each(["authOrigin", "repo", "branch", "appSlug"] as const)("session cannot cross a changed %s", key => {
  writeSession(config, { accessToken: "ghu_fixture", expiresAt: Date.now() + 3600000 });
  expect(readSession({ ...config, [key]: "different" })).toBeNull();
  expect(entries.has("rigelcms.session")).toBe(false);
});

test("session restore never falls back to an obsolete storage key after signout", () => {
  writeSession(config, { accessToken: "ghu_fixture", expiresAt: Date.now() + 3600000 });
  entries.set("rigel.session", entries.get("rigelcms.session")!);
  clearSession();
  expect(readSession(config)).toBeNull();
});

test("malformed storage and blocked storage never prevent memory-only login", () => {
  entries.set("rigelcms.session", "{");
  expect(readSession(config)).toBeNull();
  expect(entries.size).toBe(0);
  for (const method of ["getItem", "setItem", "removeItem"] as const) localStorage[method] = () => { throw new Error("Blocked"); };
  expect(() => writeSession(config, { accessToken: "ghu_fixture", expiresAt: Date.now() + 3600000 })).not.toThrow();
  expect(readSession(config)).toBeNull();
  expect(() => clearSession()).not.toThrow();
});

test("erase removes only the Rigel namespace and known legacy keys", () => {
  for (const key of ["rigelcms.session", "rigelcms.settings", "rigelcms.keys", "rigelcms.mediaView", "rigelcms.files", "rigel.settings", "rigel.keys", "rigel.user", "site.preferences", "rigelcms-other", "rigel.other"]) entries.set(key, "value");
  eraseData();
  expect([...entries.keys()]).toEqual(["site.preferences", "rigelcms-other", "rigel.other"]);
});