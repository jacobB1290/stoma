// src/utils/date.js

/**
 * One minute in milliseconds.
 */
export const MINUTE_MS = 60_000;

/**
 * One hour in milliseconds.
 */
export const HOUR_MS = 3_600_000;

/**
 * One day in milliseconds.
 */
export const DAY_MS = 86_400_000;

/**
 * Monday – Friday returns true.
 */
export function isWeekday(d) {
  return ![0, 6].includes(d.getDay());
}

/**
 * Add n days to a Date.
 */
export function addDays(d, n) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

/**
 * ISO helper used by Board.jsx
 * Returns "YYYY-MM-DD" for a Date object.
 */
export function iso(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Parse a date-string like "2025-06-01" or
 * "2025-06-01T00:00:00Z" into a **local-midnight**
 * Date object, ignoring any time-zone offset.
 */
export function parseLocalDate(dateStr) {
  const base = dateStr.split("T")[0]; // "YYYY-MM-DD"
  const [y, m, dd] = base.split("-").map(Number); // months 1-based
  return new Date(y, m - 1, dd); // months 0-based in JS
}

/**
 * Skip forward by n business days from a given date.
 * Returns a new Date object.
 */
export function addBusinessDays(d, n) {
  let current = new Date(d);
  let remaining = Math.abs(n);
  const direction = n >= 0 ? 1 : -1;

  while (remaining > 0) {
    current = addDays(current, direction);
    if (isWeekday(current)) {
      remaining--;
    }
  }

  return current;
}

/**
 * Get the start of the week (Monday) for a given date.
 */
export function getWeekStart(d) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Adjust to Monday
  date.setDate(date.getDate() + diff);
  return date;
}

/**
 * Count business days (Mon–Fri) strictly between two dates.
 *
 * Accepts either Date objects or ISO date strings ("YYYY-MM-DD" or
 * full ISO timestamps). Returns an integer count of weekdays that fall
 * AFTER `start` and ON OR BEFORE `end` — i.e. start-exclusive,
 * end-inclusive. Weekends (Saturday/Sunday) are never counted.
 *
 * Returns 0 when inputs are equal or when `end` precedes `start`, and
 * returns null when either input is missing or unparseable.
 */
export function businessDaysBetween(start, end) {
  if (start == null || end == null) return null;

  const toDate = (v) => {
    if (v instanceof Date) return new Date(v);
    if (typeof v === "string") {
      const [base] = v.split("T");
      const [y, m, d] = base.split("-").map(Number);
      if (y && m && d) return new Date(y, m - 1, d);
    }
    const parsed = new Date(v);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return null;
  if (e < s) return 0;

  let count = 0;
  const cursor = new Date(s);
  while (cursor < e) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}
