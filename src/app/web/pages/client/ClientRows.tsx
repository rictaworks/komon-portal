import { faDownload, faEye, faFileLines, faXmark } from "@fortawesome/free-solid-svg-icons";
import { Link } from "react-router-dom";
import type { OpenMode } from "../../api/client";
import type { ClientCase, ClientDocument, DocTypeRef, Submission } from "../../api/client-types";
import { formatDate, formatDateTime, formatMonth, formatSize } from "../../components/format";
import { Icon } from "../../components/Icon";
import { errorText } from "../../components/Notice";
import { Badge, CaseStateBadge, FileStateBadge, ReadBadge } from "../../components/StatusBadge";
import { useT, type Translator } from "../../i18n";
import type { SendOutcome } from "./client-lists";

function typeLabel(t: Translator, docType: DocTypeRef | null): string {
  return docType === null ? t("client.home.unknownType") : docType.label;
}

/** The target month in words. A file without one says so. */
function monthLabel(t: Translator, targetMonth: string | null): string {
  return targetMonth === null ? t("client.documents.noMonth") : formatMonth(targetMonth);
}

/** Heading of the home page: the new documents come first, with how many there are in all. */
export function NewDocumentsHeading({ count }: { count: number }) {
  const t = useT();
  return (
    <h1 className="subtitle subtitle--lead">
      {t("client.home.newDocuments")} <span className="count">{count}</span>
    </h1>
  );
}

/** One unread document on the home page. It leads to the documents list, where it is opened. */
export function UnreadRow({ clientId, document }: { clientId: string; document: ClientDocument }) {
  const t = useT();
  return (
    <Link className="card unread" to={`/client/${clientId}/documents`}>
      <span className="unread__icon">
        <Icon icon={faFileLines} />
      </span>
      <span className="grow stack stack--tight">
        <strong>{typeLabel(t, document.docType)}</strong>
        <span className="muted">{t("client.documents.meta", { month: monthLabel(t, document.targetMonth), date: formatDate(document.publishedAt) })}</span>
      </span>
      <ReadBadge opened={document.opened} />
    </Link>
  );
}

/** One case of the company: its type, kind, target month and state, and nothing else. */
export function CaseRow({ record }: { record: ClientCase }) {
  const t = useT();
  return (
    <>
      <span className="grow stack stack--tight">
        <strong>{record.typeLabel}</strong>
        <span className="muted">{t("client.home.caseMeta", { kind: t(`caseKind.${record.kind}`), month: formatMonth(record.targetMonth) })}</span>
      </span>
      <CaseStateBadge state={record.state} />
    </>
  );
}

export interface DocumentCardProps {
  document: ClientDocument;
  busy: boolean;
  onOpen(document: ClientDocument, mode: OpenMode): void;
}

/** One published document with the ways to open it. */
export function DocumentCard({ document, busy, onOpen }: DocumentCardProps) {
  const t = useT();
  return (
    <article className="card card--pad">
      <div className="row row--top row--nowrap">
        <span className="grow stack stack--tight">
          <strong>{typeLabel(t, document.docType)}</strong>
          <span className="muted">{t("client.documents.meta", { month: monthLabel(t, document.targetMonth), date: formatDate(document.publishedAt) })}</span>
          <span className="muted mono wrap">{document.displayName}</span>
        </span>
        <ReadBadge opened={document.opened} />
      </div>
      <div className="row">
        <button type="button" className="button grow" disabled={busy} onClick={() => onOpen(document, "view")}>
          <Icon icon={faEye} />
          {t("client.documents.view")}
        </button>
        <button type="button" className="button button--primary grow" disabled={busy} onClick={() => onOpen(document, "download")}>
          <Icon icon={faDownload} />
          {t("client.documents.download")}
        </button>
      </div>
    </article>
  );
}

export interface SubmissionCardProps {
  submission: Submission;
  busy: boolean;
  onCancel(submission: Submission): void;
}

/** One file the company has sent, with whether the office has confirmed it. */
export function SubmissionCard({ submission, busy, onCancel }: SubmissionCardProps) {
  const t = useT();
  return (
    <article className="card card--pad">
      <div className="row row--top row--nowrap">
        <span className="grow stack stack--tight">
          <strong>{typeLabel(t, submission.docType)}</strong>
          <span className="muted">{t("client.send.meta", { month: monthLabel(t, submission.targetMonth), date: formatDateTime(submission.submittedAt) })}</span>
          <span className="muted mono wrap">{submission.displayName}</span>
        </span>
        <FileStateBadge state={submission.state} />
      </div>
      {submission.canCancel ? (
        <button type="button" className="button button--danger" disabled={busy} onClick={() => onCancel(submission)}>
          {t("client.send.cancel")}
        </button>
      ) : null}
      {submission.acknowledgedAt === null ? null : <span className="muted">{t("client.send.confirmed", { date: formatDateTime(submission.acknowledgedAt) })}</span>}
    </article>
  );
}

