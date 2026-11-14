import type { Manifest } from "../../manifest/types";
import type { Selection } from "../../manifest/navigation";
import { validateBody, type ArticleBody } from "../../article-body";

type Target = Extract<Selection, { kind: "page" | "post" | "document" | "menu" }>;
export type RecoveryDraft = {
  version: 1; id: string; scope: string; selection: Target; locale?: string;
  values: Record<string, unknown>; body: "" | ArticleBody;
  base: { values: Record<string, unknown> | null; body: "" | ArticleBody };
  creating: boolean; savedAt: number;
};
const PREFIX = "rigelcms.drafts.";
const MAX_BYTES = 1024 * 1024;

export function recoveryScope(manifest: Manifest, account?: string): string | null {
  if (manifest.backend === "demo") return null;
  const cfg = manifest.github;
  if (manifest.backend === "github" ? !cfg || !account : !manifest.recoveryScope) return null;
  return JSON.stringify([
    manifest.backend === "github" ? [account, cfg!.repo, cfg!.branch, cfg!.repoRoot, cfg!.copyDir, cfg!.collections, cfg!.menus] : manifest.recoveryScope,
    manifest.schema, manifest.collections?.map(({ name, fields, locale }) => ({ name, fields, locale })),
    manifest.pages.map(({ slug, groups, locale }) => ({ slug, groups, locale })), manifest.contentLocales,
  ]);
}

function valid(value: unknown): value is RecoveryDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as RecoveryDraft, target = record.selection;
  if (record.version !== 1 || typeof record.id !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(record.id) || typeof record.scope !== "string" || !record.scope || !Number.isSafeInteger(record.savedAt) || record.savedAt < 0 || typeof record.creating !== "boolean" || record.locale !== undefined && typeof record.locale !== "string") return false;
  if (!target || !["page", "post", "document", "menu"].includes(target.kind)) return false;
  const parts = target.kind === "document" ? [target.type, target.id] : target.kind === "post" ? [target.collection, target.slug] : [target.slug];
  if (parts.some(part => typeof part !== "string" || !part || part.length > 1000 || /[\u0000-\u001f]/.test(part))) return false;
  const object = (v: unknown) => v && typeof v === "object" && !Array.isArray(v);
  if (!object(record.values) || !object(record.base) || record.base.values !== null && !object(record.base.values)) return false;
  try {
    for (const body of [record.body, record.base.body]) if (body !== "") validateBody(body);
    let nodes = 0;
    const check = (node: unknown, depth = 0): void => {
      if (++nodes > 100000 || depth > 64) throw new Error();
      if (node && typeof node === "object") for (const [key, child] of Object.entries(node)) {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error();
        check(child, depth + 1);
      }
    };
    check(value);
    return true;
  } catch { return false; }
}

export function readRecovery(scope: string): RecoveryDraft[] {
  const records: RecoveryDraft[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    const text = localStorage.getItem(key);
    if (!text || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) continue;
    let value: unknown;
    try { value = JSON.parse(text); } catch { continue; }
    if (valid(value) && value.scope === scope && key === PREFIX + value.id) records.push(value);
  }
  return records.sort((a, b) => b.savedAt - a.savedAt);
}

export function writeRecovery(record: RecoveryDraft) {
  const text = JSON.stringify(record);
  if (new TextEncoder().encode(text).length > MAX_BYTES || !valid(record)) throw new Error("Invalid or oversized recovery draft");
  localStorage.setItem(PREFIX + record.id, text);
}

export function removeRecovery(id: string, expected?: RecoveryDraft) {
  if (!expected || localStorage.getItem(PREFIX + id) === JSON.stringify(expected)) localStorage.removeItem(PREFIX + id);
}
export function holdRecovery(id: string): () => void {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  if (typeof navigator !== "undefined" && navigator.locks) void navigator.locks.request(PREFIX + id, () => held).catch(() => {});
  return release;
}

export async function consumeRecovery(record: RecoveryDraft) {
  if (typeof navigator === "undefined" || !navigator.locks) return;
  const target = JSON.stringify([record.selection, record.locale]);
  for (const candidate of readRecovery(record.scope)) {
    if (candidate.savedAt > record.savedAt || JSON.stringify([candidate.selection, candidate.locale]) !== target) continue;
    await navigator.locks.request(PREFIX + candidate.id, { ifAvailable: true }, lock => {
      if (lock) removeRecovery(candidate.id, candidate);
    });
  }
}

export function clearRecovery(scope: string) { for (const record of readRecovery(scope)) removeRecovery(record.id); }
