import { useParams } from "react-router-dom";
import type { ClientHome as HomeView } from "../../api/client-types";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { CaseRow, NewDocumentsHeading, UnreadRow } from "./ClientRows";

/** The company's new documents, first and with their count, and then its cases. */
export function ClientHome() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const home = useLoad<HomeView>(() => api.get<HomeView>(`/api/client/${clientId}/home`), [clientId]);
  if (home.data === null) {
    return home.error === null ? <Loading /> : <ErrorNotice error={home.error} />;
  }
  return (
    <div className="page">
      <section className="stack" aria-label={t("client.home.newDocuments")}>
        <NewDocumentsHeading count={home.data.unreadTotal} />
        {home.data.unread.length === 0 ? (
          <p className="empty">{t("client.home.noNew")}</p>
        ) : (
          <ul className="list stack">
            {home.data.unread.map((document) => (
              <li key={document.id}>
                <UnreadRow clientId={clientId} document={document} />
              </li>
            ))}
          </ul>
        )}
        {home.data.truncated.documents ? <Notice tone="info">{t("client.home.moreDocuments")}</Notice> : null}
      </section>
      <section className="stack" aria-label={t("client.home.cases")}>
        <h2 className="subtitle">{t("client.home.cases")}</h2>
        {home.data.cases.length === 0 ? (
          <p className="empty">{t("client.home.noCases")}</p>
        ) : (
          <ul className="list card">
            {home.data.cases.map((record) => (
              <li key={record.id} className="list__item">
                <CaseRow record={record} />
              </li>
            ))}
          </ul>
        )}
        {home.data.truncated.cases ? <Notice tone="info">{t("client.home.moreCases")}</Notice> : null}
      </section>
    </div>
  );
}
