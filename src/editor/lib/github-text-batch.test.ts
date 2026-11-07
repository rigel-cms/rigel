import { afterEach, expect, test, vi } from "vitest";
import { createHash } from "node:crypto";
import { readGitHubTextBatch } from "./github-text-batch";
import { indexRemoteDocuments, loadManifestRemote, readRemoteSelection } from "./github-backend";
import { clearFileCache } from "./file-cache";
import type { Manifest } from "../../manifest/types";

vi.mock("virtual:rigel-extensions", () => ({ default: [] }));
const ctx = { token: "disposable-token", repo: "owner/repo", branch: "drafts", cacheAccount: "alice" };
const blob = (text: string) => createHash("sha1").update(`blob ${Buffer.byteLength(text)}\0${text}`).digest("hex");
const texts = ["Alpha é", "Beta", "Gamma"];
const requests = texts.map(text => ({ sha: blob(text), limit: 1024 }));
afterEach(async () => { await clearFileCache(); vi.unstubAllGlobals(); });

test("GraphQL uses bounded read-only SHA aliases, validates Unicode Git bytes, and keeps credentials only in headers", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.github.com/graphql");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${ctx.token}` });
    const { query, variables } = JSON.parse(String(init.body));
    expect(query).toMatch(/^query RigelTextBlobs/); expect(query).not.toContain("mutation"); expect(query).not.toContain(ctx.token);
    expect(variables).toEqual({ owner: "owner", name: "repo" });
    return Response.json({ data: { repository: Object.fromEntries(texts.map((text, i) => [`b${i}`, { oid: blob(text), text, isTruncated: false }])) } });
  }));
  expect(await readGitHubTextBatch(ctx, requests)).toEqual(new Map(texts.map(text => [blob(text), text])));
  expect(fetch).toHaveBeenCalledTimes(1);
  await expect(readGitHubTextBatch(ctx, Array(65).fill(requests[0]))).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("partial aliases, truncated text, wrong SHAs and corrupt bytes retain successes and request REST only for misses", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ data: { repository: { b0: { oid: requests[0].sha, text: texts[0], isTruncated: false }, b1: { oid: requests[1].sha, text: "cut", isTruncated: true }, b2: null } }, errors: [{ path: ["repository", "b2"], type: "NOT_FOUND" }] }));
  expect(await readGitHubTextBatch(ctx, requests)).toEqual(new Map([[requests[0].sha, texts[0]]]));
  vi.stubGlobal("fetch", async () => Response.json({ data: { repository: { b0: { oid: requests[0].sha, text: "tampered", isTruncated: false }, b1: { oid: requests[0].sha, text: texts[1], isTruncated: false } } } }));
  expect(await readGitHubTextBatch(ctx, requests)).toEqual(new Map());
});

test.each([401, 403, 429, 500])("GraphQL HTTP %s fails without a REST avalanche or leaking response text", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ message: "private response" }, { status })));
  const error = await readGitHubTextBatch(ctx, requests).catch(error => error);
  expect(error).toBeInstanceOf(Error); expect(error.message).not.toMatch(/private response|disposable-token/); expect(fetch).toHaveBeenCalledTimes(1);
});

test.each(["RATE_LIMITED", "FORBIDDEN", "UNAUTHENTICATED"])("GraphQL %s errors stop rather than retrying every blob", async type => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ errors: [{ type, message: "private" }] })));
  await expect(readGitHubTextBatch(ctx, requests)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
});

