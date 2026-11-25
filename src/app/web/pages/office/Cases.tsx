import { useState, type FormEvent } from "react";
import type { CaseList, CaseView, ClientRef } from "../../api/office-types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { ClientPicker } from "../../components/ClientPicker";
import { SelectField, TextField } from "../../components/Form";
import { formatDay } from "../../components/format";
import { ErrorNotice, errorText, Notice } from "../../components/Notice";
import { CaseStateBadge, DeadlineBadge } from "../../components/StatusBadge";
import { useAction, type Action } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { caseSteps, freshestCase, parseArrivalNumbers, stepNoteKey } from "./case-progress";
import { useSettings } from "./useMasterData";

const CASE_KINDS = ["Procedure", "Payroll", "Other"] as const;
/** Every state a case can still move on from; "Closed" and "Cancelled" are final (instructions.md 6.3). */
const OPEN_STATES = ["Open", "Submitted", "MaterialsReceived", "DocumentReceived", "Delivered", "Confirmed"] as const;
const TERMINAL_STATES: readonly string[] = ["Closed", "Cancelled"];
/** States from which a case may be cancelled, as in the core rule CANCELLABLE_CASE_STATES. */
const CANCELLABLE_STATES: readonly string[] = ["Open", "Submitted", "MaterialsReceived"];
const OPEN_FILTER = "open";
const ALL_FILTER = "all";
/** The list grows by this many cases at a time, up to the most the API returns in one answer. */
const LIST_STEP = 50;
const LIST_MAX = 200;

