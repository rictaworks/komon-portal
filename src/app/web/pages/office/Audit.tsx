import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { AuditEntry, IncidentList } from "../../api/office-types";
import { SelectField } from "../../components/Form";
import { formatDateTime } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge } from "../../components/StatusBadge";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { sortedReaders } from "./shelf-view";

const VIEWS = ["audit", "incidents"] as const;
type View = (typeof VIEWS)[number];

/** Audit log and incidents (misdelivered documents). Owner only; the route guard enforces it. */
export function Audit() {
  const t = useT();
  const { api } = useSession();
  // The dashboard links straight to the incidents with `?view=incidents`.
  const [view, setView] = useState<View>(new URLSearchParams(useLocation().search).get("view") === "incidents" ? "incidents" : "audit");
  const audit = useLoad<{ items: AuditEntry[] }>(
    () => api.get<{ items: AuditEntry[] }>("/api/office/audit"),
    [view],
  );
  const incidents = useLoad<IncidentList>(() => api.get<IncidentList>("/api/office/incidents"), [view]);
  const current = view === "audit" ? audit : incidents;

  return (
    <div className="page">
      <div className="row row--end">
        <h1 className="title grow">{t("office.audit.title")}</h1>
        <SelectField label={t("office.audit.view")} value={view} options={VIEWS.map((value) => ({ value, label: t(`office.audit.views.${value}`) }))} onChange={(value) => setView(value as View)} />
      </div>
      <ErrorNotice error={current.error} />
      {current.data === null ? <Loading /> : null}
      {current.data !== null && current.data.items.length === 0 ? <p className="card empty">{t("office.audit.empty")}</p> : null}
      {view === "audit" && audit.data !== null && audit.data.items.length > 0 ? (
        <div className="table-wrap card">
          <table className="table">
            <thead>
              <tr>
                <th>{t("office.audit.when")}</th>
                <th>{t("office.audit.who")}</th>
                <th>{t("office.audit.action")}</th>
                <th>{t("office.audit.target")}</th>
                <th>{t("office.audit.result")}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.occurredAt)}</td>
                  <td>{entry.actorDisplayName ?? t("office.audit.system")}</td>
                  <td className="code">{entry.action}</td>
                  <td className="muted">{entry.targetType}</td>
                  <td>
                    <Badge tone={entry.result === "denied" ? "danger" : "neutral"} label={t(`office.audit.results.${entry.result}`)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {view === "incidents" && incidents.data !== null && incidents.data.truncated ? (
        <Notice tone="info">{t("office.audit.incidentsTruncated", { shown: incidents.data.items.length, total: incidents.data.total })}</Notice>
      ) : null}
      {view === "incidents" && incidents.data !== null && incidents.data.items.length > 0 ? (
        <ul className="list card">
          {incidents.data.items.map((file) => (
            <li key={file.id} className="list__item">
              <span className="grow stack stack--tight">
                <strong>{file.displayName}</strong>
                <span className="muted">
                  {file.client === null ? "" : `${file.client.code} ${file.client.corporateName}`} · {formatDateTime(file.receivedAt)}
                </span>
                {sortedReaders(file.readers).map((reader, index) => (
                  <span key={`${reader.firstViewedAt}-${index}`}>
                    {t("office.shelf.readerAt", { name: reader.displayName ?? t("office.shelf.unnamedReader"), at: formatDateTime(reader.firstViewedAt) })}
                  </span>
                ))}
              </span>
              <Badge tone="danger" label={t(`withdrawReason.${file.withdrawReason ?? "Other"}`)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
