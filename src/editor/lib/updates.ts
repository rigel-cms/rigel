import { version } from "../../../package.json";

export const installedVersion = version;
export const releaseNotesUrl = "https://github.com/rigel-cms/rigel/releases";
export const registryUrl = "https://registry.npmjs.org/@rigel-cms%2frigel/latest";

function semver(value: unknown) {
  if (typeof value !== "string" || value.length > 256) return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(value);
  if (!match || match[0] !== value || match[4]?.split(".").some(id => /^\d+$/.test(id) && id.length > 1 && id[0] === "0")) return null;
  return { core: match.slice(1, 4).map(BigInt), prerelease: match[4] };
}

const cacheTtl = 86_400_000;
const dismissedKey = "rigelcms.updates.dismissed";

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); } catch { return null; }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function dismissUpdate(target: string) {
  if (semver(target)) write(dismissedKey, target);
}

export function isUpdateDismissed(target: string) {
  return read(dismissedKey) === target;
}

export async function checkUpdate(current = installedVersion, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted || !semver(current)) return null;
  const key = `rigelcms.updates.${current}`;
  const cached = read(key) as { checkedAt?: unknown; latest?: unknown } | null;
  const now = Date.now();
  if (cached && typeof cached.checkedAt === "number" && Number.isSafeInteger(cached.checkedAt)
    && cached.checkedAt <= now && now - cached.checkedAt < cacheTtl
    && (cached.latest === null || (semver(cached.latest) && !semver(cached.latest)!.prerelease))) {
    return availableUpdate(current, cached.latest) ? cached.latest : null;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 5000);
  let latest: string | null = null;
  try {
    const canceled = new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new Error("Canceled")), { once: true }));
    const request = async () => {
      const response = await fetch(registryUrl, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "error", signal: controller.signal });
      if (!response.ok) return null;
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) return null;
      const { name, version } = data as Record<string, unknown>;
      const parsed = semver(version);
      return name === "@rigel-cms/rigel" && parsed && !parsed.prerelease ? version as string : null;
    };
    latest = await Promise.race([request(), canceled]);
  } catch {} finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
  if (signal?.aborted) return null;
  write(key, { checkedAt: Date.now(), latest });
  return availableUpdate(current, latest) ? latest : null;
}

export function availableUpdate(current: string, latest: unknown): latest is string {
  const from = semver(current), to = semver(latest);
  if (!from || !to || to.prerelease) return false;
  for (let i = 0; i < 3; i++) {
    if (to.core[i] !== from.core[i]) return to.core[i] > from.core[i];
  }
  return !!from.prerelease;
}