/** A file chosen to send, as its row shows it. */
export interface ChosenRowFile {
  key: string;
  /** The number the file was given when it was chosen. Its result row shows the same number. */
  number: number;
  size: number;
}

export interface ChosenFilesProps {
  files: readonly ChosenRowFile[];
  busy: boolean;
  onRemove(key: string): void;
}

/** The files chosen to send. Each keeps its number, so a file still chosen after a send keeps the number of its result. */
export function ChosenFiles({ files, busy, onRemove }: ChosenFilesProps) {
  const t = useT();
  return (
    <ul className="list card" aria-label={t("client.send.chosen")}>
      {files.map((item) => (
        <li key={item.key} className="list__item">
          <span className="grow stack stack--tight">
            <strong>{t("client.send.fileNumber", { number: item.number })}</strong>
            <span className="muted">{formatSize(item.size)}</span>
          </span>
          <button type="button" className="button button--small" disabled={busy} onClick={() => onRemove(item.key)}>
            <Icon icon={faXmark} />
            {t("client.send.remove")}
          </button>
        </li>
      ))}
    </ul>
  );
}

export interface SendRow {
  key: string;
  /** The number the file was given when it was chosen, as on its chosen row. The file's own name is not shown: it may name an employee. */
  position: number;
  size: number;
  outcome: SendOutcome;
}

function sendReason(t: Translator, outcome: SendOutcome): string {
  switch (outcome.outcome) {
    case "stored":
      return t("client.send.storedReason");
    case "duplicate":
      return outcome.existingDisplayName ? t("client.send.duplicateOf", { name: outcome.existingDisplayName }) : t("client.send.duplicate");
    case "rejected":
      if (outcome.reason === undefined) {
        throw new Error("a rejected file carries no reason");
      }
      return t("client.send.rejected", { reason: t(`rejection.${outcome.reason}`) });
    case "failed":
      return errorText(t, outcome.error);
  }
}

/** The existing copy a duplicate points to, when the member may open it. */
function existingFileOf(outcome: SendOutcome): string | null {
  return outcome.outcome === "duplicate" && outcome.existingFileId ? outcome.existingFileId : null;
}

/** The link to the existing copy of a duplicate; nothing when the member may not open it. */
function ExistingCopy({ outcome, busy, onOpen }: { outcome: SendOutcome; busy: boolean; onOpen(fileId: string): void }) {
  const t = useT();
  const fileId = existingFileOf(outcome);
  if (fileId === null) {
    return null;
  }
  return (
    <button type="button" className="button button--small" disabled={busy} onClick={() => onOpen(fileId)}>
      <Icon icon={faFileLines} />
      {t("client.send.openExisting")}
    </button>
  );
}

function SendBadge({ outcome }: { outcome: SendOutcome }) {
  const t = useT();
  if (outcome.outcome === "stored") {
    return <Badge tone="published" label={t("client.send.result.stored")} />;
  }
  return <Badge tone={outcome.outcome === "duplicate" ? "neutral" : "danger"} label={t("client.send.result.notSent")} />;
}

export interface SendResultsProps {
  rows: readonly SendRow[];
  /** Opens the existing copy a duplicate points to. Called only for a file the member may open. */
  onOpenExisting(fileId: string): void;
  busy: boolean;
}

/** The result of the last send, one line per file with its reason. Never a single "done". */
export function SendResults({ rows, onOpenExisting, busy }: SendResultsProps) {
  const t = useT();
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="card" aria-label={t("client.send.results")}>
      <div className="card__head">
        <h2 className="subtitle">{t("client.send.results")}</h2>
      </div>
      <ul className="list">
        {rows.map((row) => (
          <li key={row.key} className="list__item list__item--top">
            <span className="grow stack stack--tight">
              <strong>{t("client.send.fileNumber", { number: row.position })}</strong>
              <span className="muted">{formatSize(row.size)}</span>
              <span className="muted">{sendReason(t, row.outcome)}</span>
              <ExistingCopy outcome={row.outcome} busy={busy} onOpen={onOpenExisting} />
            </span>
            <SendBadge outcome={row.outcome} />
          </li>
        ))}
      </ul>
    </section>
  );
}
