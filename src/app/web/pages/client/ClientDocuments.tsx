import { useState } from "react";
import { useParams } from "react-router-dom";
import { followDownload, openFile, type OpenMode } from "../../api/client";
import type { ClientDocument, DocTypes, ListPage } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { ErrorNotice } from "../../components/Notice";
import { Pager } from "../../components/Pager";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { documentsPath } from "./client-lists";
import { DocumentCard } from "./ClientRows";
import { usePagedList } from "./usePagedList";

/** Published documents of the company, filtered by type and month, a page at a time. Opening one records the first view. */
export function ClientDocuments() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const [docTypeId, setDocTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const types = useLoad<DocTypes>(() => api.get<DocTypes>(`/api/client/${clientId}/doc-types`), [clientId]);
  // The company and the filter name the list: a new filter is a new list, which starts again at its first page.
  const documents = usePagedList<ClientDocument>(JSON.stringify([clientId, docTypeId, targetMonth]), (page) =>
    api.get<ListPage<ClientDocument>>(documentsPath(clientId, { docTypeId, targetMonth, page })),
  );
  const action = useAction();

  // The open is recorded by the server before the download starts, so the list can show it at once.
  const open = (document: ClientDocument, mode: OpenMode): void => {
    void action.run(() => openFile(api, document.id, mode, followDownload)).then((ok) => {
      if (ok) {
        documents.reload();
      }
    });
  };

  return (
    <div className="page">
      <h1 className="title">{t("client.documents.title")}</h1>
      <ErrorNotice error={action.error} />
      <div className="grid2">
        <SelectField
          label={t("client.documents.type")}
          value={docTypeId}
          options={[{ value: "", label: t("client.documents.allTypes") }, ...(types.data?.outbound ?? []).map((type) => ({ value: type.id, label: type.label }))]}
          onChange={setDocTypeId}
        />
        <TextField label={t("client.documents.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
      </div>
      {documents.shown === null ? (
        documents.error === null ? <Loading /> : <ErrorNotice error={documents.error} />
      ) : (
        <>
          {documents.shown.items.length === 0 ? (
            <p className="empty">{t("client.documents.empty")}</p>
          ) : (
            <ul className="list stack">
              {documents.shown.items.map((document) => (
                <li key={document.id}>
                  <DocumentCard document={document} busy={action.busy} onOpen={open} />
                </li>
              ))}
            </ul>
          )}
          {/* A page that failed to load is reported beside the pager that asked for it; the rows above are still those of the page named here. */}
          <ErrorNotice error={documents.error} />
          <Pager page={documents.shown.page} hasMore={documents.shown.hasMore} busy={documents.loading} onPage={documents.goTo} />
        </>
      )}
    </div>
  );
}
