import {
  faBan, faCircleCheck, faCircleInfo, faClock, faTriangleExclamation, type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { useT } from "../i18n";
import { Icon } from "./Icon";

export type BadgeTone = "published" | "staged" | "review" | "danger" | "neutral" | "solid";

const TONE_ICON: Readonly<Record<BadgeTone, IconDefinition>> = {
  published: faCircleCheck,
  staged: faClock,
  review: faTriangleExclamation,
  danger: faBan,
  neutral: faCircleInfo,
  solid: faCircleInfo,
};

/** A state shown with colour, word and icon together, never by colour alone. */
export function Badge({ tone, label }: { tone: BadgeTone; label: string }) {
  return (
    <span className={`badge badge--${tone}`}>
      <Icon icon={TONE_ICON[tone]} />
      {label}
    </span>
  );
}

const FILE_TONE: Readonly<Record<string, BadgeTone>> = {
  Published: "published",
  Staged: "staged",
  NeedsReview: "review",
  Withdrawn: "danger",
  Trashed: "danger",
  Submitted: "staged",
  Acknowledged: "published",
};

export function FileStateBadge({ state }: { state: string }) {
  const t = useT();
  return <Badge tone={FILE_TONE[state] ?? "neutral"} label={t(`fileState.${state}`)} />;
}

const CASE_TONE: Readonly<Record<string, BadgeTone>> = {
  Open: "neutral",
  Submitted: "neutral",
  MaterialsReceived: "staged",
  DocumentReceived: "staged",
  Delivered: "published",
  Confirmed: "published",
  Closed: "neutral",
  Cancelled: "danger",
};

export function CaseStateBadge({ state }: { state: string }) {
  const t = useT();
  return <Badge tone={CASE_TONE[state] ?? "neutral"} label={t(`caseState.${state}`)} />;
}

const DEADLINE_TONE: Readonly<Record<string, BadgeTone>> = { ok: "neutral", caution: "review", warning: "danger", expired: "danger" };

/** Deadline level with the number of days. Renders nothing when no deadline applies. */
export function DeadlineBadge({ level, daysLeft }: { level: string; daysLeft: number | null }) {
  const t = useT();
  if (level === "none" || daysLeft === null) {
    return null;
  }
  return <Badge tone={DEADLINE_TONE[level] ?? "neutral"} label={t(`deadline.${level}`, { days: Math.abs(daysLeft) })} />;
}
