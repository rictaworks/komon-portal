import { DUE_CAUTION_DAYS, RETRIEVAL_CAUTION_DAYS } from "../cases/deadline-calculator";
import type { LocalDate } from "../model/types";
import { addDays } from "../time/local-date";

/** A published document with no client opening after this many days is shown as unread. */
export const UNREAD_AFTER_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function unreadCutoff(now: Date): Date {
  return new Date(now.getTime() - UNREAD_AFTER_DAYS * DAY_MS);
}

/** Submitted cases whose retrieval deadline falls on or before this day are shown on the dashboard. */
export function retrievalWindowEnd(today: LocalDate, retrievalDeadlineDays: number): LocalDate {
  return addDays(today, RETRIEVAL_CAUTION_DAYS - retrievalDeadlineDays);
}

/** Open cases due on or before this day are shown on the dashboard. */
export function dueWindowEnd(today: LocalDate): LocalDate {
  return addDays(today, DUE_CAUTION_DAYS);
}
