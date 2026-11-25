import { useEffect, useState } from "react";
import { followDownload, openFile } from "../../api/client";
import type { CaseView, ClientRef, FileView } from "../../api/office-types";
import { ClientPicker } from "../../components/ClientPicker";
import { clientLabel } from "../../components/client-picker";
import { CheckField, SelectField } from "../../components/Form";
import { formatDateTime, formatMonth, formatSize } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { LIST_LIMIT, rowsOutside } from "./list-limit";
import { useSettings } from "./useMasterData";

const REASONS = ["ConflictingKeys", "MultipleArrivalNumbers", "NoKey", "HintMismatch", "ClientNotActive", "CaseCancelled", "DuplicateAcrossClients", "Withdrawn", "Restored", "SentBack"] as const;
const CONFIRM_REASONS: readonly string[] = ["DuplicateAcrossClients", "ConflictingKeys", "HintMismatch"];
const OPEN_CASE_STATES = "Open,Submitted,MaterialsReceived,DocumentReceived,Delivered,Confirmed";

function needsConfirmation(file: FileView): boolean {
  return (file.reviewReason !== null && CONFIRM_REASONS.includes(file.reviewReason)) || file.evidence.some((item) => item.kind === "ExistingCopy");
}

function Decision({ file, onDone }: { file: FileView; onDone(): void }) {
  const t = useT();
  const { api } = useSession();
  const settings = useSettings();
  const action = useAction();
  const [chosen, setChosen] = useState<ClientRef | null>(file.client);
  const clientId = chosen?.id ?? "";
  const [caseId, setCaseId] = useState("");
  const [docTypeId, setDocTypeId] = useState(file.docType?.id ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const cases = useLoad<CaseView[]>(
    async () => (clientId === "" ? [] : (await api.get<{ items: CaseView[] }>(`/api/office/cases?clientId=${clientId}&states=${OPEN_CASE_STATES}`)).items),
    [clientId],
  );
  const outbound = (settings.data?.docTypes ?? []).filter((type) => type.direction !== "Inbound");

  const assign = (): void => {
    void action
      .run(async () => {
        await api.post(`/api/office/files/${file.id}/assign`, { clientId, caseId: caseId === "" ? null : caseId, docTypeId: docTypeId === "" ? null : docTypeId, confirmed, version: file.version });
      })
      .then(() => onDone());
  };

  const trash = (): void => {
    void action.run(() => api.post(`/api/office/files/${file.id}/trash`, { version: file.version })).then(() => onDone());
  };

  const open = (): void => {
    void action.run(() => openFile(api, file.id, "view", followDownload));
  };

  return (
    <section className="card" aria-label={t("office.review.decision")}>
      <div className="banner">
        <span className="banner__label">{t("office.review.assigningTo")}</span>
        <span className="banner__code">{chosen?.code ?? t("office.review.noClient")}</span>
        <span className="banner__name">{chosen?.corporateName ?? ""}</span>
      </div>
      <div className="card--pad">
        <div className="stack stack--tight">
          <h2 className="subtitle">{file.displayName}</h2>
          <span className="muted">
            {file.format.toUpperCase()}, {formatSize(file.sizeBytes)}, {formatDateTime(file.receivedAt)}
          </span>
        </div>
        <Notice tone="review">
          <strong>{file.reviewReason === null ? "" : t(`reviewReason.${file.reviewReason}`)}</strong>
          {file.evidence.map((item, index) => (
            <div key={`${item.kind}-${index}`}>{t(`evidence.${item.kind}`, { client: item.client === null ? "" : `${item.client.code} ${item.client.corporateName}` })}</div>
          ))}
          {file.jev?.candidate ? <div>{t("office.review.jevCandidate", { type: file.jev.candidate.shortCode, confidence: (file.jev.confidence ?? 0).toFixed(2) })}</div> : null}
        </Notice>
        <ErrorNotice error={action.error} />
        <ClientPicker label={t("office.review.client")} emptyLabel={t("office.review.chooseClient")} value={chosen} onChange={(client) => { setChosen(client); setCaseId(""); setConfirmed(false); }} />
        <div className="grid2">
          <SelectField
            label={t("office.review.case")}
            value={caseId}
            options={[{ value: "", label: t("office.review.noCase") }, ...(cases.data ?? []).map((record) => ({ value: record.id, label: `${record.caseType?.label ?? ""} ${formatMonth(record.targetMonth)} #${record.sequence}` }))]}
            onChange={setCaseId}
          />
          <SelectField
            label={t("office.review.docType")}
            value={docTypeId}
            options={[{ value: "", label: t("office.unclassified") }, ...outbound.map((type) => ({ value: type.id, label: `${type.shortCode} ${type.label}` }))]}
            onChange={setDocTypeId}
          />
        </div>
        {needsConfirmation(file) ? (
          <CheckField checked={confirmed} onChange={setConfirmed}>
            {t("office.review.confirm", { client: chosen === null ? "" : clientLabel(chosen) })}
          </CheckField>
        ) : null}
        <div className="row">
          <button type="button" className="button button--primary" disabled={action.busy || clientId === "" || (needsConfirmation(file) && !confirmed)} onClick={assign}>
            {t("office.review.stage")}
          </button>
          <button type="button" className="button" disabled={action.busy} onClick={open}>
            {t("office.actions.open")}
          </button>
          <span className="grow" />
          <button type="button" className="button button--danger" disabled={action.busy} onClick={trash}>
            {t("office.actions.trash")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function Review() {
  const t = useT();
  const { api } = useSession();
  const [reason, setReason] = useState("");
  const [client, setClient] = useState<ClientRef | null>(null);
  const clientId = client?.id ?? "";
  const [selected, setSelected] = useState<string | null>(null);
  const files = useLoad<{ items: FileView[]; total: number }>(
    () => api.get<{ items: FileView[]; total: number }>(`/api/office/files?direction=Outbound&states=NeedsReview&limit=${LIST_LIMIT}${reason === "" ? "" : `&reviewReason=${reason}`}${clientId === "" ? "" : `&clientId=${clientId}`}`),
    [reason, clientId],
  );
  const rows = files.data?.items ?? null;
  // Rows the server holds beyond the list. They are not shown, so they cannot be opened from here.
  const outside = files.data === null || rows === null ? 0 : rowsOutside(rows.length, files.data.total);
  const current = rows?.find((file) => file.id === selected) ?? rows?.[0] ?? null;

  useEffect(() => {
    if (rows !== null && !rows.some((file) => file.id === selected)) {
      setSelected(rows[0]?.id ?? null);
    }
  }, [rows, selected]);

  return (
    <div className="page">
      <div className="row row--end">
        <h1 className="title grow">{t("office.review.title")}</h1>
        <SelectField label={t("office.review.reason")} value={reason} options={[{ value: "", label: t("office.review.allReasons") }, ...REASONS.map((value) => ({ value, label: t(`reviewReason.${value}`) }))]} onChange={setReason} />
        <ClientPicker label={t("office.columns.client")} emptyLabel={t("office.allClients")} value={client} onChange={setClient} status={null} compact />
      </div>
      <ErrorNotice error={files.error} />
      {outside === 0 || files.data === null ? null : <p className="muted">{t("office.shownOf", { shown: rows?.length ?? 0, total: files.data.total })}</p>}
      {files.loading && files.data === null ? <Loading /> : null}
      {rows !== null && rows.length === 0 ? <p className="card empty">{t("office.review.empty")}</p> : null}
      {current === null ? null : (
        <div className="split">
          <section className="card split__main" aria-label={t("office.review.list")}>
            <ul className="list">
              {(rows ?? []).map((file) => (
                <li key={file.id}>
                  <button type="button" className={`list__item list__button${file.id === current.id ? " list__button--selected" : ""}`} onClick={() => setSelected(file.id)}>
                    <span className="grow stack stack--tight">
                      <strong>{file.displayName}</strong>
                      <span className="muted">{formatDateTime(file.receivedAt)}</span>
                    </span>
                    <Badge tone="review" label={file.reviewReason === null ? "" : t(`reviewReason.${file.reviewReason}`)} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <div className="split__side">
            <Decision key={`${current.id}-${current.version}`} file={current} onDone={files.reload} />
          </div>
        </div>
      )}
    </div>
  );
}
