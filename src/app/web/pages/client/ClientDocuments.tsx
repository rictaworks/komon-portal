import { useState } from "react";
import { useParams } from "react-router-dom";
import { fileContentUrl } from "../../api/client";
import type { ClientDocument, DocTypes } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { formatDateTime, formatSize } from "../../components/format";
import { ErrorNotice } from "../../components/Notice";
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

  return (
    <div className="page">
      <h1 className="title">{t("client.documents.title")}</h1>
      <ErrorNotice error={documents.error} />
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
              <a className="button" href={fileContentUrl(document.id, "view")}>
                {t("client.documents.view")}
              </a>
              <a className="button button--primary" href={fileContentUrl(document.id, "download")}>
                {t("client.documents.download")}
              </a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
