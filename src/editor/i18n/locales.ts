export const localeNames = {
  en: "English",
  fr: "Français",
  es: "Español",
  ru: "Русский",
  zh: "中文（简体）",
  ja: "日本語",
  it: "Italiano",
  de: "Deutsch",
  nl: "Nederlands",
} as const;

export type Locale = keyof typeof localeNames;
