import type { CaseRecord, LocalDate, OfficeSetting } from "../model/types";
import type { Clock } from "../ports/clock";
import { addDays, daysBetween, localDateOf } from "../time/local-date";
import { TERMINAL_CASE_STATES } from "./case-state";

export const DEADLINE_LEVELS = ["none", "ok", "caution", "warning", "expired"] as const;
export type DeadlineLevel = (typeof DEADLINE_LEVELS)[number];

export interface DeadlineStatus {
  level: DeadlineLevel;
  /** The deadline day, or null when no deadline applies. */
  deadline: LocalDate | null;
  /** Calendar days left; negative when the deadline has passed. Null when no deadline applies. */
  daysLeft: number | null;
}

export const RETRIEVAL_CAUTION_DAYS = 30;
export const RETRIEVAL_WARNING_DAYS = 10;
export const DUE_CAUTION_DAYS = 7;

const NO_DEADLINE: DeadlineStatus = { level: "none", deadline: null, daysLeft: null };

type DeadlineSetting = Pick<OfficeSetting, "timezone" | "retrievalDeadlineDays">;

/** Date comparisons for cases, in calendar days of the office time zone. Done in code, never by AI. */
export class DeadlineCalculator {
  constructor(private readonly clock: Clock) {}

  today(setting: Pick<OfficeSetting, "timezone">): LocalDate {
    return localDateOf(this.clock.now(), setting.timezone);
  }

  /** Deadline for retrieving the official document: submitted date plus the configured days, while nothing has arrived. */
  retrievalLevel(record: Pick<CaseRecord, "state" | "submittedOn">, setting: DeadlineSetting): DeadlineStatus {
    if (record.state !== "Submitted" || record.submittedOn === null) {
      return { ...NO_DEADLINE };
    }
    const deadline = addDays(record.submittedOn, setting.retrievalDeadlineDays);
    const daysLeft = daysBetween(this.today(setting), deadline);
    if (daysLeft < 0) {
      return { level: "expired", deadline, daysLeft };
    }
    if (daysLeft <= RETRIEVAL_WARNING_DAYS) {
      return { level: "warning", deadline, daysLeft };
    }
    return { level: daysLeft <= RETRIEVAL_CAUTION_DAYS ? "caution" : "ok", deadline, daysLeft };
  }

  /** Due date of the case itself. */
  dueLevel(record: Pick<CaseRecord, "state" | "dueOn">, setting: DeadlineSetting): DeadlineStatus {
    if (record.dueOn === null || TERMINAL_CASE_STATES.includes(record.state)) {
      return { ...NO_DEADLINE };
    }
    const daysLeft = daysBetween(this.today(setting), record.dueOn);
    if (daysLeft < 0) {
      return { level: "expired", deadline: record.dueOn, daysLeft };
    }
    return { level: daysLeft <= DUE_CAUTION_DAYS ? "caution" : "ok", deadline: record.dueOn, daysLeft };
  }
}
