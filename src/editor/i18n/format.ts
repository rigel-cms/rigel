import system from "./en/system.json" with { type: "json" };
import validation from "./en/validation.json" with { type: "json" };
import local from "./en/local.json" with { type: "json" };
import defaults from "./en/defaults.json" with { type: "json" };

export type Parameters = Record<string, string | number>;
export type Translator = (key: string, parameters?: Parameters) => string;
export type Dictionaries = Record<string, Record<string, string>>;

export function formatMessage(catalogs: Dictionaries, language: string, key: string, parameters: Parameters = {}): string {
  const count = parameters.count;
  const plural = typeof count === "number" && Number.isFinite(count);
  const lookup = (code: string) => {
    const messages = catalogs[code] ?? {};
    const category = plural ? new Intl.PluralRules(code).select(count as number) : undefined;
    for (const candidate of category ? [`${key}.${category}`, key, `${key}.other`] : [key]) {
      const value = messages[candidate];
      if (Object.hasOwn(messages, candidate) && typeof value === "string" && value.length) return value;
    }
  };
  const message = lookup(language) ?? lookup("en") ?? key;
  return message.replace(/\{([a-zA-Z][\w]*)\}/g, (placeholder, name: string) => Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder);
}

const english = { ...system, ...validation, ...local, ...defaults };
export const systemMessage: Translator = (key, parameters) => formatMessage({ en: english }, "en", key, parameters);
