import { useState } from "react";
import { useLocation } from "react-router-dom";
import type { AuditEntry, ClientRef, IncidentList } from "../../api/office-types";
import { ClientPicker } from "../../components/ClientPicker";
import { SelectField } from "../../components/Form";
import { formatDateTime } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Pager } from "../../components/Pager";
import { Badge } from "../../components/StatusBadge";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { rowsFor, type ClientListPage } from "./client-list";
import { AUDIT_PAGE_SIZE, auditActorLabelKey, auditListPath } from "./audit-view";
import { sortedReaders } from "./shelf-view";

const VIEWS = ["audit", "incidents"] as const;
type View = (typeof VIEWS)[number];

/** Audit log and incidents (misdelivered documents). Owner only; the route guard enforces it. */
export function Audit() {
  const t = useT();
  const { api } = useSession();
  // The dashboard links straight to the incidents with `?view=incidents`.
  const [view, setView] = useState<View>(new URLSearchParams(useLocation().search).get("view") === "incidents" ? "incidents" : "audit");
  const [client, setClient] = useState<ClientRef | null>(null);
  const [page, setPage] = useState(0);
  const path = auditListPath({ clientId: client?.id ?? null, offset: page * AUDIT_PAGE_SIZE, pageSize: AUDIT_PAGE_SIZE });
  // The entries are kept with the request they answer, so entries of an earlier page or client are never shown under a new one.
  const audit = useLoad<ClientListPage<AuditEntry>>(
    async () => ({ path, items: (await api.get<{ items: AuditEntry[] }>(path)).items }),
    [path, view],
  );
  const incidents = useLoad<IncidentList>(() => api.get<IncidentList>("/api/office/incidents"), [view]);
  const current = view === "audit" ? audit : incidents;
  // Null while the entries for the chosen client and page are loading, or when loading them failed.
  const entries = rowsFor(audit.data, path, AUDIT_PAGE_SIZE);

  // A newly chosen client starts again at its first page.
  const chooseClient = (next: ClientRef | null): void => {
    setClient(next);
    setPage(0);
  };

  return (
    <div className="page">
      <div className="row row--end">
        <h1 className="title grow">{t("office.audit.title")}</h1>
        {view === "audit" ? <ClientPicker label={t("office.columns.client")} emptyLabel={t("office.allClients")} value={client} onChange={chooseClient} status={null} compact /> : null}
        <SelectField label={t("office.audit.view")} value={view} options={VIEWS.map((value) => ({ value, label: t(`office.audit.views.${value}`) }))} onChange={(value) => setView(value as View)} />
      </div>
      <ErrorNotice error={current.error} />
      {view === "audit" && entries === null ? <Loading /> : null}
      {view === "audit" && entries !== null && entries.rows.length === 0 ? <p className="card empty">{t("office.audit.empty")}</p> : null}
      {view === "audit" && entries !== null && entries.rows.length > 0 ? (
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
              {entries.rows.map((entry) => (
                <tr key={entry.id}>
                  <td>{formatDateTime(entry.occurredAt)}</td>
                  <td>{entry.actorDisplayName ?? t(auditActorLabelKey(entry))}</td>
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
      {/* Kept on an empty page too, so that the way back to the earlier pages stays in view. */}
      {view === "audit" && entries !== null && (entries.rows.length > 0 || page > 0) ? <Pager page={page} hasMore={entries.hasNext} busy={audit.loading} onPage={setPage} /> : null}
      {view === "incidents" && incidents.data === null ? <Loading /> : null}
      {view === "incidents" && incidents.data !== null && incidents.data.items.length === 0 ? <p className="card empty">{t("office.audit.empty")}</p> : null}
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
                  {file.client === null ? "" : `${file.client.code} ${file.client.corporateName}`} · {t("office.audit.incidentWithdrawnAt", { at: formatDateTime(file.withdrawnAt) })}
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
