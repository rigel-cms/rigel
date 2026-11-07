import { afterEach, describe, expect, it, vi } from "vitest";
import { availableUpdate, checkUpdate, dismissUpdate, isUpdateDismissed, installedVersion, registryUrl, releaseNotesUrl } from "./updates";
import { version } from "../../../package.json";

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  return values;
}
const metadata = (version: unknown = "2.0.0", name = "@rigel-cms/rigel") => new Response(JSON.stringify({ name, version }));

it("embeds the package's own installed version and fixed public URLs", () => {
  expect(installedVersion).toBe(version);
  expect(releaseNotesUrl).toBe("https://github.com/rigel-cms/rigel/releases");
  expect(registryUrl).toBe("https://registry.npmjs.org/@rigel-cms%2frigel/latest");
});

it("checks public metadata without credentials or referrer and caches by installed version", async () => {
  storage(); const fetcher = vi.fn(() => Promise.resolve(metadata())); vi.stubGlobal("fetch", fetcher);
  expect(await checkUpdate("1.5.0")).toBe("2.0.0");
  expect(await checkUpdate("1.5.0")).toBe("2.0.0");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([registryUrl, expect.objectContaining({ credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: expect.any(AbortSignal) })]);
  expect(await checkUpdate("2.0.0")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([null, [], {}, { name: "other", version: "2.0.0" }, { name: "@rigel-cms/rigel", version: "2.0.0-rc.1" }, { name: "@rigel-cms/rigel", version: 2 }, { name: "@rigel-cms/rigel", version: "<script>" }])("quietly caches invalid metadata %j", async data => {
  storage(); const fetcher = vi.fn(async () => new Response(JSON.stringify(data))); vi.stubGlobal("fetch", fetcher);
  expect(await checkUpdate("1.0.0")).toBeNull(); expect(await checkUpdate("1.0.0")).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["network", "http", "json"])("caches %s failures", async mode => {
  storage(); const fetcher = vi.fn(async () => { if (mode === "network") throw Error(); return new Response(mode === "json" ? "not json" : "{}", { status: mode === "http" ? 503 : 200 }); }); vi.stubGlobal("fetch", fetcher);
  expect(await checkUpdate("1.0.0")).toBeNull(); expect(await checkUpdate("1.0.0")).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([true, false])("expires the cache after 24 hours (success: %s)", async success => {
  vi.useFakeTimers(); storage(); const fetcher = vi.fn(async () => success ? metadata() : new Response("", { status: 503 })); vi.stubGlobal("fetch", fetcher);
  try {
    expect(await checkUpdate("1.0.0")).toBe(success ? "2.0.0" : null);
    await vi.advanceTimersByTimeAsync(86_399_999); await checkUpdate("1.0.0"); expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await checkUpdate("1.0.0"); expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it.each(["{", "null", "[]", JSON.stringify({ checkedAt: Date.now() + 86_400_000, latest: "2.0.0" }), JSON.stringify({ checkedAt: Date.now(), latest: "bad" }), JSON.stringify({ checkedAt: 0, latest: "2.0.0" })])("ignores corrupt, future or stale cache %s", async cache => {
  const values = storage(); values.set("rigelcms.updates.1.0.0", cache);
  const fetcher = vi.fn(async () => metadata()); vi.stubGlobal("fetch", fetcher);
  expect(await checkUpdate("1.0.0")).toBe("2.0.0"); expect(fetcher).toHaveBeenCalledTimes(1);
});

it("survives disabled and quota-limited browser storage", async () => {
  vi.stubGlobal("localStorage", { getItem() { throw Error(); }, setItem() { throw Error(); } }); vi.stubGlobal("fetch", vi.fn(async () => metadata()));
  expect(await checkUpdate("1.0.0")).toBe("2.0.0"); expect(() => dismissUpdate("2.0.0")).not.toThrow(); expect(isUpdateDismissed("2.0.0")).toBe(false);
});

it("dismisses only the target version", () => {
  storage(); dismissUpdate("2.0.0"); expect(isUpdateDismissed("2.0.0")).toBe(true); expect(isUpdateDismissed("2.0.1")).toBe(false);
});

it("aborts after a bounded timeout and caches the failure", async () => {
  vi.useFakeTimers(); storage(); let signal: AbortSignal;
  const fetcher = vi.fn((_url, options) => { signal = options.signal; return new Promise<Response>(() => {}); }); vi.stubGlobal("fetch", fetcher);
  try {
    const pending = checkUpdate("1.0.0"); await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeNull(); expect(signal!.aborted).toBe(true);
    expect(await checkUpdate("1.0.0")).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { vi.useRealTimers(); }
});

it("ignores late results after unmount abort without caching a failed attempt", async () => {
  const values = storage(); let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const controller = new AbortController(); const pending = checkUpdate("1.0.0", controller.signal); controller.abort();
  expect(await pending).toBeNull(); resolve(metadata()); await Promise.resolve(); expect(values.size).toBe(0);
  expect(await checkUpdate("1.0.0", controller.signal)).toBeNull(); expect(fetch).toHaveBeenCalledTimes(1);
});

afterEach(() => vi.unstubAllGlobals());

describe("stable update precedence", () => {
  it.each([
    ["1.4.0", "1.5.0", true], ["1.5.0", "1.5.0", false], ["1.5.0", "1.4.0", false],
    ["1.5.0-rc.4", "1.4.0", false], ["1.5.0-rc.4", "1.5.0", true],
    ["1.5.0+build.2", "1.5.0+build.3", false], ["1.5.0-rc.4+build", "1.5.0+build", true],
    ["1.9.0", "1.10.0", true], ["1.5.0", "2.0.0-rc.1", false],
    ["01.5.0", "2.0.0", false], ["1.5.0-01", "2.0.0", false],
    ["1.5.0", "2.0.0\n", false], ["1.5.0", "v2.0.0", false], ["1.5.0", "2.0", false],
    ["1.5.0", "2.0.0<script>", false], ["1.5.0", "999999999999999999999.0.0", true],
  ])("%s → %s: %s", (current, latest, expected) => {
    expect(availableUpdate(current, latest)).toBe(expected);
  });
});