test("REST fallback rejects source bytes that do not hash to the current tree SHA", async () => {
  const text = JSON.stringify({ title: "Expected" }), sha = blob(text);
  const original: Manifest = { pages: [], schema: { objects: [], documents: [{ name: "page", title: "Pages", type: "document", folder: "pages", fields: [{ key: "title", label: "Title", type: "string", required: true }] }] }, github: { repo: ctx.repo, branch: "drafts", publishBranch: "main", repoRoot: "", authOrigin: "https://auth.example", appSlug: "rigel", copyDir: "copy", collections: [] } };
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith("/graphql")) return Response.json({ data: { repository: { b0: { oid: sha, text: "truncated", isTruncated: true } } } });
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: "a".repeat(40) } });
    if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree: [{ path: "pages/one.json", sha, type: "blob", mode: "100644", size: text.length }] });
    if (url.includes("/git/blobs/")) return Response.json({ sha, encoding: "base64", content: Buffer.from(JSON.stringify({ title: "Wrong source" })).toString("base64") });
    throw Error("Unexpected endpoint");
  });
  const m = await loadManifestRemote(ctx, original, false);
  await expect(readRemoteSelection(ctx, m, { kind: "document", type: "page", id: "page:one" })).rejects.toThrow(/blob SHA/i);
  expect(m.documents![0]).toMatchObject({ loaded: "identity", data: {} });
});

test("real backend batches only the requested group's uncached files, REST-falls back one alias, and cache hits never query", async () => {
  const files = new Map<string, string>();
  for (let i = 0; i < 6; i++) files.set(`pages/page-${i}.json`, JSON.stringify({ title: `Page ${i}` }));
  files.set("trainers/other.json", JSON.stringify({ title: "Unrelated" }));
  const tree = [...files].map(([path, text]) => ({ path, sha: blob(text), type: "blob", mode: "100644", size: Buffer.byteLength(text) }));
  const bodies = new Map([...files.values()].map(text => [blob(text), text]));
  const queries: string[][] = [], rest: string[] = [];
  let partial = true;
  const original: Manifest = { pages: [], schema: { objects: [], documents: ["pages", "trainers"].map(name => ({ name, title: name, type: "document", folder: name, shared: true, fields: [{ key: "title", label: "Title", type: "string", required: true }] })) }, github: { repo: ctx.repo, branch: "drafts", publishBranch: "main", repoRoot: "", authOrigin: "https://auth.example", appSlug: "rigel", copyDir: "copy", collections: [] } };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    if (url.endsWith("/graphql")) {
      const { query } = JSON.parse(String(init.body));
      const shas = [...query.matchAll(/object\(oid: "([a-f0-9]{40})"\)/g)].map((match: RegExpMatchArray) => match[1]);
      queries.push(shas);
      expect(shas.every((sha: string) => tree.some(entry => entry.sha === sha && entry.path.startsWith("pages/")))).toBe(true);
      const data = Object.fromEntries(shas.map((sha: string, index: number) => [`b${index}`, { oid: sha, text: bodies.get(sha), isTruncated: partial && index === 0 }]));
      partial = false;
      return Response.json({ data: { repository: data } });
    }
    if (url.includes("/git/ref/")) return Response.json({ object: { sha: "a".repeat(40) } });
    if (url.includes("/git/trees/")) return Response.json({ truncated: false, tree });
    if (url.includes("/git/blobs/")) { const sha = url.split("/").at(-1)!; rest.push(sha); return Response.json({ sha, encoding: "base64", content: Buffer.from(bodies.get(sha)!).toString("base64") }); }
    throw Error("Unexpected endpoint");
  }));
  let m = await loadManifestRemote(ctx, original, false);
  expect(queries).toEqual([]); expect(rest).toEqual([]);
  await indexRemoteDocuments(ctx, m, ["pages"]);
  expect(queries.map(query => query.length)).toEqual([4, 2]); expect(rest).toHaveLength(1);
  const count = queries.length;
  await readRemoteSelection(ctx, m, { kind: "document", type: "pages", id: "pages:page-0" });
  expect(queries).toHaveLength(count);
  m = await loadManifestRemote(ctx, original, false);
  await indexRemoteDocuments(ctx, m, ["pages"]);
  expect(queries).toHaveLength(count); expect(rest).toHaveLength(1);
});
