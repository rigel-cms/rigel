const display = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
export const months = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, month, 1))));

export function isoDate(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return null;
  const date = new Date(0);
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCFullYear(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  return isoDate(date) === value ? date : null;
}

export function formatDate(value: string): string {
  const date = parseDate(value);
  return date ? display.format(date) : value;
}

export function todayDate(date = new Date()): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function moveMonth(value: string, delta: number): string {
  const date = parseDate(value);
  if (!date) return value;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + delta);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  const last = new Date(date);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, last.getUTCDate()));
  return isoDate(date);
}

export function moveDay(value: string, delta: number): string {
  const date = parseDate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? value : isoDate(date);
}

export function monthDays(value: string): ({ value: string; day: number } | null)[] {
  const date = parseDate(value);
  if (!date) return [];
  date.setUTCDate(1);
  const offset = date.getUTCDay(), month = date.getUTCMonth();
  return Array.from({ length: 42 }, (_, index) => {
    const cell = new Date(date);
    cell.setUTCDate(index - offset + 1);
    return cell.getUTCMonth() === month ? { value: isoDate(cell), day: cell.getUTCDate() } : null;
  });
}
