import { Link } from "react-router-dom";
import type { CaseView, Dashboard as DashboardData, IncidentList } from "../../api/office-types";
import { formatDateTime, formatDay, formatMonth } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge, DeadlineBadge } from "../../components/StatusBadge";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { Loading } from "../common/Status";
import { useSession } from "../../session";
import { shelfPath, sortedReaders } from "./shelf-view";

function caseName(record: CaseView): string {
  return `${record.caseType?.label ?? ""} ${formatMonth(record.targetMonth)} #${record.sequence}`;
}

function CaseTable({ title, cases, kind, emptyKey, truncated }: { title: string; cases: CaseView[]; kind: "retrieval" | "due"; emptyKey: string; truncated: boolean }) {
  const t = useT();
  return (
    <section className="card" id={kind}>
      <div className="card__head">
        <h2 className="subtitle grow">{title}</h2>
        {truncated ? <span className="muted">{t("office.dashboard.moreNotShown", { shown: cases.length })}</span> : null}
      </div>
      {cases.length === 0 ? (
        <p className="empty">{t(emptyKey)}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("office.columns.client")}</th>
                <th>{t("office.columns.case")}</th>
                <th>{t(kind === "retrieval" ? "office.columns.submittedOn" : "office.columns.dueOn")}</th>
                <th>{t("office.columns.deadline")}</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((record) => (
                <tr key={record.id}>
                  <td>
                    <span className="code">{record.client?.code}</span> {record.client?.corporateName}
                  </td>
                  <td>{caseName(record)}</td>
                  <td className="muted">{formatDay(kind === "retrieval" ? record.submittedOn : record.dueOn)}</td>
                  <td>
                    <DeadlineBadge level={record[kind].level} daysLeft={record[kind].daysLeft} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Withdrawn documents that a client member had already opened: who opened each one and when. Owner only. */
function Incidents({ incidents }: { incidents: IncidentList }) {
  const t = useT();
  return (
    <section aria-label={t("office.dashboard.incidentsRegion")}>
      <Notice tone="danger">
        <div className="stack">
          <strong>{t("office.dashboard.incidents", { count: incidents.total })}</strong>
          <ul className="plain-list">
            {incidents.items.map((file) => (
              <li key={file.id} className="stack stack--tight">
                <span>
                  {t("office.dashboard.incidentWithdrawn", {
                    name: file.displayName,
                    client: file.client === null ? t("office.dashboard.incidentUnknownClient") : `${file.client.code} ${file.client.corporateName}`,
                    at: formatDateTime(file.withdrawnAt),
                    reason: t(`withdrawReason.${file.withdrawReason ?? "Other"}`),
                  })}
                </span>
                <ul className="plain-list">
                  {sortedReaders(file.readers).map((reader, index) => (
                    <li key={`${reader.firstViewedAt}-${index}`}>
                      {t("office.dashboard.incidentReader", {
                        name: reader.displayName ?? t("office.dashboard.incidentReaderUnnamed"),
                        at: formatDateTime(reader.firstViewedAt),
                      })}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {incidents.truncated ? <span>{t("office.dashboard.incidentsShown", { shown: incidents.items.length, total: incidents.total })}</span> : null}
          <Link to="/office/audit?view=incidents">{t("office.dashboard.incidentsLink")}</Link>
        </div>
      </Notice>
    </section>
  );
}

/** The cards and the lists they summarise. Each card links to its own list. */
export function DashboardContent({ data }: { data: DashboardData }) {
  const t = useT();
  // A list holds at most 100 items; when more match, its card says "100+" instead of passing the cap off as the total.
  const listed = (count: number, truncated: boolean): string | number => (truncated ? t("office.dashboard.cappedCount", { count }) : count);
  return (
    <>
      <section className="grid4" aria-label={t("office.dashboard.queue")}>
        <Link to="/office/review" className="stat">
          <Badge tone="review" label={t("fileState.NeedsReview")} />
          <span className="stat__value">{data.needsReview}</span>
          <span className="muted">{t("office.dashboard.needsReview")}</span>
        </Link>
        <Link to="/office/staged" className="stat">
          <Badge tone="staged" label={t("fileState.Staged")} />
          <span className="stat__value">{data.staged}</span>
          <span className="muted">{t("office.dashboard.staged")}</span>
        </Link>
        <a href="#retrieval" className="stat">
          <Badge tone="danger" label={t("office.dashboard.retrievalBadge")} />
          <span className="stat__value">{listed(data.retrieval.length, data.truncated.retrieval)}</span>
          <span className="muted">{t("office.dashboard.retrieval")}</span>
        </a>
        <a href="#unread" className="stat">
          <Badge tone="neutral" label={t("office.dashboard.unreadBadge")} />
          <span className="stat__value">{listed(data.unread.length, data.truncated.unread)}</span>
          <span className="muted">{t("office.dashboard.unread")}</span>
        </a>
        <a href="#submissions" className="stat">
          <Badge tone="staged" label={t("office.dashboard.submittedBadge")} />
          <span className="stat__value">{data.submitted}</span>
          <span className="muted">{t("office.dashboard.submitted")}</span>
        </a>
      </section>
      {data.incidents !== null && data.incidents.total > 0 ? <Incidents incidents={data.incidents} /> : null}
      <div className="grid2">
        <CaseTable title={t("office.dashboard.retrievalTitle")} cases={data.retrieval} kind="retrieval" emptyKey="office.dashboard.retrievalEmpty" truncated={data.truncated.retrieval} />
        <CaseTable title={t("office.dashboard.dueTitle")} cases={data.due} kind="due" emptyKey="office.dashboard.dueEmpty" truncated={data.truncated.due} />
      </div>
      <section className="card" id="submissions">
        <div className="card__head">
          <h2 className="subtitle grow">{t("office.dashboard.submittedTitle")}</h2>
          {data.truncated.submissions ? <span className="muted">{t("office.dashboard.moreNotShown", { shown: data.submissions.length })}</span> : null}
        </div>
        {data.submissions.length === 0 ? (
          <p className="empty">{t("office.dashboard.submittedEmpty")}</p>
        ) : (
          <ul className="list">
            {data.submissions.map((file) => (
              <li key={file.id} className="list__item">
                <span className="grow">
                  <strong>{file.displayName}</strong>
                  <br />
                  <span className="muted">
                    {file.client?.code} {file.client?.corporateName}
                  </span>
                </span>
                <span className="muted">{t("office.dashboard.submittedAt", { at: formatDateTime(file.receivedAt) })}</span>
                {file.client === null ? null : (
                  <Link className="button button--small" to={shelfPath(file.client.id, "Inbound")}>
                    {t("office.actions.openShelf")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card" id="unread">
        <div className="card__head">
          <h2 className="subtitle grow">{t("office.dashboard.unreadTitle")}</h2>
          {data.truncated.unread ? <span className="muted">{t("office.dashboard.moreNotShown", { shown: data.unread.length })}</span> : null}
        </div>
        {data.unread.length === 0 ? (
          <p className="empty">{t("office.dashboard.unreadEmpty")}</p>
        ) : (
          <ul className="list">
            {data.unread.map((file) => (
              <li key={file.id} className="list__item">
                <span className="grow">
                  <strong>{file.displayName}</strong>
                  <br />
                  <span className="muted">
                    {file.client?.code} {file.client?.corporateName}
                  </span>
                </span>
                <span className="muted">{formatDateTime(file.publishedAt)}</span>
                {file.client === null ? null : (
                  <Link className="button button--small" to={shelfPath(file.client.id, "Outbound")}>
                    {t("office.actions.openShelf")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function Dashboard() {
  const t = useT();
  const { api } = useSession();
  const { data, error, loading } = useLoad<DashboardData>(() => api.get<DashboardData>("/api/office/dashboard"), []);

  if (loading && data === null) {
    return <Loading />;
  }
  return (
    <div className="page">
      <div className="row">
        <h1 className="title grow">{t("office.dashboard.title")}</h1>
        <span className="muted">{data === null ? "" : t("office.dashboard.today", { day: formatDay(data.today), timezone: data.timezone })}</span>
      </div>
      <ErrorNotice error={error} />
      {data === null ? null : <DashboardContent data={data} />}
    </div>
  );
}
