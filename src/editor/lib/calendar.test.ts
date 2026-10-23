import { expect, test } from "vitest";
import { formatDate, isoDate, monthDays, moveDay, moveMonth, parseDate, todayDate } from "./calendar";

test("formats date-only values without a timezone shift", () => {
  expect(formatDate("2026-10-13")).toBe("October 13, 2026");
  expect(formatDate("0001-01-01")).toBe("January 1, 1");
  expect(isoDate(parseDate("2026-10-13")!)).toBe("2026-10-13");
  expect(formatDate("")).toBe("");
});

test("rejects invalid dates instead of rolling into another month", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "0000-01-01", "2026-1-01", "2026-10-13\n", "not a date"]) {
    expect(parseDate(value)).toBeNull();
    expect(formatDate(value)).toBe(value);
  }
  expect(parseDate("2024-02-29")).not.toBeNull();
});

test("month navigation clamps days and handles leap years and year changes", () => {
  expect(moveMonth("2026-01-31", 1)).toBe("2026-02-28");
  expect(moveMonth("2024-01-31", 1)).toBe("2024-02-29");
  expect(moveMonth("2026-12-31", 1)).toBe("2027-01-31");
  expect(moveMonth("2024-02-29", 12)).toBe("2025-02-28");
  expect(moveMonth("0001-01-01", -1)).toBe("0001-01-01");
  expect(moveMonth("9999-12-31", 1)).toBe("9999-12-31");
});

test("day navigation crosses month boundaries without changing date-only semantics", () => {
  expect(moveDay("2026-03-01", -1)).toBe("2026-02-28");
  expect(moveDay("2024-02-28", 1)).toBe("2024-02-29");
  expect(moveDay("2026-12-31", 1)).toBe("2027-01-01");
  expect(moveDay("0001-01-01", -1)).toBe("0001-01-01");
  expect(moveDay("9999-12-31", 1)).toBe("9999-12-31");
});

test("calendar grids align weekdays and include every actual day once", () => {
  const days = monthDays("2024-02-15");
  expect(days).toHaveLength(42);
  expect(days.slice(0, 4)).toEqual([null, null, null, null]);
  expect(days[4]).toEqual({ value: "2024-02-01", day: 1 });
  expect(days.filter(Boolean)).toHaveLength(29);
  expect(new Set(days.filter(Boolean).map(day => day!.value)).size).toBe(29);
  expect(monthDays("2026-02-01").filter(Boolean)).toHaveLength(28);
  expect(monthDays("invalid")).toEqual([]);
});

test("Today uses the local calendar date rather than a UTC conversion", () => {
  const date = new Date(2026, 9, 13, 0, 15);
  expect(todayDate(date)).toBe("2026-10-13");
});
