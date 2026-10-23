import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { checkGitHubAccess, startGitHubLogin } from "./github-auth";

const target = new EventTarget();
const popup = { closed: false, close: vi.fn() };
const open = vi.fn((_url: string, _name: string, _features: string): typeof popup | null => popup);

beforeEach(() => {
  vi.useFakeTimers();
  popup.closed = false;
  popup.close.mockReset();
  open.mockReset().mockReturnValue(popup);
  vi.stubGlobal("window", { location: { origin: "https://site.example" }, open, addEventListener: target.addEventListener.bind(target), removeEventListener: vi.fn(target.removeEventListener.bind(target)) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function message(data: Record<string, unknown>, origin = "https://auth.rigelcms.dev", source: unknown = popup) {
  const event = new Event("message");
  Object.assign(event, { data, origin, source });
  target.dispatchEvent(event);
}
function payload() {
  const url = new URL(open.mock.calls[0][0] as unknown as string);
  expect(url.origin + url.pathname).toBe("https://auth.rigelcms.dev/authorize");
  expect(url.searchParams.get("origin")).toBe("https://site.example");
  expect(url.searchParams.get("nonce")).toMatch(/^[a-f0-9]{64}$/);
  expect(url.href).not.toContain("access_token");
  return { type: "rigel:auth", provider: "github", nonce: url.searchParams.get("nonce"), access_token: "ghu_test", expires_in: 3600 };
}

test("popup requires exact origin, source, type, provider and random nonce then returns only in-memory credentials", async () => {
  const login = startGitHubLogin("https://auth.rigelcms.dev");
  const data = payload();
  let done = false;
  void login.then(() => { done = true; });
  message(data, "https://evil.example");
  message(data, undefined, {});
  for (const invalid of [{ nonce: "wrong" }, { type: "wrong" }, { provider: "other" }]) message({ ...data, ...invalid });
  await Promise.resolve();
  expect(done).toBe(false);
  const now = Date.now();
  message(data);
  await expect(login).resolves.toEqual({ accessToken: "ghu_test", expiresAt: now + 3600000 });
  expect(popup.close).toHaveBeenCalledOnce();
  expect(window.removeEventListener).toHaveBeenCalledWith("message", expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["blocked", "cancelled", "timeout", "provider", "expiry"])("popup %s cleans up without exposing provider details", async kind => {
  if (kind === "blocked") open.mockReturnValue(null);
  const login = startGitHubLogin("https://auth.rigelcms.dev");
  const assertion = expect(login).rejects.toThrow(/blocked|cancelled|timed out|login failed|invalid or expired/);
  if (kind === "cancelled") { popup.closed = true; await vi.advanceTimersByTimeAsync(250); }
  if (kind === "timeout") await vi.advanceTimersByTimeAsync(120000);
  if (kind === "provider") message({ ...payload(), error: "secret-provider-body" });
  if (kind === "expiry") message({ ...payload(), expires_in: -1 });
  await assertion;
  expect(window.removeEventListener).toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

test.each([
  ["Authorization denied", "GitHub authorization was denied. Sign in again and approve access to continue."],
  ["Token exchange failed", "The auth gateway could not exchange GitHub's authorization code for a token. Repository access has not been checked."],
  ["private provider response ghu_sensitive", "GitHub login failed. Please try signing in again."],
])("popup exposes only the safe diagnostic for %s", async (error, expected) => {
  const login = startGitHubLogin("https://auth.rigelcms.dev");
  message({ ...payload(), error });
  await expect(login).rejects.toThrow(expected);
  expect(popup.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["http://evil.example", "https://user:pass@auth.example", "https://auth.example/path", "https://auth.example?token=bad"])("rejects unsafe gateway %s before opening", async origin => {
  await expect(startGitHubLogin(origin)).rejects.toThrow(/gateway/);
  expect(open).not.toHaveBeenCalled();
});

const user = { login: "editor", avatar_url: "https://avatars.githubusercontent.com/u/1", html_url: "https://github.com/editor" };
const installation = { id: 42, app_slug: "rigel-cms", account: { login: "owner" }, html_url: "https://github.com/organizations/owner/settings/installations/42", permissions: { contents: "write" }, suspended_at: null };
const repository = { id: 7, full_name: "owner/site", default_branch: "main", permissions: { push: true } };

function github(responses: Record<string, unknown>) {
  const fetcher = vi.fn(async (input: string, init: RequestInit) => {
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer ghu_test" });
    const url = new URL(input);
    expect(url.origin).toBe("https://api.github.com");
    const data = responses[url.pathname + url.search] ?? responses[url.pathname];
    if (data === undefined) throw new Error("Unexpected request");
    return new Response(JSON.stringify(data));
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

test("ready requires the intended repository in the correct app's paginated installation listing", async () => {
  const filler = Array.from({ length: 100 }, (_, id) => ({ ...repository, id: id + 100, full_name: "owner/other-" + id }));
  const fetcher = github({
    "/user": user,
    "/user/installations": { installations: [{ ...installation, app_slug: "other-app" }, installation] },
    "/user/installations/42/repositories?per_page=100&page=1": { repositories: filler, total_count: 101 },
    "/user/installations/42/repositories?per_page=100&page=2": { repositories: [repository], total_count: 101 },
  });
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).resolves.toEqual({
    user, status: "ready", installUrl: installation.html_url,
    installation: { id: 42, account: "owner", html_url: installation.html_url }, repository,
  });
  expect(fetcher).toHaveBeenCalledTimes(4);
});

test.each([
  ["  Alex Editor  ", "Alex Editor"],
  [undefined, undefined], [null, undefined], [42, undefined], [false, undefined],
  [{ name: "wrong" }, undefined], [[], undefined], ["", undefined], [" \t\n", undefined],
])("public name %j is optional and safely normalized", async (name, expected) => {
  const fetcher = github({ "/user": { ...user, name }, "/user/installations": { installations: [] } });
  const access = await checkGitHubAccess("ghu_test", "owner/site", "rigel-cms");
  expect(access.user).toEqual(expected ? { ...user, name: expected } : user);
  expect(access.user.name ?? access.user.login).toBe(expected ?? "editor");
  expect(access.status).toBe("installation-required");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("identity alone and unrelated apps never prove installation", async () => {
  const fetcher = github({ "/user": user, "/user/installations": { installations: [{ ...installation, app_slug: "other-app" }] } });
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).resolves.toEqual({ user, status: "installation-required", installUrl: "https://github.com/apps/rigel-cms/installations/new", installation: null, repository: null });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("an existing account installation still requires selecting the intended repository", async () => {
  github({ "/user": user, "/user/installations": { installations: [installation] }, "/user/installations/42/repositories": { repositories: [{ ...repository, full_name: "owner/other" }] } });
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).resolves.toMatchObject({ status: "installation-required", installUrl: installation.html_url, repository: null, installation: { id: 42 } });
});

test.each(["user", "app", "suspended", "missing"])("%s write restriction cannot become ready", async restriction => {
  github({
    "/user": user,
    "/user/installations": { installations: [{ ...installation, permissions: restriction === "app" ? { contents: "read" } : installation.permissions, suspended_at: restriction === "suspended" ? "2026-01-01" : null }] },
    "/user/installations/42/repositories": { repositories: [{ ...repository, permissions: restriction === "user" ? { push: false } : restriction === "missing" ? undefined : repository.permissions }] },
  });
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).resolves.toMatchObject({ status: "read-only", repository: { id: 7 } });
});

test("installation listing is paginated and untrusted configuration URLs are discarded", async () => {
  github({
    "/user": user,
    "/user/installations?per_page=100&page=1": { installations: Array.from({ length: 100 }, (_, id) => ({ ...installation, id: id + 100, app_slug: "other" })), total_count: 101 },
    "/user/installations?per_page=100&page=2": { installations: [{ ...installation, html_url: "https://github.com.evil.example/settings/installations/42" }], total_count: 101 },
    "/user/installations/42/repositories": { repositories: [repository] },
  });
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).resolves.toMatchObject({ status: "ready", installUrl: "https://github.com/apps/rigel-cms/installations/new" });
});

test.each([
  [401, {}, /sign in again/], [403, {}, /permissions.*organization approval/], [404, {}, /installation/],
  [429, {}, /rate limit/], [403, { "x-ratelimit-remaining": "0" }, /rate limit/], [403, { "retry-after": "60" }, /rate limit/], [500, {}, /try again later/],
] as const)("HTTP %s returns only actionable generic errors", async (status, headers, expected) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider body ghu_test", { status, headers })));
  const error = await checkGitHubAccess("ghu_test", "owner/site", "rigel-cms").catch((error: unknown) => error as Error);
  expect(error).toBeInstanceOf(Error);
  if (!(error instanceof Error)) throw new Error("Expected GitHub access error");
  expect(error.message).toMatch(expected);
  expect(error.message).not.toMatch(/private|ghu_test|provider body/);
});

test("network errors cannot leak fetch exception bodies", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ghu_test secret"); }));
  await expect(checkGitHubAccess("ghu_test", "owner/site", "rigel-cms")).rejects.toThrow("Unable to reach GitHub. Check your connection and try again.");
});

test.each([0, null, "3600", Infinity, 86401, 1.5])("rejects malformed popup expiry %s", async expires_in => {
  const login = startGitHubLogin("https://auth.rigelcms.dev");
  message({ ...payload(), expires_in });
  await expect(login).rejects.toThrow(/invalid or expired/);
  expect(vi.getTimerCount()).toBe(0);
});

test("each login uses a fresh nonce and old credentials cannot finish a new login", async () => {
  const first = startGitHubLogin("https://auth.rigelcms.dev");
  const old = payload();
  message(old);
  await first;
  open.mockClear();
  const second = startGitHubLogin("https://auth.rigelcms.dev");
  const next = payload();
  expect(next.nonce).not.toBe(old.nonce);
  message(old);
  message(next);
  await second;
  expect(vi.getTimerCount()).toBe(0);
});

test("installation bot tokens are rejected by login and verification", async () => {
  const login = startGitHubLogin("https://auth.rigelcms.dev");
  message({ ...payload(), access_token: "ghs_installation" });
  await expect(login).rejects.toThrow(/invalid/);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(checkGitHubAccess("ghs_installation", "owner/site", "rigel-cms")).rejects.toThrow(/session/);
  expect(fetcher).not.toHaveBeenCalled();
});