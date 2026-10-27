import { derived, get, readonly, writable } from "svelte/store";
import { formatMessage, type Parameters, type Translator } from "./format";
import dictionaries from "virtual:rigel-i18n";
import type { Locale } from "./locales";
export { formatMessage, type Parameters, type Translator } from "./format";
export { localeNames, type Locale } from "./locales";

const activeLocale = writable<Locale>("en");
export const locale = readonly(activeLocale);
export const availableLocales = Object.keys(dictionaries) as Locale[];
export const t = derived(locale, language => (key: string, parameters?: Parameters) => formatMessage(dictionaries, language, key, parameters));

export function setLocale(value: unknown): void {
  const language = typeof value === "string" ? value.toLowerCase().split(/[-_]/)[0] : "en";
  activeLocale.set(Object.hasOwn(dictionaries, language) ? language as Locale : "en");
}

export const translate: Translator = (key, parameters) => get(t)(key, parameters);
