import { useState } from "react";
import { useParams } from "react-router-dom";
import { fileContentUrl } from "../../api/client";
import type { CaseView, ClientRecord, FileView } from "../../api/office-types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SelectField } from "../../components/Form";
import { formatDateTime } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge, FileStateBadge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

const TABS = ["Published", "Withdrawn", "Trashed"] as const;
type Tab = (typeof TABS)[number];
const WITHDRAW_REASONS = ["WrongClient", "WrongFile", "Superseded", "Other"] as const;
const WITHDRAW_NEXT = ["NeedsReview", "Trashed"] as const;

/** One client's shelf: published documents, withdrawn ones and the trash. The client is fixed on the banner. */
export function Shelf() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const [tab, setTab] = useState<Tab>("Published");
  const client = useLoad<ClientRecord>(() => api.get<ClientRecord>(`/api/office/clients/${clientId}`), [clientId]);
  const files = useLoad<{ items: FileView[]; total: number }>(
    () => api.get<{ items: FileView[]; total: number }>(`/api/office/files?direction=Outbound&clientId=${clientId}&states=${tab}&limit=200`),
    [clientId, tab],
  );
  const cases = useLoad<{ items: CaseView[] }>(() => api.get<{ items: CaseView[] }>(`/api/office/cases?clientId=${clientId}`), [clientId]);
  const action = useAction();
  const [withdrawing, setWithdrawing] = useState<FileView | null>(null);
  const [reason, setReason] = useState<string>(WITHDRAW_REASONS[0]);
  const [next, setNext] = useState<string>(WITHDRAW_NEXT[0]);
  const [linking, setLinking] = useState<FileView | null>(null);
  const [caseId, setCaseId] = useState("");

  const done = (ok: boolean) => {
    if (ok) {
      files.reload();
    }
  };

  const withdraw = () => {
    const target = withdrawing;
    setWithdrawing(null);
    if (target !== null) {
      void action.run(() => api.post(`/api/office/files/${target.id}/withdraw`, { reason, next, version: target.version })).then(done);
    }
  };

  const restore = (file: FileView) => () => {
    void action.run(() => api.post(`/api/office/files/${file.id}/restore`, { version: file.version })).then(done);
  };

  const trash = (file: FileView) => () => {
    void action.run(() => api.post(`/api/office/files/${file.id}/trash`, { version: file.version })).then(done);
  };

  const link = () => {
    const target = linking;
    if (target !== null) {
      void action
        .run(() => api.post(`/api/office/files/${target.id}/link-case`, { caseId: caseId === "" ? null : caseId, version: target.version }))
        .then((ok) => {
          if (ok) {
            setLinking(null);
            setCaseId("");
            files.reload();
          }
        });
    }
  };

  if (client.data === null) {
    return <div className="page">{client.error === null ? <Loading /> : <ErrorNotice error={client.error} />}</div>;
  }

  return (
    <div className="page">
      <div className="banner" role="status">
        <span className="banner__label">{t("office.shelf.fixedClient")}</span>
        <span className="banner__code">{client.data.code}</span>
        <span className="banner__name">{client.data.corporateName}</span>
      </div>
      <ErrorNotice error={files.error ?? action.error} />
      <nav className="tabs" aria-label={t("office.shelf.tabs")}>
        {TABS.map((value) => (
          <button key={value} type="button" className={`tab${tab === value ? " tab--active" : ""}`} aria-pressed={tab === value} onClick={() => setTab(value)}>
            {t(`office.shelf.tab.${value}`)}
          </button>
        ))}
      </nav>
      {files.data === null ? <Loading /> : null}
      {files.data !== null && files.data.items.length === 0 ? <p className="card empty">{t("office.shelf.empty")}</p> : null}
      <ul className="list card">
        {(files.data?.items ?? []).map((file) => (
          <li key={file.id} className="list__item stack stack--tight">
            <div className="row">
              <span className="grow stack stack--tight">
                <strong>{file.displayName}</strong>
                <span className="muted">
                  {file.docType?.label ?? t("office.unclassified")} · {formatDateTime(file.publishedAt ?? file.receivedAt)}
                </span>
              </span>
              <FileStateBadge state={file.state} />
              {file.caseId === null ? null : <Badge tone="neutral" label={t("office.shelf.linked")} />}
            </div>
            <div className="row">
              <span className="muted grow">
                {t("office.shelf.readers", { count: file.readers.length })}
                {file.readers.length === 0 ? "" : `: ${file.readers.map((reader) => reader.displayName ?? t("office.shelf.unnamedReader")).join(", ")}`}
              </span>
              <a className="button" href={fileContentUrl(file.id, "view")}>
                {t("office.actions.open")}
              </a>
              {tab === "Published" ? (
                <>
                  <button type="button" className="button" disabled={action.busy} onClick={() => setLinking(file)}>
                    {t("office.shelf.linkCase")}
                  </button>
                  <button type="button" className="button button--danger" disabled={action.busy} onClick={() => setWithdrawing(file)}>
                    {t("office.shelf.withdraw")}
                  </button>
                </>
              ) : null}
              {tab === "Withdrawn" ? (
                <button type="button" className="button" disabled={action.busy} onClick={trash(file)}>
                  {t("office.actions.trash")}
                </button>
              ) : null}
              {tab === "Trashed" ? (
                <button type="button" className="button" disabled={action.busy} onClick={restore(file)}>
                  {t("office.shelf.restore")}
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {linking === null ? null : (
        <section className="card card--pad stack" aria-label={t("office.shelf.linkCase")}>
          <SelectField
            label={t("office.review.case")}
            value={caseId}
            options={[{ value: "", label: t("office.review.noCase") }, ...(cases.data?.items ?? []).map((record) => ({ value: record.id, label: `${record.caseType?.label ?? ""} #${record.sequence}` }))]}
            onChange={setCaseId}
          />
          <div className="row">
            <button type="button" className="button button--primary" disabled={action.busy} onClick={link}>
              {t("office.shelf.linkAction")}
            </button>
            <button type="button" className="button" onClick={() => setLinking(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        title={t("office.shelf.withdrawTitle")}
        confirmLabel={t("office.shelf.withdrawConfirm")}
        danger
        onConfirm={withdraw}
        onCancel={() => setWithdrawing(null)}
      >
        <Notice tone="review">{t("office.shelf.withdrawNote")}</Notice>
        <SelectField label={t("office.shelf.reason")} value={reason} options={WITHDRAW_REASONS.map((value) => ({ value, label: t(`withdrawReason.${value}`) }))} onChange={setReason} />
        <SelectField label={t("office.shelf.next")} value={next} options={WITHDRAW_NEXT.map((value) => ({ value, label: t(`withdrawNext.${value}`) }))} onChange={setNext} />
      </ConfirmDialog>
    </div>
  );
}
