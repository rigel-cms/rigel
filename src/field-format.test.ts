import { expect, test } from "vitest";
import { formatValue, validateFieldFormat, type FieldFormat } from "./field-format";

test("formats long English dates without changing content or options", () => {
  const format = Object.freeze({ type: "date", options: Object.freeze({ dateStyle: "long" }) }) satisfies FieldFormat;
  const value = new Date("2026-11-17T00:00:00Z");
  expect(formatValue("2026-11-17", format)).toBe("November 17, 2026");
  expect(formatValue(value, format)).toBe("November 17, 2026");
  expect(value.toISOString()).toBe("2026-11-17T00:00:00.000Z");
  expect(format.options).toEqual({ dateStyle: "long" });
});

test("uses locale lists and explicit timezones with UTC as the default", () => {
  expect(formatValue("2026-11-17", { type: "date", locale: ["fr"], options: { dateStyle: "long" } })).toBe("17 novembre 2026");
  const value = "2026-11-17T00:30:00Z";
  expect(formatValue(value, { type: "date", options: { dateStyle: "long" } })).toBe("November 17, 2026");
  expect(formatValue(value, { type: "date", options: { dateStyle: "long", timeZone: "America/Los_Angeles" } })).toBe("November 16, 2026");
  expect(formatValue("2026-11-17T00:30:00+02:00", { type: "date", options: { dateStyle: "long" } })).toBe("November 16, 2026");
});

test("clears invalid dates instead of coercing or rolling over", () => {
  for (const value of [null, undefined, "", " ", 0, true, {}, new Date(NaN), "not a date", "11/17/2026", "2026-02-29", "2024-02-30", "2026-04-31", "2026-13-01", "2026-00-01", "2026-11-00", "2026-11-17T00:00:00", "2026-11-17T24:00:00Z", "2026-02-30T00:00:00Z", "2026-02-30T00:00:00+02:00", "2026-11-17T01:60:00Z", "2026-11-17T01:00:60Z", "2026-11-17T01:00:00+24:00"]) {
    expect(formatValue(value, { type: "date" }), String(value)).toBe("");
  }
  expect(formatValue("2024-02-29T12:34:56.123Z", { type: "date", options: { dateStyle: "long" } })).toBe("February 29, 2024");
});

test("preserves plain values when no format is declared", () => {
  for (const [value, expected] of [[null, ""], [undefined, ""], ["", ""], [0, "0"], [false, "false"], ["raw text", "raw text"], [42, "42"]]) expect(formatValue(value)).toBe(expected);
});

test("formats finite numbers including zero, currency and percent", () => {
  expect(formatValue(0, { type: "number" })).toBe("0");
  expect(formatValue(1234.5, { type: "number", locale: "en-US", options: { style: "currency", currency: "USD" } })).toBe("$1,234.50");
  expect(formatValue(0.125, { type: "number", options: { style: "percent", maximumFractionDigits: 1 } })).toBe("12.5%");
  for (const value of [null, undefined, "", "123", true, false, NaN, Infinity, -Infinity, {}, new Number(12)]) expect(formatValue(value, { type: "number" })).toBe("");
});

test("validates declarative Intl formats without mutating them", () => {
  for (const format of [{ type: "date" }, { type: "number" }, { type: "date", locale: ["fr", "en"], options: { dateStyle: "long", timeZone: "UTC" } }, { type: "number", options: { style: "currency", currency: "EUR", useGrouping: false } }]) {
    const before = JSON.stringify(format);
    expect(() => validateFieldFormat(format)).not.toThrow();
    expect(JSON.stringify(format)).toBe(before);
  }
});

test("rejects malformed, non-JSON and invalid Intl configuration", () => {
  for (const format of [null, undefined, [], "date", () => {}, new Date(), { type: "html" }, { type: "date", extra: true }, { type: "date", locale: null }, { type: "date", locale: 1 }, { type: "date", locale: "not_a_locale" }, { type: "date", locale: ["en", 1] }, { type: "date", locale: [undefined] }, { type: "date", options: null }, { type: "date", options: [] }, { type: "date", options: new Date() }, { type: "date", options: { unknown: "long" } }, { type: "date", options: { month: () => "long" } }, { type: "date", options: { hour12: "false" } }, { type: "date", options: { month: 1 } }, { type: "date", options: { year: undefined } }, { type: "date", options: { timeZone: "Nowhere/Invalid" } }, { type: "date", options: { month: "nope" } }, { type: "date", options: { dateStyle: "long", month: "long" } }, { type: "number", options: { style: "currency" } }, { type: "number", options: { currency: "INVALID" } }, { type: "number", options: { maximumFractionDigits: Infinity } }, { type: "number", options: { minimumFractionDigits: "2" } }, { type: "number", options: { minimumFractionDigits: -1 } }, { type: "number", options: { dateStyle: "long" } }, { type: "date", options: { [Symbol("extra")]: true } }, Object.assign(Object.create({}), { type: "date" })]) {
    expect(() => validateFieldFormat(format)).toThrow(/^rigel: .*format/);
    if (format !== undefined) expect(formatValue("2026-11-17", format as FieldFormat)).toBe("");
  }
});

test("rejects accessors without invoking callbacks", () => {
  let called = false;
  const options = { get month() { called = true; return "long"; } };
  expect(() => validateFieldFormat({ type: "date", options })).toThrow(/^rigel: .*format/);
  expect(called).toBe(false);
});

test("rejects locale accessors and hidden option values without invoking them", () => {
  let called = false;
  const locale = Object.defineProperty(["en"], "0", { get() { called = true; return "en"; } });
  expect(() => validateFieldFormat({ type: "date", locale })).toThrow(/^rigel: .*format/);
  expect(called).toBe(false);
  expect(() => validateFieldFormat({ type: "date", options: Object.defineProperty({}, "unknown", { value: () => "long" }) })).toThrow(/^rigel: .*format/);
});

test("accepts the native Intl option families", () => {
  expect(() => validateFieldFormat({ type: "date", locale: [], options: { localeMatcher: "lookup", calendar: "gregory", numberingSystem: "latn", hour12: false, hourCycle: "h23", formatMatcher: "basic", weekday: "long", era: "short", year: "numeric", month: "long", day: "2-digit", dayPeriod: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3, timeZoneName: "short", timeZone: "UTC" } })).not.toThrow();
  expect(() => validateFieldFormat({ type: "number", options: { localeMatcher: "lookup", numberingSystem: "latn", style: "unit", unit: "meter", unitDisplay: "long", notation: "compact", compactDisplay: "long", useGrouping: "min2", minimumIntegerDigits: 2, minimumFractionDigits: 1, maximumFractionDigits: 2, minimumSignificantDigits: 2, maximumSignificantDigits: 3, roundingPriority: "morePrecision", roundingMode: "halfEven", trailingZeroDisplay: "stripIfInteger", signDisplay: "exceptZero" } })).not.toThrow();
});
