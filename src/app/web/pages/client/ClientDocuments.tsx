import { useState } from "react";
import { useParams } from "react-router-dom";
import { followDownload, openFile, type OpenMode } from "../../api/client";
import type { ClientDocument, DocTypes } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { formatDateTime, formatSize } from "../../components/format";
import { ErrorNotice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

/** Published documents of the company, filtered by type and month. Opening one records the first view. */
export function ClientDocuments() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const [docTypeId, setDocTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const types = useLoad<DocTypes>(() => api.get<DocTypes>(`/api/client/${clientId}/doc-types`), [clientId]);
  const documents = useLoad<{ items: ClientDocument[] }>(() => {
    const query = new URLSearchParams();
    if (docTypeId !== "") query.set("docTypeId", docTypeId);
    if (targetMonth !== "") query.set("targetMonth", targetMonth);
    const suffix = query.toString() === "" ? "" : `?${query.toString()}`;
    return api.get<{ items: ClientDocument[] }>(`/api/client/${clientId}/documents${suffix}`);
  }, [clientId, docTypeId, targetMonth]);
  const action = useAction();

  // The open is recorded by the server before the download starts, so the list can show it at once.
  const open = (document: ClientDocument, mode: OpenMode) => () => {
    void action.run(() => openFile(api, document.id, mode, followDownload)).then((ok) => {
      if (ok) {
        documents.reload();
      }
    });
  };

  return (
    <div className="page">
      <h1 className="title">{t("client.documents.title")}</h1>
      <ErrorNotice error={documents.error ?? action.error} />
      <div className="grid2">
        <SelectField
          label={t("client.documents.type")}
          value={docTypeId}
          options={[{ value: "", label: t("client.documents.allTypes") }, ...(types.data?.outbound ?? []).map((type) => ({ value: type.id, label: type.label }))]}
          onChange={setDocTypeId}
        />
        <TextField label={t("client.documents.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
      </div>
      {documents.data === null ? <Loading /> : null}
      {documents.data !== null && documents.data.items.length === 0 ? <p className="empty">{t("client.documents.empty")}</p> : null}
      <ul className="stack">
        {(documents.data?.items ?? []).map((document) => (
          <li key={document.id} className="card card--pad stack">
            <strong>{document.displayName}</strong>
            <span className="muted">
              {document.docType?.label ?? t("client.home.unknownType")} · {formatSize(document.sizeBytes)} · {formatDateTime(document.publishedAt)}
            </span>
            <span className="muted">{document.opened ? t("client.documents.opened") : t("client.documents.new")}</span>
            <div className="row">
              <button type="button" className="button" disabled={action.busy} onClick={open(document, "view")}>
                {t("client.documents.view")}
              </button>
              <button type="button" className="button button--primary" disabled={action.busy} onClick={open(document, "download")}>
                {t("client.documents.download")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
