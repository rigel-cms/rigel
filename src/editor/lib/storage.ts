type SessionConfig = { authOrigin: string; repo: string; branch: string; appSlug: string };
type Session = { accessToken: string; expiresAt: number };

function sessionScope(config: SessionConfig) {
  return JSON.stringify([config.authOrigin, config.repo, config.branch, config.appSlug]);
}

export function clearSession() {
  try { localStorage.removeItem("rigelcms.session"); } catch {}
}

export function readSession(config: SessionConfig): Session | null {
  try {
    const saved = JSON.parse(localStorage.getItem("rigelcms.session") ?? "null");
    if (saved?.version === 1 && saved.scope === sessionScope(config)
      && typeof saved.accessToken === "string" && /^ghu_[a-zA-Z0-9_]{1,4092}$/.test(saved.accessToken)
      && Number.isSafeInteger(saved.expiresAt) && saved.expiresAt > Date.now() + 30_000 && saved.expiresAt <= Date.now() + 86_400_000) {
      return { accessToken: saved.accessToken, expiresAt: saved.expiresAt };
    }
  } catch {}
  clearSession();
  return null;
}

export function writeSession(config: SessionConfig, session: Session) {
  try { writeStorage("session", { version: 1, scope: sessionScope(config), accessToken: session.accessToken, expiresAt: session.expiresAt }); } catch {}
}

export function readStorage(name: "settings" | "keys" | "mediaView" | "session"): string | null {
  return localStorage.getItem(`rigelcms.${name}`) ?? localStorage.getItem(`rigel.${name}`);
}

export function writeStorage(name: "settings" | "keys" | "mediaView" | "session", value: unknown) {
  localStorage.setItem(`rigelcms.${name}`, JSON.stringify(value));
  localStorage.removeItem(`rigel.${name}`);
}

export function eraseData() {
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const key of keys) {
    if (key && (key.startsWith("rigelcms.") || ["rigel.settings", "rigel.keys", "rigel.user"].includes(key))) {
      localStorage.removeItem(key);
    }
  }
}