function listPath(clientId: string, kind: string, stateFilter: string, limit: number): string {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  if (clientId !== "") query.set("clientId", clientId);
  if (kind !== "") query.set("kind", kind);
  if (stateFilter === OPEN_FILTER) {
    query.set("states", OPEN_STATES.join(","));
  } else if (stateFilter !== ALL_FILTER) {
    query.set("states", stateFilter);
  }
  return `/api/office/cases?${query.toString()}`;
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
  if (record.caseType === null) {
    return null;
  }
  const steps = caseSteps(record.caseType.kind, record.state, record.submittedOn);
  // A closed or cancelled case is on no step, so its steps get no state note.
  const terminal = TERMINAL_STATES.includes(record.state);
  return (
    <ol className="steps" aria-label={t("office.cases.steps")}>
      {steps.map((step, index) => {
        const dated = step.state === "Submitted" && record.submittedOn !== null;
        const noteKey = terminal ? null : stepNoteKey(step);
        return (
          <li key={step.state} className={`step${step.status === "pending" ? "" : ` step--${step.status}`}`} aria-current={step.status === "current" ? "step" : undefined}>
            <span className="step__number">{index + 1}</span>
            <span>{t(`caseState.${step.state}`)}</span>
            {dated ? <span className="step__note">{formatDay(record.submittedOn)}</span> : null}
            {step.status === "unconfirmed" ? <span className="step__note">{t(step.state === "Submitted" ? "office.cases.notSubmitted" : "office.cases.stepNotRecorded")}</span> : null}
            {noteKey !== null && !dated ? <span className="step__note">{t(noteKey)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

interface CaseDetailProps {
  record: CaseView;
  action: Action;
  /** True while a request runs or the case is being re-read: the version on screen may be out of date. */
  busy: boolean;
  /** The case as the server answered after a change. */
  onSaved(updated: CaseView): void;
  /** A change was refused: the case on screen may be out of date. */
  onRefused(): void;
}

/** The selected case: progress, submission data and the three manual steps (submit, close, cancel). */
function CaseDetail({ record, action, busy, onSaved, onRefused }: CaseDetailProps) {
  const t = useT();
  const { api } = useSession();
  const [submittedOn, setSubmittedOn] = useState(record.submittedOn ?? "");
  const [arrivalText, setArrivalText] = useState("");
  const [confirming, setConfirming] = useState<"close" | "cancel" | null>(null);
  const terminal = TERMINAL_STATES.includes(record.state);
  const arrivalNumbers = record.arrivalNumbers ?? [];

  // What was typed stays in the form when a request is refused; only a saved submission clears the numbers.
  const saveSubmission = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(async () => {
        onSaved(await api.post<CaseView>(`/api/office/cases/${record.id}/submit`, { submittedOn, arrivalNumbers: parseArrivalNumbers(arrivalText), version: record.version }));
        setArrivalText("");
      })
      .then((succeeded) => (succeeded ? undefined : onRefused()));
  };

  const transition = (verb: "close" | "cancel") => {
    setConfirming(null);
    void action
      .run(async () => {
        const updated = await api.post<CaseView>(`/api/office/cases/${record.id}/${verb}`, { version: record.version });
        // Closing or cancelling does not touch the arrival numbers, and its answer does not list them.
        onSaved({ ...updated, arrivalNumbers });
      })
      .then((succeeded) => (succeeded ? undefined : onRefused()));
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
              <button type="submit" className="button button--primary" disabled={busy || submittedOn === ""}>
                {t("office.cases.saveSubmission")}
              </button>
            </div>
          </form>
        ) : null}
        {terminal ? null : (
          <div className="row">
            <button type="button" className="button" disabled={busy} onClick={() => setConfirming("close")}>
              {t("office.cases.close")}
            </button>
            {CANCELLABLE_STATES.includes(record.state) ? (
              <button type="button" className="button button--danger" disabled={busy} onClick={() => setConfirming("cancel")}>
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

export interface CaseDetailPanelProps {
  selectedId: string | null;
  record: CaseView | null;
  loading: boolean;
  error: unknown;
  action: Action;
  onSaved(updated: CaseView): void;
  onRefused(): void;
  onRetry(): void;
}

/** The detail card: the selected case, or why there is none to show (nothing chosen, loading, failed). */
export function CaseDetailPanel({ selectedId, record, loading, error, action, onSaved, onRefused, onRetry }: CaseDetailPanelProps) {
  const t = useT();
  const failed = selectedId !== null && !loading && error !== null && error !== undefined;
  return (
    <section className="card" aria-label={t("office.cases.detail")}>
      {selectedId === null ? <p className="empty">{t("office.cases.chooseCase")}</p> : null}
      {selectedId !== null && record === null && loading ? <Loading /> : null}
      {failed ? (
        <div className="card--pad stack">
          <Notice tone="danger">
            {t("office.cases.detailFailed")} {errorText(t, error)}
          </Notice>
          <div className="row">
            <button type="button" className="button" onClick={onRetry}>
              {t("common.reload")}
            </button>
          </div>
        </div>
      ) : null}
      {record === null ? null : <CaseDetail key={record.id} record={record} action={action} busy={action.busy || loading} onSaved={onSaved} onRefused={onRefused} />}
    </section>
  );
}

/** Cases: search and narrow the list, register, record the submission, close or cancel. */
export function Cases() {
  const t = useT();
  const { api } = useSession();
  const [clientFilter, setClientFilter] = useState<ClientRef | null>(null);
  const [kindFilter, setKindFilter] = useState("");
  const [stateFilter, setStateFilter] = useState(OPEN_FILTER);
  const [limit, setLimit] = useState(LIST_STEP);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** The answer of the last change, shown until a reload brings a copy that is at least as new. */
  const [saved, setSaved] = useState<CaseView | null>(null);
  const cases = useLoad<CaseList>(() => api.get<CaseList>(listPath(clientFilter?.id ?? "", kindFilter, stateFilter, limit)), [clientFilter, kindFilter, stateFilter, limit]);
  const detail = useLoad<CaseView | null>(() => (selectedId === null ? Promise.resolve(null) : api.get<CaseView>(`/api/office/cases/${selectedId}`)), [selectedId]);
  const settings = useSettings();
  const action = useAction();
  const [client, setClient] = useState<ClientRef | null>(null);
  const [caseTypeId, setCaseTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [dueOn, setDueOn] = useState("");

  // A new filter starts again from the first cases.
  const chooseClient = (value: ClientRef | null) => {
    setClientFilter(value);
    setLimit(LIST_STEP);
  };
  const chooseKind = (value: string) => {
    setKindFilter(value);
    setLimit(LIST_STEP);
  };
  const chooseState = (value: string) => {
    setStateFilter(value);
    setLimit(LIST_STEP);
  };

  const register = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      const created = await api.post<CaseView>("/api/office/cases", {
        clientId: client?.id,
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

  const showSaved = (updated: CaseView) => {
    setSaved(updated);
    cases.reload();
  };

  const reloadAll = () => {
    cases.reload();
    detail.reload();
  };

  const items = cases.data?.items ?? [];
  const selected = freshestCase(selectedId, detail.data, saved);
  const stateOptions = [
    { value: OPEN_FILTER, label: t("office.cases.openCases") },
    { value: ALL_FILTER, label: t("office.cases.allStates") },
    ...[...OPEN_STATES, ...TERMINAL_STATES].map((value) => ({ value, label: t(`caseState.${value}`) })),
  ];

  return (
    <div className="page">
      <h1 className="title">{t("office.cases.title")}</h1>
      <ErrorNotice error={cases.error} />
      <ErrorNotice error={action.error} />
      <div className="split">
        <div className="split__main stack">
          <section className="card card--open" aria-label={t("office.cases.list")}>
            <div className="card__head card__head--end" role="search">
              <ClientPicker label={t("office.columns.client")} emptyLabel={t("office.allClients")} value={clientFilter} onChange={chooseClient} status={null} compact />
              <SelectField label={t("office.cases.kind")} value={kindFilter} options={[{ value: "", label: t("office.cases.allKinds") }, ...CASE_KINDS.map((value) => ({ value, label: t(`caseKind.${value}`) }))]} onChange={chooseKind} />
              <SelectField label={t("office.cases.state")} value={stateFilter} options={stateOptions} onChange={chooseState} />
            </div>
            {cases.loading && cases.data === null ? <Loading /> : null}
            {cases.data !== null && items.length === 0 ? <p className="empty">{t("office.cases.empty")}</p> : null}
            {cases.data?.truncated === true ? (
              <div className="card--pad stack">
                <Notice tone="review">{t(limit < LIST_MAX ? "office.cases.moreCases" : "office.cases.moreCasesMax", { count: items.length })}</Notice>
                {limit < LIST_MAX ? (
                  <div className="row">
                    <button type="button" className="button" disabled={cases.loading} onClick={() => setLimit(Math.min(limit + LIST_STEP, LIST_MAX))}>
                      {t("office.cases.showMore")}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
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
          <CaseDetailPanel selectedId={selectedId} record={selected} loading={detail.loading} error={detail.error} action={action} onSaved={showSaved} onRefused={reloadAll} onRetry={detail.reload} />
        </div>
        <form className="card card--pad split__side stack" onSubmit={register} aria-label={t("office.cases.register")}>
          <h2 className="subtitle">{t("office.cases.register")}</h2>
          <ClientPicker label={t("office.columns.client")} emptyLabel={t("office.review.chooseClient")} value={client} onChange={setClient} />
          <SelectField label={t("office.cases.caseType")} value={caseTypeId} options={[{ value: "", label: t("office.cases.chooseCaseType") }, ...(settings.data?.caseTypes ?? []).map((type) => ({ value: type.id, label: type.label }))]} onChange={setCaseTypeId} />
          <TextField label={t("office.cases.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
          <TextField label={t("office.cases.referenceCode")} value={referenceCode} onChange={setReferenceCode} mono hint={t("office.cases.referenceHint")} />
          <SelectField label={t("office.cases.assignee")} value={assigneeId} options={[{ value: "", label: t("office.cases.unassigned") }, ...(cases.data?.assignees ?? []).map((user) => ({ value: user.id, label: user.displayName }))]} onChange={setAssigneeId} />
          <TextField label={t("office.cases.dueOn")} type="date" value={dueOn} onChange={setDueOn} />
          <button type="submit" className="button button--primary" disabled={action.busy || client === null || caseTypeId === "" || targetMonth === "" || referenceCode === ""}>
            {t("office.cases.registerAction")}
          </button>
        </form>
      </div>
    </div>
  );
}
