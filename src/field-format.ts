export type FieldFormat =
  | { type: "date"; locale?: string | string[]; options?: Intl.DateTimeFormatOptions }
  | { type: "number"; locale?: string | string[]; options?: Intl.NumberFormatOptions };

const dateOptions = new Set("localeMatcher calendar numberingSystem timeZone hour12 hourCycle formatMatcher weekday era year month day dayPeriod hour minute second fractionalSecondDigits timeZoneName dateStyle timeStyle".split(" "));
const numberOptions = new Set("localeMatcher numberingSystem style currency currencyDisplay currencySign unit unitDisplay notation compactDisplay useGrouping minimumIntegerDigits minimumFractionDigits maximumFractionDigits minimumSignificantDigits maximumSignificantDigits roundingPriority roundingIncrement roundingMode trailingZeroDisplay signDisplay".split(" "));
const numericOptions = new Set("fractionalSecondDigits minimumIntegerDigits minimumFractionDigits maximumFractionDigits minimumSignificantDigits maximumSignificantDigits roundingIncrement".split(" "));

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key === "string" && descriptor.enumerable && "value" in descriptor;
  });
}

export function validateFieldFormat(value: unknown): asserts value is FieldFormat {
  try {
    if (!plainObject(value) || Reflect.ownKeys(value).some(key => !["type", "locale", "options"].includes(key as string)) || (value.type !== "date" && value.type !== "number")) throw new Error();
    if ("locale" in value && !(typeof value.locale === "string" || (Array.isArray(value.locale) && Object.getPrototypeOf(value.locale) === Array.prototype && Reflect.ownKeys(value.locale).length === value.locale.length + 1 && Reflect.ownKeys(value.locale).every(key => {
      if (key === "length") return true;
      const descriptor = Object.getOwnPropertyDescriptor(value.locale, key)!;
      return typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < (value.locale as string[]).length && descriptor.enumerable && "value" in descriptor && typeof descriptor.value === "string";
    })))) throw new Error();
    if ("options" in value) {
      if (!plainObject(value.options)) throw new Error();
      const allowed = value.type === "date" ? dateOptions : numberOptions;
      for (const [key, option] of Object.entries(value.options)) {
        if (!allowed.has(key)) throw new Error();
        if (numericOptions.has(key) ? typeof option !== "number" || !Number.isSafeInteger(option) : key === "hour12" ? typeof option !== "boolean" : key === "useGrouping" ? typeof option !== "boolean" && !["auto", "always", "min2"].includes(option as string) : typeof option !== "string") throw new Error();
      }
    }
    const format = value as FieldFormat;
    if (format.type === "date") new Intl.DateTimeFormat(format.locale ?? "en", { timeZone: "UTC", ...format.options });
    else new Intl.NumberFormat(format.locale ?? "en", format.options);
  } catch {
    throw new Error("rigel: invalid field format");
  }
}

function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2}))?$/.exec(value);
  if (!match) return null;
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) return null;
  if (match[2] !== undefined && (+match[2] > 23 || +match[3]! > 59 || +(match[4] ?? 0) > 59)) return null;
  const date = match[2] === undefined ? day : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatValue(value: unknown, format?: FieldFormat): string {
  if (format === undefined) return value == null ? "" : String(value);
  try {
    validateFieldFormat(format);
    if (format.type === "number") return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat(format.locale ?? "en", format.options).format(value) : "";
    const date = parseDate(value);
    return date ? new Intl.DateTimeFormat(format.locale ?? "en", { timeZone: "UTC", ...format.options }).format(date) : "";
  } catch {
    return "";
  }
}
