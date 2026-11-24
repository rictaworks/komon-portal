import { invalidInput } from "../model/errors";
import type { LocalDate } from "../model/types";

const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day of an instant in the given IANA time zone. */
export function localDateOf(instant: Date, timezone: string): LocalDate {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw invalidInput("timezone");
  }
  const parts = formatter.formatToParts(instant);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** Days since the epoch of a local date, validating that the date exists. */
function dayNumber(date: LocalDate): number {
  const match = SHAPE.exec(date);
  if (match === null) {
    throw invalidInput("local_date");
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw invalidInput("local_date");
  }
  return Math.round(time / DAY_MS);
}

export function isLocalDate(value: string): boolean {
  try {
    dayNumber(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: LocalDate, days: number): LocalDate {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return dayNumber(to) - dayNumber(from);
}
