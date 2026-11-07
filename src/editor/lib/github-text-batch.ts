import { translate } from "../i18n";
import { fileBlobSha } from "./file-cache";
import type { GitContext } from "./github-backend";

class TextRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export interface TextBlobRequest { sha: string; limit: number }
export async function readGitHubTextBatch(ctx: GitContext, blobs: TextBlobRequest[]): Promise<Map<string, string>> {
  if (!blobs.length || blobs.length > 64 || blobs.some(blob => !/^[a-f0-9]{40}$/.test(blob.sha))) throw new Error(translate("connection.invalidFile"));
  const [owner, name] = ctx.repo.split("/");
  if (!/^[A-Za-z0-9_-]+$/.test(owner ?? "") || !/^[A-Za-z0-9_.-]+$/.test(name ?? "")) throw new Error(translate("connection.connectFirst"));
  const query = `query RigelTextBlobs($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${blobs.map((blob, index) => `b${index}: object(oid: "${blob.sha}") { ... on Blob { oid text isTruncated } }`).join(" ")} } }`;
  ctx.assertActive?.();
  let response: Response;
  try {
    response = await fetch("https://api.github.com/graphql", { method: "POST", headers: { Authorization: `Bearer ${ctx.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" }, body: JSON.stringify({ query, variables: { owner, name } }), redirect: "error", cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(15000) });
  } catch { throw new Error(translate("connection.requestFailed")); }
  ctx.assertActive?.();
  const limited = response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || response.headers.has("retry-after");
  if (!response.ok || limited) {
    if ([400, 404, 405, 501].includes(response.status) && !limited) return new Map();
    throw new TextRequestError(translate(limited ? "connection.requestRateLimited" : response.status === 401 ? "connection.requestSessionExpired" : response.status === 403 ? "connection.requestAccessDenied" : "connection.requestError", { status: response.status }), limited ? 429 : response.status);
  }
  const raw = await response.text();
  if (raw.length > 8 * 1024 * 1024) throw new Error(translate("connection.contentTooLarge"));
  let payload: any;
  try { payload = JSON.parse(raw); } catch { throw new Error(translate("connection.malformedResponse")); }
  const errors = payload?.errors;
  if (errors !== undefined && !Array.isArray(errors)) throw new Error(translate("connection.malformedResponse"));
  for (const error of errors ?? []) {
    const code = error?.type ?? error?.extensions?.type ?? error?.extensions?.code;
    if (["RATE_LIMITED", "RATE_LIMIT", "MAX_NODE_LIMIT_EXCEEDED"].includes(code)) throw new TextRequestError(translate("connection.requestRateLimited"), 429);
    if (["FORBIDDEN", "UNAUTHORIZED", "UNAUTHENTICATED"].includes(code)) throw new TextRequestError(translate("connection.requestAccessDenied"), code === "UNAUTHENTICATED" ? 401 : 403);
    if (!Array.isArray(error?.path) || error.path[0] !== "repository" || !/^b\d+$/.test(error.path[1])) throw new Error(translate("connection.requestFailed"));
  }
  const repository = payload?.data?.repository;
  if (!repository || typeof repository !== "object") throw new Error(translate("connection.requestAccessDenied"));
  const result = new Map<string, string>();
  await Promise.all(blobs.map(async (blob, index) => {
    const field = repository[`b${index}`];
    if ((errors ?? []).some((error: any) => error.path?.[1] === `b${index}`) || !field || field.oid !== blob.sha || field.isTruncated !== false || typeof field.text !== "string" || new TextEncoder().encode(field.text).byteLength > blob.limit) return;
    if (await fileBlobSha(field.text) === blob.sha) result.set(blob.sha, field.text);
  }));
  ctx.assertActive?.();
  return result;
}
