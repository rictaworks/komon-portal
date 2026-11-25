import { Link, useParams } from "react-router-dom";
import type { ClientHome as HomeView } from "../../api/client-types";
import { formatDateTime } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

/** The company's new documents and its cases. */
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
      <h1 className="title">{t("client.home.title")}</h1>
      <section className="stack" aria-label={t("client.home.newDocuments")}>
        <h2 className="subtitle">{t("client.home.newDocuments")}</h2>
        {home.data.unread.length === 0 ? <p className="empty">{t("client.home.noNew")}</p> : null}
        <ul className="list card">
          {home.data.unread.map((document) => (
            <li key={document.id}>
              <Link className="list__item" to={`/client/${clientId}/documents`}>
                <span className="grow stack stack--tight">
                  <strong>{document.displayName}</strong>
                  <span className="muted">
                    {document.docType?.label ?? t("client.home.unknownType")} · {formatDateTime(document.publishedAt)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {home.data.truncated.documents ? <Notice tone="info">{t("client.home.moreDocuments")}</Notice> : null}
      </section>
      <section className="stack" aria-label={t("client.home.cases")}>
        <h2 className="subtitle">{t("client.home.cases")}</h2>
        {home.data.cases.length === 0 ? <p className="empty">{t("client.home.noCases")}</p> : null}
        <ul className="list card">
          {home.data.cases.map((record) => (
            <li key={record.id} className="list__item">
              <span className="grow stack stack--tight">
                <strong>{record.typeLabel}</strong>
                <span className="muted">{record.targetMonth}</span>
              </span>
              <span className="muted">{t(`caseState.${record.state}`)}</span>
            </li>
          ))}
        </ul>
        {home.data.truncated.cases ? <Notice tone="info">{t("client.home.moreCases")}</Notice> : null}
      </section>
    </div>
  );
}
