import { faBan, faCircleCheck, faCircleInfo, faTriangleExclamation, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { hasMessage, englishMessages, useT, type Translator } from "../i18n";
import { Icon } from "./Icon";

export type NoticeTone = "danger" | "review" | "info" | "success";

const ICONS: Readonly<Record<NoticeTone, IconDefinition>> = {
  danger: faBan,
  review: faTriangleExclamation,
  info: faCircleInfo,
  success: faCircleCheck,
};

export function Notice({ tone, children }: { tone: NoticeTone; children: ReactNode }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "danger" ? "alert" : "status"}>
      <Icon icon={ICONS[tone]} />
      <div className="grow">{children}</div>
    </div>
  );
}

/**
 * Text for an API error code. The most specific message is used: code and detail, then code.
 * A code without a message is shown as such, with the code, so nothing fails silently.
 */
export function errorText(t: Translator, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t("errors.unexpected");
  }
  const specific = error.detail === null ? null : `errors.${error.code}.${error.detail}`;
  if (specific !== null && hasMessage(englishMessages(), specific)) {
    return t(specific);
  }
  const general = `errors.${error.code}._`;
  if (hasMessage(englishMessages(), general)) {
    return t(general);
  }
  return t("errors.unknown", { code: error.detail === null ? error.code : `${error.code}/${error.detail}` });
}

export function ErrorNotice({ error }: { error: unknown }) {
  const t = useT();
  return error === null || error === undefined ? null : <Notice tone="danger">{errorText(t, error)}</Notice>;
}

/** Shown on every screen where files are handed in (instructions.md 1.4). */
export function IndividualNumberNotice() {
  const t = useT();
  return <Notice tone="danger">{t("common.individualNumberNotice")}</Notice>;
}
