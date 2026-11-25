import { useState, type FormEvent } from "react";
import type { CaseView } from "../../api/office-types";
import { SelectField, TextField } from "../../components/Form";
import { formatDay, formatMonth } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { CaseStateBadge, DeadlineBadge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { clientOptions, useClients, useSettings } from "./useMasterData";

/** Cases: register, submit with arrival numbers, close or cancel. */
export function Cases() {
  const t = useT();
  const { api } = useSession();
  const cases = useLoad<{ items: CaseView[] }>(() => api.get<{ items: CaseView[] }>("/api/office/cases"), []);
  const clients = useClients();
  const settings = useSettings();
  const action = useAction();
  const [clientId, setClientId] = useState("");
  const [caseTypeId, setCaseTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [submittedOn, setSubmittedOn] = useState("");
  const [arrivalText, setArrivalText] = useState("");

  const register = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post<CaseView>("/api/office/cases", { clientId, caseTypeId, targetMonth, referenceCode, dueOn: dueOn === "" ? undefined : dueOn });
      setReferenceCode("");
      cases.reload();
    });
  };

  const submit = (record: CaseView) => {
    const arrivalNumbers = arrivalText
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value !== "");
    void action
      .run(async () => {
        await api.post<CaseView>(`/api/office/cases/${record.id}/submit`, { submittedOn, arrivalNumbers });
      })
      .then((ok) => {
        if (ok) {
          setSubmitting(null);
          setArrivalText("");
          cases.reload();
        }
      });
  };

  const transition = (record: CaseView, verb: "close" | "cancel") => () => {
    void action.run(() => api.post(`/api/office/cases/${record.id}/${verb}`, { version: record.version })).then(() => cases.reload());
  };

  const visible = (cases.data?.items ?? []).filter((record) => stateFilter === "" || record.state === stateFilter);

  return (
    <div className="page">
      <h1 className="title">{t("office.cases.title")}</h1>
      <ErrorNotice error={cases.error ?? action.error} />
      <div className="split">
        <section className="card split__main" aria-label={t("office.cases.list")}>
          <div className="card__head">
            <SelectField label={t("office.cases.state")} value={stateFilter} options={[{ value: "", label: t("office.cases.allStates") }, ...["Open", "Submitted", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed", "Closed", "Cancelled"].map((value) => ({ value, label: t(`caseState.${value}`) }))]} onChange={setStateFilter} />
          </div>
          {cases.loading && cases.data === null ? <Loading /> : null}
          {cases.data !== null && visible.length === 0 ? <p className="empty">{t("office.cases.empty")}</p> : null}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("office.columns.client")}</th>
                  <th>{t("office.columns.case")}</th>
                  <th>{t("office.cases.month")}</th>
                  <th>{t("office.columns.result")}</th>
                  <th>{t("office.columns.deadline")}</th>
                  <th>{t("office.actions.open")}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <span className="code">{record.client?.code ?? ""}</span> {record.client?.corporateName ?? ""}
                    </td>
                    <td>
                      {record.caseType?.label ?? ""} #{record.sequence} <span className="muted">{record.referenceCode}</span>
                    </td>
                    <td>{formatMonth(record.targetMonth)}</td>
                    <td>
                      <CaseStateBadge state={record.state} />
                    </td>
                    <td>
                      <DeadlineBadge level={record.due.level} daysLeft={record.due.daysLeft} />
                      {record.due.deadline === null ? null : <span className="muted"> {formatDay(record.due.deadline)}</span>}
                    </td>
                    <td className="row">
                      {record.state === "Open" ? (
                        <button type="button" className="button" disabled={action.busy} onClick={() => setSubmitting(record.id)}>
                          {t("office.cases.submit")}
                        </button>
                      ) : null}
                      {record.state === "Open" || record.state === "Submitted" ? (
                        <button type="button" className="button" disabled={action.busy} onClick={transition(record, "cancel")}>
                          {t("office.cases.cancel")}
                        </button>
                      ) : null}
                      {record.state === "Confirmed" ? (
                        <button type="button" className="button" disabled={action.busy} onClick={transition(record, "close")}>
                          {t("office.cases.close")}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {submitting === null ? null : (
            <div className="card--pad stack">
              <h2 className="subtitle">{t("office.cases.submitTitle")}</h2>
              <Notice tone="info">{t("office.cases.submitNote")}</Notice>
              <TextField label={t("office.cases.submittedOn")} type="date" value={submittedOn} onChange={setSubmittedOn} />
              <TextField label={t("office.cases.arrivalNumbers")} value={arrivalText} onChange={setArrivalText} mono hint={t("office.cases.arrivalHint")} />
              <div className="row">
                <button
                  type="button"
                  className="button button--primary"
                  disabled={action.busy || submittedOn === ""}
                  onClick={() => {
                    const record = (cases.data?.items ?? []).find((entry) => entry.id === submitting);
                    if (record !== undefined) {
                      submit(record);
                    }
                  }}
                >
                  {t("office.cases.submitAction")}
                </button>
                <button type="button" className="button" onClick={() => setSubmitting(null)}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </section>
        <form className="card card--pad split__side stack" onSubmit={register} aria-label={t("office.cases.register")}>
          <h2 className="subtitle">{t("office.cases.register")}</h2>
          <SelectField label={t("office.columns.client")} value={clientId} options={[{ value: "", label: t("office.review.chooseClient") }, ...clientOptions(clients.data)]} onChange={setClientId} />
          <SelectField label={t("office.cases.caseType")} value={caseTypeId} options={[{ value: "", label: t("office.cases.chooseCaseType") }, ...(settings.data?.caseTypes ?? []).map((type) => ({ value: type.id, label: type.label }))]} onChange={setCaseTypeId} />
          <TextField label={t("office.cases.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
          <TextField label={t("office.cases.referenceCode")} value={referenceCode} onChange={setReferenceCode} mono hint={t("office.cases.referenceHint")} />
          <TextField label={t("office.cases.dueOn")} type="date" value={dueOn} onChange={setDueOn} />
          <button type="submit" className="button button--primary" disabled={action.busy || clientId === "" || caseTypeId === "" || targetMonth === "" || referenceCode === ""}>
            {t("office.cases.registerAction")}
          </button>
        </form>
      </div>
    </div>
  );
}
