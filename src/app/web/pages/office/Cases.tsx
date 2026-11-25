import { useState, type FormEvent } from "react";
import type { CaseList, CaseView } from "../../api/office-types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SelectField, TextField } from "../../components/Form";
import { formatDay } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { CaseStateBadge, DeadlineBadge } from "../../components/StatusBadge";
import { useAction, type Action } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { clientOptions, useClients, useSettings } from "./useMasterData";

const CASE_KINDS = ["Procedure", "Payroll", "Other"] as const;
/** Every state a case can still move on from; "Closed" and "Cancelled" are final (instructions.md 6.3). */
const OPEN_STATES = ["Open", "Submitted", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed"] as const;
const TERMINAL_STATES: readonly string[] = ["Closed", "Cancelled"];
/** States from which a case may be cancelled, as in the core rule CANCELLABLE_CASE_STATES. */
const CANCELLABLE_STATES: readonly string[] = ["Open", "Submitted", "MaterialsReceived"];
const OPEN_FILTER = "open";
const ALL_FILTER = "all";
/** The second step depends on the kind: only a payroll case waits for materials from the client. */
const PAYROLL_STEPS = ["Open", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed"] as const;
const DEFAULT_STEPS = ["Open", "Submitted", "DocumentReceived", "Delivered", "Confirmed"] as const;

function listPath(clientCode: string, kind: string, stateFilter: string): string {
  const query = new URLSearchParams();
  if (clientCode !== "") query.set("clientCode", clientCode);
  if (kind !== "") query.set("kind", kind);
  if (stateFilter === OPEN_FILTER) {
    query.set("states", OPEN_STATES.join(","));
  } else if (stateFilter !== ALL_FILTER) {
    query.set("states", stateFilter);
  }
  const text = query.toString();
  return text === "" ? "/api/office/cases" : `/api/office/cases?${text}`;
}

function caseName(record: CaseView): string {
  return `${record.caseType?.label ?? ""} ${record.targetMonth} #${record.sequence}`;
}

/** The retrieval deadline of the official document, or why none applies. */
function RetrievalCell({ record }: { record: CaseView }) {
  const t = useT();
  if (record.retrieval.level !== "none") {
    return (
      <>
        <DeadlineBadge level={record.retrieval.level} daysLeft={record.retrieval.daysLeft} />
        <span className="muted"> {formatDay(record.retrieval.deadline)}</span>
      </>
    );
  }
  if (record.caseType?.kind !== "Procedure" || TERMINAL_STATES.includes(record.state)) {
    return <span className="muted">{t("office.cases.notApplicable")}</span>;
  }
  return <span className="muted">{t(record.submittedOn === null ? "office.cases.notSubmitted" : "office.cases.retrieved")}</span>;
}

function Steps({ record }: { record: CaseView }) {
  const t = useT();
  const steps: readonly string[] = record.caseType?.kind === "Payroll" ? PAYROLL_STEPS : DEFAULT_STEPS;
  // A closed or cancelled case is on no step: its progress before the end is not recorded.
  const current = steps.indexOf(record.state);
  return (
    <ol className="steps" aria-label={t("office.cases.steps")}>
      {steps.map((step, index) => (
        <li key={step} className={`step${index < current ? " step--done" : ""}${index === current ? " step--current" : ""}`} aria-current={index === current ? "step" : undefined}>
          <span className="step__number">{index + 1}</span>
          <span>{t(`caseState.${step}`)}</span>
          {step === "Submitted" && record.submittedOn !== null ? <span className="step__note">{formatDay(record.submittedOn)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

interface CaseDetailProps {
  record: CaseView;
  action: Action;
  onChanged(): void;
}

/** The selected case: progress, submission data and the three manual steps (submit, close, cancel). */
function CaseDetail({ record, action, onChanged }: CaseDetailProps) {
  const t = useT();
  const { api } = useSession();
  const [submittedOn, setSubmittedOn] = useState(record.submittedOn ?? "");
  const [arrivalText, setArrivalText] = useState("");
  const [confirming, setConfirming] = useState<"close" | "cancel" | null>(null);
  const terminal = TERMINAL_STATES.includes(record.state);
  const arrivalNumbers = record.arrivalNumbers ?? [];

  const saveSubmission = (event: FormEvent) => {
    event.preventDefault();
    const added = arrivalText
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => value !== "");
    void action
      .run(async () => {
        await api.post<CaseView>(`/api/office/cases/${record.id}/submit`, { submittedOn, arrivalNumbers: added, version: record.version });
      })
      .then(onChanged);
  };

  const transition = (verb: "close" | "cancel") => {
    setConfirming(null);
    void action
      .run(async () => {
        await api.post<CaseView>(`/api/office/cases/${record.id}/${verb}`, { version: record.version });
      })
      .then(onChanged);
  };

  return (
    <>
      <div className="banner">
        <strong className="banner__code">{record.client?.code ?? ""}</strong>
        <span className="banner__name">{record.client?.corporateName ?? ""}</span>
        <span className="banner__label">
          {caseName(record)} <span className="mono">{record.referenceCode}</span>
        </span>
      </div>
      <div className="card--pad">
        <div className="row">
          <CaseStateBadge state={record.state} />
          <span className="muted">
            {t("office.cases.assignee")}: {record.assignee === null ? t("office.cases.unassigned") : (record.assignee.displayName ?? "")}
          </span>
          <span className="muted">
            {t("office.cases.due")}: {record.dueOn === null ? t("common.none") : formatDay(record.dueOn)}
          </span>
        </div>
        <Steps record={record} />
        <dl className="facts">
          <div className="facts__item">
            <dt>{t("office.cases.submittedOn")}</dt>
            <dd>{record.submittedOn === null ? t("office.cases.notSubmitted") : formatDay(record.submittedOn)}</dd>
          </div>
          <div className="facts__item">
            <dt>{t("office.cases.retrieval")}</dt>
            <dd>
              <RetrievalCell record={record} />
            </dd>
          </div>
          <div className="facts__item">
            <dt>{t("office.cases.arrivalNumbers")}</dt>
            <dd>
              {arrivalNumbers.length === 0 ? (
                t("office.cases.noArrivals")
              ) : (
                <ul className="facts__list">
                  {arrivalNumbers.map((value) => (
                    <li key={value} className="mono">
                      {value}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
        {record.caseType?.kind === "Procedure" && !terminal ? (
          <form className="stack" onSubmit={saveSubmission} aria-label={t("office.cases.saveSubmission")}>
            <Notice tone="info">{t("office.cases.submitNote")}</Notice>
            <div className="row row--top">
              <TextField label={t("office.cases.submittedOn")} type="date" value={submittedOn} onChange={setSubmittedOn} />
              <div className="grow">
                <TextField label={t("office.cases.addArrivalNumbers")} value={arrivalText} onChange={setArrivalText} mono hint={t("office.cases.arrivalHint")} />
              </div>
            </div>
            <div className="row">
              <button type="submit" className="button button--primary" disabled={action.busy || submittedOn === ""}>
                {t("office.cases.saveSubmission")}
              </button>
            </div>
          </form>
        ) : null}
        {terminal ? null : (
          <div className="row">
            <button type="button" className="button" disabled={action.busy} onClick={() => setConfirming("close")}>
              {t("office.cases.close")}
            </button>
            {CANCELLABLE_STATES.includes(record.state) ? (
              <button type="button" className="button button--danger" disabled={action.busy} onClick={() => setConfirming("cancel")}>
                {t("office.cases.cancel")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      <ConfirmDialog open={confirming === "close"} title={t("office.cases.closeTitle")} confirmLabel={t("office.cases.close")} onConfirm={() => transition("close")} onCancel={() => setConfirming(null)}>
        <p>{t("office.cases.closeLead")}</p>
      </ConfirmDialog>
      <ConfirmDialog open={confirming === "cancel"} title={t("office.cases.cancelTitle")} confirmLabel={t("office.cases.cancel")} danger onConfirm={() => transition("cancel")} onCancel={() => setConfirming(null)}>
        <p>{t("office.cases.cancelLead")}</p>
      </ConfirmDialog>
    </>
  );
}

/** Cases: search and narrow the list, register, record the submission, close or cancel. */
export function Cases() {
  const t = useT();
  const { api } = useSession();
  const [codeInput, setCodeInput] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [stateFilter, setStateFilter] = useState(OPEN_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const cases = useLoad<CaseList>(() => api.get<CaseList>(listPath(clientCode, kindFilter, stateFilter)), [clientCode, kindFilter, stateFilter]);
  const detail = useLoad<CaseView | null>(() => (selectedId === null ? Promise.resolve(null) : api.get<CaseView>(`/api/office/cases/${selectedId}`)), [selectedId]);
  const clients = useClients();
  const settings = useSettings();
  const action = useAction();
  const [clientId, setClientId] = useState("");
  const [caseTypeId, setCaseTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");

  const search = (event: FormEvent) => {
    event.preventDefault();
    setClientCode(codeInput.trim());
  };

  const register = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const created = await api.post<CaseView>("/api/office/cases", {
        clientId,
        caseTypeId,
        targetMonth,
        referenceCode,
        assigneeId: assigneeId === "" ? undefined : assigneeId,
        dueOn: dueOn === "" ? undefined : dueOn,
      });
      setReferenceCode("");
      setSelectedId(created.id);
      cases.reload();
    });
  };

  const reloadAll = () => {
    cases.reload();
    detail.reload();
  };

  const items = cases.data?.items ?? [];
  const selected = selectedId === null || detail.data === null || detail.data.id !== selectedId ? null : detail.data;
  const stateOptions = [
    { value: OPEN_FILTER, label: t("office.cases.openCases") },
    { value: ALL_FILTER, label: t("office.cases.allStates") },
    ...[...OPEN_STATES, ...TERMINAL_STATES].map((value) => ({ value, label: t(`caseState.${value}`) })),
  ];

  return (
    <div className="page">
      <h1 className="title">{t("office.cases.title")}</h1>
      <ErrorNotice error={cases.error ?? detail.error ?? action.error} />
      <div className="split">
        <div className="split__main stack">
          <section className="card" aria-label={t("office.cases.list")}>
            <form className="card__head card__head--end" role="search" onSubmit={search}>
              <TextField label={t("office.cases.clientCode")} type="search" value={codeInput} onChange={setCodeInput} narrow mono />
              <button type="submit" className="button">
                {t("office.cases.search")}
              </button>
              <SelectField label={t("office.cases.kind")} value={kindFilter} options={[{ value: "", label: t("office.cases.allKinds") }, ...CASE_KINDS.map((value) => ({ value, label: t(`caseKind.${value}`) }))]} onChange={setKindFilter} />
              <SelectField label={t("office.cases.state")} value={stateFilter} options={stateOptions} onChange={setStateFilter} />
            </form>
            {cases.loading && cases.data === null ? <Loading /> : null}
            {cases.data !== null && items.length === 0 ? <p className="empty">{t("office.cases.empty")}</p> : null}
            <div className="table-wrap">
              <table className="table table--wide">
                <thead>
                  <tr>
                    <th>{t("office.actions.open")}</th>
                    <th>{t("office.columns.client")}</th>
                    <th>{t("office.columns.case")}</th>
                    <th>{t("office.cases.reference")}</th>
                    <th>{t("office.cases.state")}</th>
                    <th>{t("office.cases.due")}</th>
                    <th>{t("office.cases.retrieval")}</th>
                    <th>{t("office.cases.submittedOn")}</th>
                    <th>{t("office.cases.assignee")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((record) => (
                    <tr key={record.id} className={record.id === selectedId ? "table__row--selected" : undefined}>
                      <td>
                        <button type="button" className="button" aria-pressed={record.id === selectedId} onClick={() => setSelectedId(record.id)}>
                          {t("office.actions.open")}
                        </button>
                      </td>
                      <td>
                        <span className="code">{record.client?.code ?? ""}</span> {record.client?.corporateName ?? ""}
                      </td>
                      <td>{caseName(record)}</td>
                      <td className="mono">{record.referenceCode}</td>
                      <td>
                        <CaseStateBadge state={record.state} />
                      </td>
                      <td>
                        <DeadlineBadge level={record.due.level} daysLeft={record.due.daysLeft} />
                        {record.dueOn === null ? null : <span className="muted"> {formatDay(record.dueOn)}</span>}
                      </td>
                      <td>
                        <RetrievalCell record={record} />
                      </td>
                      <td>{formatDay(record.submittedOn)}</td>
                      <td>{record.assignee === null ? <span className="muted">{t("office.cases.unassigned")}</span> : (record.assignee.displayName ?? "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="card" aria-label={t("office.cases.detail")}>
            {selectedId === null ? <p className="empty">{t("office.cases.chooseCase")}</p> : null}
            {selectedId !== null && selected === null && detail.loading ? <Loading /> : null}
            {selected === null ? null : <CaseDetail key={`${selected.id}:${selected.version}`} record={selected} action={action} onChanged={reloadAll} />}
          </section>
        </div>
        <form className="card card--pad split__side stack" onSubmit={register} aria-label={t("office.cases.register")}>
          <h2 className="subtitle">{t("office.cases.register")}</h2>
          <SelectField label={t("office.columns.client")} value={clientId} options={[{ value: "", label: t("office.review.chooseClient") }, ...clientOptions(clients.data)]} onChange={setClientId} />
          <SelectField label={t("office.cases.caseType")} value={caseTypeId} options={[{ value: "", label: t("office.cases.chooseCaseType") }, ...(settings.data?.caseTypes ?? []).map((type) => ({ value: type.id, label: type.label }))]} onChange={setCaseTypeId} />
          <TextField label={t("office.cases.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
          <TextField label={t("office.cases.referenceCode")} value={referenceCode} onChange={setReferenceCode} mono hint={t("office.cases.referenceHint")} />
          <SelectField label={t("office.cases.assignee")} value={assigneeId} options={[{ value: "", label: t("office.cases.unassigned") }, ...(cases.data?.assignees ?? []).map((user) => ({ value: user.id, label: user.displayName }))]} onChange={setAssigneeId} />
          <TextField label={t("office.cases.dueOn")} type="date" value={dueOn} onChange={setDueOn} />
          <button type="submit" className="button button--primary" disabled={action.busy || clientId === "" || caseTypeId === "" || targetMonth === "" || referenceCode === ""}>
            {t("office.cases.registerAction")}
          </button>
        </form>
      </div>
    </div>
  );
}
