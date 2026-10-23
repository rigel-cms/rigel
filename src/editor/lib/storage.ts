export function readStorage(name: "settings" | "keys" | "mediaView"): string | null {
  return localStorage.getItem(`rigelcms.${name}`) ?? localStorage.getItem(`rigel.${name}`);
}

export function writeStorage(name: "settings" | "keys" | "mediaView", value: unknown) {
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
