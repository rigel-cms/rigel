import { readStorage, writeStorage } from "./storage";
import type { StockKeys } from "./images";
import { availableLocales, setLocale, type Locale } from "../i18n";

export interface RigelUserPref {
  sidebarCollapsed?: boolean;
  editorExperience?: "sidebar" | "inline";
  previewSplit: number;
  mediaView: "grid" | "list";
}

export interface RigelSettings {
  theme: "system" | "light" | "dark";
  language: Locale;

  devMode: boolean;
  highContrast: boolean;

  apiKeys: StockKeys;
  userPref: RigelUserPref;
}

const prefs = (theme: "system" | "light" | "dark" = "system", language: Locale = "en"): Pick<RigelSettings, "theme" | "language" | "devMode" | "highContrast"> => ({
  theme, language, devMode: false, highContrast: false,
});

const DEFAULTS: RigelSettings = {
  ...prefs(),
  apiKeys: {},
  userPref: { previewSplit: 0.5, mediaView: "grid", sidebarCollapsed: false, editorExperience: "inline" },
};

const PROVIDERS = ["pexels", "pixabay", "unsplash"] as const;

export function getSettings(): RigelSettings {
  try {
    const saved = JSON.parse(readStorage("settings") ?? "{}");
    const legacyKeys = readLegacyKeys();
    const keys = Object.fromEntries(PROVIDERS.filter((key) => typeof saved?.apiKeys?.[key] === "string").map((key) => [key, saved.apiKeys[key]]));
    const mergedKeys = { ...legacyKeys, ...keys };
    const legacyPref = readLegacyPref();
    return {
      theme: ["system", "light", "dark"].includes(saved?.theme) ? saved.theme : DEFAULTS.theme,
      language: availableLocales.includes(saved?.language) ? saved.language : DEFAULTS.language,
      devMode: typeof saved?.devMode === "boolean" ? saved.devMode : DEFAULTS.devMode,
      highContrast: typeof saved?.highContrast === "boolean" ? saved.highContrast : DEFAULTS.highContrast,
      apiKeys: mergedKeys,
      userPref: {
        sidebarCollapsed: saved?.userPref?.sidebarCollapsed === true,
        editorExperience: saved?.userPref?.editorExperience === "sidebar" ? "sidebar" : DEFAULTS.userPref.editorExperience,
        previewSplit: typeof saved?.userPref?.previewSplit === "number" && Number.isFinite(saved.userPref.previewSplit) && saved.userPref.previewSplit >= 0.2 && saved.userPref.previewSplit <= 0.8
          ? saved.userPref.previewSplit
          : typeof saved?.previewSplit === "number" && Number.isFinite(saved.previewSplit) && saved.previewSplit >= 0.2 && saved.previewSplit <= 0.8
            ? saved.previewSplit
            : DEFAULTS.userPref.previewSplit,
        mediaView: ["grid", "list"].includes(saved?.userPref?.mediaView) ? saved.userPref.mediaView
          : legacyPref.mediaView ?? DEFAULTS.userPref.mediaView,
      },
    };
  } catch {
    return { ...DEFAULTS, apiKeys: readLegacyKeys(), userPref: { ...DEFAULTS.userPref, ...readLegacyPref() } };
  }
}

function readLegacyKeys(): StockKeys {
  try {
    const value = JSON.parse(readStorage("keys") ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(PROVIDERS.filter((key) => typeof value[key] === "string").map((key) => [key, value[key]]));
  } catch {
    return {};
  }
}

function readLegacyPref(): Partial<RigelUserPref> {
  try {
    const value = JSON.parse(readStorage("mediaView") ?? "null");
    return value === "grid" || value === "list" ? { mediaView: value } : {};
  } catch {
    return {};
  }
}

export function setSettings(s: Partial<RigelSettings>) {
  const next = { ...getSettings(), ...s, userPref: { ...getSettings().userPref, ...s.userPref } };
  writeStorage("settings", next);
  setLocale(next.language);
  clearLegacy();
  localStorage.removeItem("rigel.user");
}

function clearLegacy() {
  for (const name of ["keys", "mediaView"] as const) {
    localStorage.removeItem(`rigelcms.${name}`);
    localStorage.removeItem(`rigel.${name}`);
  }
}

export function getKeys(): StockKeys {
  return getSettings().apiKeys;
}

export function setKeys(keys: StockKeys) {
  setSettings({ apiKeys: keys });
}