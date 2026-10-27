import { afterEach, expect, test, vi } from "vitest";
import type { Manifest } from "../../manifest/types";
import { reviewRemotePublish, confirmRemotePublish, loadManifestRemote, saveRemoteSelection, deleteRemotePost, PublishReviewChangedError } from "./github-backend";

const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const ctx = { token: "test-token", repo: "owner/site", branch: "drafts" };
const manifest = (): Manifest => ({ pages: [], backend: "github", github: { repo: ctx.repo, branch: "drafts", publishBranch: "production", repoRoot: "", copyDir: "copy", collections: [], authOrigin: "https://auth.example", appSlug: "rigel" } });
function server() {
  const calls: { path: string; method: string; body: any }[] = [];
  const files = [{ filename: "outside/cms.txt", status: "modified" }, { filename: "new.txt", previous_filename: "old.txt", status: "renamed" }];
  const state = { head: A, base: B, merged: false, pr: false, allow: true, autoDelete: false, moved: false, failMerge: false, failCreate: false, block: false, calls, files };
  const pr = () => ({ number: 7, state: state.merged ? "closed" : "open", merged: state.merged, merge_commit_sha: state.merged ? C : null, mergeable: !state.block, mergeable_state: state.block ? "blocked" : "clean", draft: false, head: { ref: "drafts", sha: A, repo: { full_name: ctx.repo } }, base: { ref: "production", sha: state.base, repo: { full_name: ctx.repo } } });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input), path = decodeURIComponent(url.pathname.replace("/repos/owner/site", ""));
    const method = init.method ?? "GET", body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method, body });
    if (path === "") return Response.json({ allow_squash_merge: state.allow, delete_branch_on_merge: state.autoDelete, permissions: { push: true } });
    if (path === "/git/ref/heads/drafts") return Response.json({ object: { sha: state.head } });
    if (path === "/git/ref/heads/production") return Response.json({ object: { sha: state.base } });
    if (path.startsWith("/compare/")) return Response.json({ base_commit: { sha: B }, merge_base_commit: { sha: B }, files: state.files });
    if (path === `/git/trees/${B}`) return Response.json({ truncated: false, tree: [{ path: "outside/cms.txt", sha: B, type: "blob", mode: "100644" }, { path: "old.txt", sha: C, type: "blob", mode: "100644" }] });
    if (path === `/git/trees/${A}`) return Response.json({ truncated: false, tree: [{ path: "outside/cms.txt", sha: A, type: "blob", mode: "100644" }, { path: "new.txt", sha: C, type: "blob", mode: "100644" }] });
    if (path === "/pulls" && method === "GET") return Response.json(state.pr ? [pr()] : []);
    if (path === "/pulls" && method === "POST") { state.pr = true; if (state.failCreate) { state.failCreate = false; throw Error("lost create"); } return Response.json(pr()); }
    if (path === "/pulls/7") { if (state.moved) state.base = C; return Response.json(pr()); }
    if (path === "/pulls/7/merge") { state.merged = true; if (state.failMerge) { state.failMerge = false; throw Error("lost merge"); } return Response.json({ merged: true, sha: C }); }
    throw Error(`Unexpected ${method} ${path}`);
  }));
  return state;
}
afterEach(() => vi.unstubAllGlobals());

test("post-sync reload cannot recreate a remotely deleted drafts branch", async () => {
  server(); const methods: string[] = [];
  vi.stubGlobal("fetch", (_input: string, init: RequestInit = {}) => { methods.push(init.method ?? "GET"); return Promise.resolve(Response.json({}, { status: 404 })); });
  await expect(loadManifestRemote(ctx, manifest(), false)).rejects.toThrow(/404/);
  expect(methods).toEqual(["GET"]);
});

