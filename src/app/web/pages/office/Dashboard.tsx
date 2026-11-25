import { Link } from "react-router-dom";
import type { CaseView, Dashboard as DashboardData } from "../../api/office-types";
import { formatDateTime, formatDay, formatMonth } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge, DeadlineBadge } from "../../components/StatusBadge";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { Loading } from "../common/Status";
import { useSession } from "../../session";

function caseName(record: CaseView): string {
  return `${record.caseType?.label ?? ""} ${formatMonth(record.targetMonth)} #${record.sequence}`;
}

function CaseTable({ title, cases, kind, emptyKey }: { title: string; cases: CaseView[]; kind: "retrieval" | "due"; emptyKey: string }) {
  const t = useT();
  return (
    <section className="card">
      <div className="card__head">
        <h2 className="subtitle">{title}</h2>
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
        <span className="muted">{data === null ? "" : formatDay(data.today)}</span>
      </div>
      <ErrorNotice error={error} />
      {data === null ? null : (
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
            <Link to="/office/cases" className="stat">
              <Badge tone="danger" label={t("office.dashboard.retrievalBadge")} />
              <span className="stat__value">{data.retrieval.length}</span>
              <span className="muted">{t("office.dashboard.retrieval")}</span>
            </Link>
            <div className="stat">
              <Badge tone="neutral" label={t("office.dashboard.unreadBadge")} />
              <span className="stat__value">{data.unread.length}</span>
              <span className="muted">{t("office.dashboard.unread")}</span>
            </div>
          </section>
          {data.submitted > 0 ? <Notice tone="info">{t("office.dashboard.submitted", { count: data.submitted })}</Notice> : null}
          {data.incidents !== null && data.incidents > 0 ? (
            <Notice tone="danger">
              {t("office.dashboard.incidents", { count: data.incidents })} <Link to="/office/audit">{t("office.dashboard.incidentsLink")}</Link>
            </Notice>
          ) : null}
          <div className="grid2">
            <CaseTable title={t("office.dashboard.retrievalTitle")} cases={data.retrieval} kind="retrieval" emptyKey="office.dashboard.retrievalEmpty" />
            <CaseTable title={t("office.dashboard.dueTitle")} cases={data.due} kind="due" emptyKey="office.dashboard.dueEmpty" />
          </div>
          <section className="card">
            <div className="card__head">
              <h2 className="subtitle">{t("office.dashboard.unreadTitle")}</h2>
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
                      <Link className="button button--small" to={`/office/shelf/${file.client.id}`}>
                        {t("office.actions.openShelf")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
