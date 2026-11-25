import { useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { followDownload, openFile } from "../../api/client";
import type { CaseView, ClientRecord, FileView, Reader } from "../../api/office-types";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SelectField, TextField } from "../../components/Form";
import { formatDateTime, formatMonth } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge, FileStateBadge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import {
  cancelledByClient, caseLabel, docTypesFor, firstView, linkTarget, loadAllPages, monthFilter, SHELF_DIRECTIONS, SHELF_VIEWS, shelfActions,
  shelfCountPath, shelfDirectionOf, shelfListPath, shownCounts, shownList, sortedReaders, WITHDRAW_REASON_CHOICES, withdrawReasonOf,
  type ShelfCounts, type ShelfDirection, type ShelfList, type ShelfView,
} from "./shelf-view";
import { useSettings } from "./useMasterData";

const WITHDRAW_NEXT = ["NeedsReview", "Trashed"] as const;
/** Cases that can no longer receive documents. */
const TERMINAL_STATES: readonly string[] = ["Closed", "Cancelled"];
/** Clients are read page by page to the end; this is the largest page the server gives. */
const CLIENT_PAGE = 200;
const CASE_LIMIT = 200;

/** Entry of the menu: choose the client whose shelf to open. */
export function ShelfChooser() {
  const t = useT();
  const { api } = useSession();
  // Every client is loaded, so the search below never misses one that sits beyond the first page.
  const list = useLoad<ClientRecord[]>(
    () => loadAllPages(async (offset) => (await api.get<{ items: ClientRecord[] }>(`/api/office/clients?limit=${CLIENT_PAGE}&offset=${offset}`)).items, CLIENT_PAGE),
    [],
  );
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = (list.data ?? []).filter((client) => needle === "" || `${client.code} ${client.corporateName}`.toLowerCase().includes(needle));

  return (
    <div className="page">
      <h1 className="title">{t("office.shelf.title")}</h1>
      <ErrorNotice error={list.error} />
      <section className="card" aria-label={t("office.shelf.chooseClient")}>
        <div className="card__head">
          <span className="grow">{t("office.shelf.chooseClient")}</span>
          <TextField label={t("office.clients.search")} type="search" value={query} onChange={setQuery} />
        </div>
        {list.loading && list.data === null ? <Loading /> : null}
        {list.data !== null && visible.length === 0 ? <p className="empty">{t("office.clients.empty")}</p> : null}
        <ul className="list">
          {visible.map((client) => (
            <li key={client.id}>
              <Link className="list__item" to={`/office/shelf/${client.id}`}>
                <span className="code">{client.code}</span>
                <span className="grow">{client.corporateName}</span>
                <Badge tone={client.status === "Active" ? "published" : "neutral"} label={t(`clientStatus.${client.status}`)} />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** Who opened a document and when, one line per reader, earliest first. */
function ReaderLines({ readers }: { readers: readonly Reader[] }) {
  const t = useT();
  return (
    <ul className="plain-list">
      {sortedReaders(readers).map((reader, index) => (
        <li key={`${reader.firstViewedAt}-${index}`}>
          {t("office.shelf.readerAt", { name: reader.displayName ?? t("office.shelf.unnamedReader"), at: formatDateTime(reader.firstViewedAt) })}
        </li>
      ))}
    </ul>
  );
}

/**
 * One client's shelf: what the office sent (published, withdrawn, trash) and what the client sent.
 * The client stays fixed on the banner while the list scrolls.
 */
export function Shelf() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  // A link (the dashboard's waiting submissions) can open the shelf on what the client sent.
  const [direction, setDirection] = useState<ShelfDirection>(shelfDirectionOf(useLocation().search));
  const [view, setView] = useState<ShelfView>(SHELF_VIEWS[direction][0] ?? "Published");
  const [docTypeId, setDocTypeId] = useState("");
  const [monthText, setMonthText] = useState("");
  const [filterCaseId, setFilterCaseId] = useState("");
  const client = useLoad<ClientRecord>(() => api.get<ClientRecord>(`/api/office/clients/${clientId}`), [clientId]);
  // Only a complete month is sent; a text that is not a month is reported on the field instead.
  const month = monthFilter(monthText);
  const listPath = shelfListPath({ clientId, direction, view, docTypeId, targetMonth: month.value, caseId: filterCaseId });
  // The answer is kept with its question, so rows are never shown under another direction, view or filter.
  const files = useLoad<{ path: string; list: ShelfList }>(async () => ({ path: listPath, list: await api.get<ShelfList>(listPath) }), [listPath]);
  // The direction tabs show how many documents each direction holds for this client and filters.
  // The totals are kept with the filters they were counted for, so a total is never shown for another selection.
  const countKey = JSON.stringify([clientId, docTypeId, month.value, filterCaseId]);
  const counts = useLoad<ShelfCounts>(async () => {
    const filters = { clientId, docTypeId, targetMonth: month.value, caseId: filterCaseId };
    const [outbound, inbound] = await Promise.all([
      api.get<ShelfList>(shelfCountPath({ ...filters, direction: "Outbound" })),
      api.get<ShelfList>(shelfCountPath({ ...filters, direction: "Inbound" })),
    ]);
    return { key: countKey, totals: { Outbound: outbound.total, Inbound: inbound.total } };
  }, [countKey]);
  const countsShown = shownCounts(counts.data, countKey, counts.error);
  const cases = useLoad<{ items: CaseView[] }>(
    () => api.get<{ items: CaseView[] }>(`/api/office/cases?clientId=${encodeURIComponent(clientId)}&limit=${CASE_LIMIT}`),
    [clientId],
  );
  const settings = useSettings();
  const action = useAction();
  const [withdrawing, setWithdrawing] = useState<FileView | null>(null);
  // No reason is chosen until the office picks one: a mis-delivery must not be recorded by default.
  const [reason, setReason] = useState("");
  const [next, setNext] = useState<string>(WITHDRAW_NEXT[0]);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");

  // The list reloads after every attempt, so a version conflict is followed by the current version.
  const done = () => {
    files.reload();
    counts.reload();
  };

  const chooseDirection = (value: ShelfDirection) => {
    const first = SHELF_VIEWS[value][0];
    if (first === undefined) {
      throw new Error(`no view for ${value}`);
    }
    setDirection(value);
    setView(first);
    // Document types differ by direction, so the type filter starts again.
    setDocTypeId("");
    setLinkingId(null);
  };

  const chooseView = (value: ShelfView) => {
    setView(value);
    setLinkingId(null);
  };

  const startWithdrawing = (file: FileView) => {
    setReason("");
    setWithdrawing(file);
  };

  const withdraw = () => {
    const target = withdrawing;
    const chosen = withdrawReasonOf(reason);
    if (target === null || chosen === null) {
      return;
    }
    setWithdrawing(null);
    void action.run(() => api.post(`/api/office/files/${target.id}/withdraw`, { reason: chosen, next, version: target.version })).then(done);
  };

  const restore = (file: FileView) => () => {
    void action.run(() => api.post(`/api/office/files/${file.id}/restore`, { version: file.version })).then(done);
  };

  const trash = (file: FileView) => () => {
    void action.run(() => api.post(`/api/office/files/${file.id}/trash`, { version: file.version })).then(done);
  };

  const startLinking = (file: FileView) => () => {
    setCaseId(file.caseId ?? "");
    setLinkingId(file.id);
  };

  // After a refused attempt the panel stays open and the reloaded list gives it the current version.
  const link = (target: FileView) => () => {
    void action
      .run(() => api.post(`/api/office/files/${target.id}/link-case`, { caseId: caseId === "" ? null : caseId, version: target.version }))
      .then((ok) => {
        if (ok) {
          setLinkingId(null);
          setCaseId("");
        }
        files.reload();
      });
  };

  // The first open of a submission changes its state and version on the server before the download starts.
  const open = (file: FileView) => () => {
    void action.run(() => openFile(api, file.id, "view", followDownload)).then((ok) => {
      if (ok && file.state === "Submitted") {
        done();
      }
    });
  };

  if (client.data === null) {
    return <div className="page">{client.error === null ? <Loading /> : <ErrorNotice error={client.error} />}</div>;
  }

  const caseRecords = cases.data?.items ?? [];
  const caseNames = new Map(caseRecords.map((record) => [record.id, caseLabel(record)]));
  const caseName = (file: FileView): string => {
    if (file.caseId === null) {
      return t("office.shelf.noCase");
    }
    return caseNames.get(file.caseId) ?? t("office.shelf.caseNotListed");
  };
  const shown = shownList(files.data, listPath, files.error);
  const items = shown?.items ?? [];
  // Read from the list as it is now: the panel closes when its row is no longer shown.
  const linking = linkTarget(items, linkingId);
  const withdrawFirstView = withdrawing === null ? null : firstView(withdrawing.readers);

  return (
    <>
      <div className="banner banner--fixed" role="status">
        <span className="banner__label">{t("office.shelf.fixedClient")}</span>
        <span className="banner__code">{client.data.code}</span>
        <span className="banner__name">{client.data.corporateName}</span>
        <Badge tone={client.data.status === "Active" ? "published" : "neutral"} label={t(`clientStatus.${client.data.status}`)} />
        <Link className="banner__link" to="/office/shelf">
          {t("office.shelf.changeClient")}
        </Link>
      </div>
      <div className="page">
        <div className="filters">
          <h1 className="title grow">{t("office.shelf.title")}</h1>
          <SelectField
            label={t("office.shelf.filterType")}
            value={docTypeId}
            options={[
              { value: "", label: t("office.shelf.allTypes") },
              ...docTypesFor(direction, settings.data?.docTypes ?? []).map((docType) => ({ value: docType.id, label: docType.label })),
            ]}
            onChange={setDocTypeId}
          />
          <TextField
            label={t("office.shelf.filterMonth")}
            type="month"
            value={monthText}
            placeholder={t("office.shelf.filterMonthFormat")}
            error={month.valid ? null : t("office.shelf.filterMonthInvalid")}
            onChange={setMonthText}
          />
          <SelectField
            label={t("office.shelf.filterCase")}
            value={filterCaseId}
            options={[{ value: "", label: t("office.shelf.allCases") }, ...caseRecords.map((record) => ({ value: record.id, label: caseLabel(record) }))]}
            onChange={setFilterCaseId}
          />
        </div>
        <ErrorNotice error={files.error ?? counts.error ?? cases.error ?? settings.error ?? action.error} />
        <nav className="tabs" aria-label={t("office.shelf.directions")}>
          {SHELF_DIRECTIONS.map((value) => (
            <button key={value} type="button" className={`tab${direction === value ? " tab--active" : ""}`} aria-pressed={direction === value} onClick={() => chooseDirection(value)}>
              {countsShown === null
                ? t(`office.shelf.direction.${value}`)
                : t("office.shelf.directionCount", { direction: t(`office.shelf.direction.${value}`), count: countsShown[value] })}
            </button>
          ))}
        </nav>
        <nav className="row" aria-label={t("office.shelf.tabs")}>
          {SHELF_VIEWS[direction].map((value) => (
            <button key={value} type="button" className={`chip${view === value ? " chip--active" : ""}`} aria-pressed={view === value} onClick={() => chooseView(value)}>
              {t(`office.shelf.tab.${value}`)}
            </button>
          ))}
          {shown === null ? null : <span className="muted">{t("office.shelf.count", { count: shown.total })}</span>}
        </nav>
        {shown === null && files.error === null ? <Loading /> : null}
        {shown !== null && items.length === 0 ? <p className="card empty">{t("office.shelf.empty")}</p> : null}
        {items.length === 0 ? null : (
          <section className="card" aria-label={t(`office.shelf.direction.${direction}`)}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("office.columns.document")}</th>
                    <th>{t("office.columns.case")}</th>
                    <th>{t("office.shelf.columnState")}</th>
                    <th>{t(direction === "Outbound" ? "office.shelf.columnRead" : "office.shelf.columnReceived")}</th>
                    <th>{t("office.shelf.columnActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((file) => {
                    const actions = shelfActions(file);
                    return (
                      <tr key={file.id}>
                        <td>
                          <div className="stack stack--tight">
                            <strong>{file.displayName}</strong>
                            <span className="muted">
                              {file.docType?.label ?? t("office.unclassified")}
                              {file.targetMonth === null ? "" : ` · ${formatMonth(file.targetMonth)}`}
                            </span>
                          </div>
                        </td>
                        <td>{caseName(file)}</td>
                        <td>
                          <div className="stack stack--tight">
                            <FileStateBadge state={file.state} />
                            {file.withdrawReason === null ? null : <span className="muted">{t(`withdrawReason.${file.withdrawReason}`)}</span>}
                            {cancelledByClient(file) ? <span className="muted">{t("office.shelf.cancelledByClient")}</span> : null}
                          </div>
                        </td>
                        <td className="muted">
                          {file.direction === "Outbound" ? (
                            <div className="stack stack--tight">
                              {file.publishedAt === null ? null : <span>{t("office.shelf.publishedAt", { at: formatDateTime(file.publishedAt) })}</span>}
                              {file.readers.length === 0 ? <span>{t("office.shelf.unread")}</span> : <ReaderLines readers={file.readers} />}
                            </div>
                          ) : (
                            <div className="stack stack--tight">
                              <span>{t("office.shelf.receivedAt", { at: formatDateTime(file.receivedAt) })}</span>
                              <span>
                                {file.acknowledgedAt === null
                                  ? t("office.shelf.notAcknowledged")
                                  : t("office.shelf.acknowledgedAt", { at: formatDateTime(file.acknowledgedAt) })}
                              </span>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="row row--nowrap">
                            <button type="button" className="button" disabled={action.busy} onClick={open(file)}>
                              {t("office.actions.open")}
                            </button>
                            {actions.includes("linkCase") ? (
                              <button type="button" className="button" disabled={action.busy} onClick={startLinking(file)}>
                                {t("office.shelf.linkCase")}
                              </button>
                            ) : null}
                            {actions.includes("withdraw") ? (
                              <button type="button" className="button button--danger" disabled={action.busy} onClick={() => startWithdrawing(file)}>
                                {t("office.shelf.withdraw")}
                              </button>
                            ) : null}
                            {actions.includes("trash") ? (
                              <button type="button" className="button" disabled={action.busy} onClick={trash(file)}>
                                {t("office.actions.trash")}
                              </button>
                            ) : null}
                            {actions.includes("restore") ? (
                              <button type="button" className="button" disabled={action.busy} onClick={restore(file)}>
                                {t("office.shelf.restore")}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {linking === null ? null : (
          <section className="card card--pad stack" aria-label={t("office.shelf.linkCase")}>
            <h2 className="subtitle">{t("office.shelf.linkTitle", { name: linking.displayName })}</h2>
            <SelectField
              label={t("office.review.case")}
              value={caseId}
              options={[
                { value: "", label: t("office.review.noCase") },
                // Only open cases, and the month is shown so two cases with the same number cannot be confused.
                ...caseRecords.filter((record) => !TERMINAL_STATES.includes(record.state)).map((record) => ({ value: record.id, label: caseLabel(record) })),
              ]}
              onChange={setCaseId}
            />
            <div className="row">
              <button type="button" className="button button--primary" disabled={action.busy} onClick={link(linking)}>
                {t("office.shelf.linkAction")}
              </button>
              <button type="button" className="button" onClick={() => setLinkingId(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </section>
        )}
        <ConfirmDialog
          open={withdrawing !== null}
          title={t("office.shelf.withdrawTitle", { name: withdrawing?.displayName ?? "" })}
          confirmLabel={t("office.shelf.withdrawConfirm")}
          danger
          disabled={withdrawReasonOf(reason) === null}
          onConfirm={withdraw}
          onCancel={() => setWithdrawing(null)}
        >
          <Notice tone="review">{t("office.shelf.withdrawNote")}</Notice>
          {withdrawing === null ? null : (
            <div className="stack stack--tight">
              <span>
                {withdrawFirstView === null
                  ? t("office.shelf.withdrawUnread")
                  : t("office.shelf.withdrawOpened", { count: withdrawing.readers.length, at: formatDateTime(withdrawFirstView) })}
              </span>
              <ReaderLines readers={withdrawing.readers} />
            </div>
          )}
          <SelectField
            label={t("office.shelf.reason")}
            value={reason}
            options={[
              { value: "", label: t("office.shelf.reasonPlaceholder") },
              ...WITHDRAW_REASON_CHOICES.map((value) => ({ value, label: t(`withdrawReason.${value}`) })),
            ]}
            onChange={setReason}
          />
          <SelectField label={t("office.shelf.next")} value={next} options={WITHDRAW_NEXT.map((value) => ({ value, label: t(`withdrawNext.${value}`) }))} onChange={setNext} />
        </ConfirmDialog>
      </div>
    </>
  );
}