test("review is read-only, complete and includes renamed and non-CMS files", async () => {
  const s = server();
  const review = await reviewRemotePublish(ctx, manifest());
  expect(review).toMatchObject({ head: A, base: B, branch: "drafts", publishBranch: "production", needsSync: false });
  expect(review.files).toEqual(s.files);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("confirmation creates only an exact-branch PR and verifies a head-pinned squash", async () => {
  const s = server(), m = manifest();
  const review = await reviewRemotePublish(ctx, m);
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  expect(s.calls.filter(c => c.method !== "GET")).toEqual([
    { path: "/pulls", method: "POST", body: { title: "Publish drafts to production", head: "drafts", base: "production", draft: false, maintainer_can_modify: false } },
    { path: "/pulls/7/merge", method: "PUT", body: { merge_method: "squash", sha: A } },
  ]);
  expect(s.calls.at(-1)?.path).toBe("/pulls/7");
});

test.each(["head", "base"] as const)("moved %s invalidates review without any write", async field => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m);
  s[field] = C;
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/Branches changed/);
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toBeInstanceOf(PublishReviewChangedError);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("a target moving during PR validation prevents merge", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m);
  s.moved = true;
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/target changed/);
  expect(s.calls.some(c => c.path.endsWith("/merge"))).toBe(false);
});

test.each(["failCreate", "failMerge"] as const)("lost %s response is reconciled without duplicate writes", async field => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m);
  s[field] = true;
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  expect(s.calls.filter(c => c.method === "POST")).toHaveLength(1);
  expect(s.calls.filter(c => c.method === "PUT")).toHaveLength(1);
});

test("checks and conflicts block merge and an exact existing PR is reused", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m);
  s.pr = true; s.block = true;
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/required checks/);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
  s.block = false;
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  expect(s.calls.some(c => c.method === "POST")).toBe(false);
});

test.each(["allow", "autoDelete"] as const)("unsafe repository setting %s prevents review", async field => {
  const s = server(); s[field] = field === "autoDelete";
  await expect(reviewRemotePublish(ctx, manifest())).rejects.toThrow(/owner/);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("missing comparison files fail closed rather than presenting a partial list", async () => {
  const s = server(); s.files.pop();
  await expect(reviewRemotePublish(ctx, manifest())).rejects.toThrow(/Incomplete/);
});

test("compare cap of 300 and truncated trees fail closed", async () => {
  server(); const original = fetch;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.includes("/compare/")) return Response.json({ base_commit: { sha: B }, merge_base_commit: { sha: B }, files: Array(300).fill({ filename: "a", status: "modified" }) });
    return original(input, init);
  });
  await expect(reviewRemotePublish(ctx, manifest())).rejects.toThrow(/300/);
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => input.includes("/git/trees/") ? Response.json({ truncated: true, tree: [] }) : original(input, init));
  await expect(reviewRemotePublish(ctx, manifest())).rejects.toThrow(/Incomplete/);
});

test.each(["mode", "duplicate"])("malformed tree %s cannot silently omit files", async kind => {
  server(); const original = fetch;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const response = await original(input, init);
    if (input.includes("/git/trees/")) {
      const data = await response.json(); data.tree.push(kind === "duplicate" ? data.tree[0] : { path: "inconsistent", type: "tree", mode: "100644", sha: C });
      return Response.json(data);
    }
    return response;
  });
  await expect(reviewRemotePublish(ctx, manifest())).rejects.toThrow(/Malformed/);
});

test("identical net trees after squash are empty, regardless of historical ahead commits", async () => {
  const s = server(), original = fetch;
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => original(input.replace(`/git/trees/${A}`, `/git/trees/${B}`), init));
  const review = await reviewRemotePublish(ctx, manifest());
  expect(review.files).toEqual([]);
  expect(s.calls.some(c => c.path.startsWith("/compare/"))).toBe(false);
  await expect(confirmRemotePublish(ctx, manifest(), review)).rejects.toThrow(/Review saved/);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("double confirmation cannot overlap and session invalidation stops subsequent requests", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m), original = fetch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => { await gate; return original(input, init); });
  let active = true;
  const first = confirmRemotePublish(ctx, m, review, () => { if (!active) throw Error("Session invalidated"); });
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/Wait/);
  active = false; release();
  await expect(first).rejects.toThrow(/Session invalidated/);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});

