import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { transpileModule } from "typescript";
import { emptyBody } from "../../article-body";
import { recoveryScope, readRecovery, writeRecovery, removeRecovery, clearRecovery, type RecoveryDraft } from "./draft-recovery";
import type { Manifest } from "../../manifest/types";

const stored = new Map<string, string>();
const storage = { get length() { return stored.size; }, key: (index: number) => [...stored.keys()][index], getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); }, removeItem: (key: string) => { stored.delete(key); } };
vi.stubGlobal("localStorage", storage);
afterEach(() => { stored.clear(); vi.restoreAllMocks(); });
const manifest: Manifest = { pages: [], recoveryScope: "local-project", schema: { objects: [], documents: [] } };
const draft = (id = "tab-one"): RecoveryDraft => ({ version: 1, id, scope: "site/account/schema", selection: { kind: "post", collection: "blog", slug: "example" }, locale: "en", values: { title: "Unfinished", draft: true }, body: emptyBody(), base: { values: { title: "Original" }, body: emptyBody() }, creating: false, savedAt: 1 });

test("recovery round trips browser-only values, rich text, creation state and separate tab copies", () => {
  writeRecovery(draft());
  const other = { ...draft("tab-two"), savedAt: Date.now() + 1, creating: true };
  writeRecovery(other);
  expect(readRecovery(draft().scope)).toEqual([other, draft()]);
  removeRecovery("tab-one");
  expect(readRecovery(draft().scope)).toEqual([other]);
  expect(readRecovery("other account")).toEqual([]);
  clearRecovery(draft().scope);
  expect(stored.size).toBe(0);
});

test("scope separates projects, accounts, repository branches, storage and schema without credentials", () => {
  expect(recoveryScope(manifest)).not.toBe(recoveryScope({ ...manifest, recoveryScope: "another-project" }));
  expect(recoveryScope({ pages: [] })).toBeNull();
  const remote: Manifest = { ...manifest, backend: "github", github: { repo: "owner/site", branch: "drafts", publishBranch: "main", repoRoot: "", copyDir: "copy", collections: [], authOrigin: "https://auth.example", appSlug: "rigel" } };
  expect(recoveryScope(remote)).toBeNull();
  const scope = recoveryScope(remote, "alice");
  expect(scope).not.toBe(recoveryScope(remote, "bob"));
  expect(scope).not.toBe(recoveryScope({ ...remote, github: { ...remote.github!, branch: "another" } }, "alice"));
  expect(scope).not.toBe(recoveryScope({ ...remote, schema: { objects: [], documents: [{ name: "page", title: "Pages", folder: "pages", type: "document", fields: [] }] } }, "alice"));
  expect(recoveryScope({ ...manifest, backend: "demo" })).toBeNull();
});

test("malformed, oversized, unsafe and unsupported browser records are never restored", () => {
  const key = "rigelcms.drafts.tab-one";
  for (const value of ["{", "null", JSON.stringify({ ...draft(), version: 2 }), JSON.stringify({ ...draft(), values: { text: "界".repeat(400000) } }), JSON.stringify({ ...draft(), selection: { kind: "media" } }), JSON.stringify({ ...draft(), body: { root: { type: "script" } } }), JSON.stringify({ ...draft(), values: JSON.parse('{"__proto__":{"polluted":true}}') }), " ".repeat(1024 * 1024 + 1)]) {
    stored.set(key, value);
    expect(readRecovery(draft().scope)).toEqual([]);
  }
  expect(() => writeRecovery({ ...draft(), values: { text: "x".repeat(1024 * 1024) } })).toThrow();
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});

test("removing a recovered copy never deletes a newer backup from another tab", () => {
  const original = draft();
  writeRecovery(original);
  const newer = { ...original, savedAt: 2, values: { title: "Other tab kept editing" } };
  writeRecovery(newer);
  removeRecovery(original.id, original);
  expect(readRecovery(original.scope)).toEqual([newer]);
  removeRecovery(newer.id, newer);
  expect(readRecovery(original.scope)).toEqual([]);
});

test.each([false, true])("explicit signout purges recovery before invalidating auth, including publishing=%s", publishBusy => {
  const source = readFileSync(new URL("../App.svelte", import.meta.url), "utf8");
  const start = source.indexOf("  function signOut() {");
  const code = transpileModule(source.slice(start, source.indexOf("\n  }", start) + 4), { compilerOptions: { target: 99 } }).outputText;
  const events = new Function("publishBusy", `
    let saveState = 'idle', connectionBusy = false, userOpen = true, connected = true;
    let connectionError, settingsOpen, shortcutsOpen, searchOpen, newEntry, newDocument, draft, bodyDraft, bodyBase, docBase, dirty, saveError, sel, manifest;
    const blueprint = null, events = [];
    const closePublish = () => {};
    const requestNavigation = action => action();
    const forgetRecovery = broadcast => events.push('purge:' + broadcast);
    const resetToasts = () => events.push('reset-notifications');
    const invalidateSession = () => events.push('invalidate');
    ${code}; signOut(); return events;
  `)(publishBusy);
  expect(events).toEqual(["purge:true", "reset-notifications", "invalidate"]);
});

test("quota and denied storage failures are reported without deleting existing backups", () => {
  writeRecovery(draft());
  vi.spyOn(storage, "setItem").mockImplementation(() => { throw new Error("quota"); });
  expect(() => writeRecovery({ ...draft(), values: { title: "latest" } })).toThrow("quota");
  expect(readRecovery(draft().scope)[0].values.title).toBe("Unfinished");
  vi.spyOn(storage, "getItem").mockImplementation(() => { throw new Error("denied"); });
  expect(() => readRecovery(draft().scope)).toThrow("denied");
});