test("session invalidation immediately after PR creation prevents every later request", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m), original = fetch;
  let active = true;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const response = await original(input, init);
    if (init?.method === "POST") active = false;
    return response;
  });
  await expect(confirmRemotePublish(ctx, m, review, () => { if (!active) throw Error("Session invalidated"); })).rejects.toThrow(/Session invalidated/);
  expect(s.calls.at(-1)?.method).toBe("POST");
  expect(s.calls.some(c => c.method === "PUT")).toBe(false);
});

test("repeated publish explicitly syncs target into drafts and requires a new review", async () => {
  const s = server(), m = manifest(), original = fetch;
  let synced = false;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.includes("/compare/")) return Response.json({ base_commit: { sha: B }, merge_base_commit: { sha: C }, files: s.files });
    if (input.endsWith("/pulls/7/update-branch")) { s.calls.push({ path: "/pulls/7/update-branch", method: init!.method!, body: JSON.parse(String(init!.body)) }); synced = true; return Response.json({ message: "Updating" }, { status: 202 }); }
    const response = await original(input, init);
    if (synced && input.endsWith("/pulls/7")) { const data = await response.json(); data.head.sha = C; return Response.json(data); }
    return response;
  });
  const review = await reviewRemotePublish(ctx, m);
  expect(review.needsSync).toBe(true);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("synced");
  expect(s.calls.filter(c => c.method === "PUT")).toEqual([{ path: "/pulls/7/update-branch", method: "PUT", body: { expected_head_sha: A } }]);
  expect(s.merged).toBe(false);
});

test("unconfirmed merged readback retries verification, never the squash", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m), original = fetch;
  let fail = true;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.endsWith("/pulls/7") && s.merged && fail) { fail = false; throw Error("Readback unavailable"); }
    return original(input, init);
  });
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/unconfirmed/);
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  expect(s.calls.filter(c => c.method === "PUT")).toHaveLength(1);
});

test("unrelated and fork pull requests are never reused based on their title", async () => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m), original = fetch;
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    if (input.includes("/pulls?") && !s.pr) return Response.json([{ number: 99, title: "Publish drafts to production", head: { ref: "drafts", sha: A, repo: { full_name: "other/site" } }, base: { ref: "production", sha: B, repo: { full_name: ctx.repo } } }]);
    return original(input, init);
  });
  await expect(confirmRemotePublish(ctx, m, review)).resolves.toBe("published");
  expect(s.calls.some(c => c.path.includes("/99"))).toBe(false);
  expect(s.calls.filter(c => c.method === "POST")).toHaveLength(1);
});

test("save and delete cannot overlap publishing, and queued saving blocks confirmation", async () => {
  server(); const m = await loadManifestRemote(ctx, manifest()), review = await reviewRemotePublish(ctx, m), original = fetch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => { await gate; return original(input, init); });
  const publishing = confirmRemotePublish(ctx, m, review);
  await expect(saveRemoteSelection(ctx, m, { kind: "pages" }, {}, "", false)).rejects.toThrow(/publishing/);
  await expect(deleteRemotePost(ctx, m, "blog", "post")).rejects.toThrow(/publishing/);
  release(); await publishing;
  const saving = saveRemoteSelection(ctx, m, { kind: "pages" }, {}, "", false);
  await expect(confirmRemotePublish(ctx, m, review)).rejects.toThrow(/Wait/);
  await expect(saving).rejects.toThrow(/editable/);
});

test.each([401, 403, 405, 409, 422])("publishing API %s fails safely with actionable sanitized errors", async status => {
  const s = server(), m = manifest(), review = await reviewRemotePublish(ctx, m), original = fetch;
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) => input.includes("/pulls") ? Promise.resolve(Response.json({ message: "test-token secret" }, { status })) : original(input, init));
  const error = await confirmRemotePublish(ctx, m, review).catch(e => e);
  expect(error).toBeInstanceOf(Error);
  expect(error.message).not.toMatch(/test-token|secret/);
  expect(error.status).toBe(status);
  expect(s.calls.every(c => c.method === "GET")).toBe(true);
});
