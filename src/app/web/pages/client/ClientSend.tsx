import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import type { DocTypes, Submission } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { formatDateTime, formatSize } from "../../components/format";
import { ErrorNotice, IndividualNumberNotice, Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

/** Send one file to the office, and see what was sent and whether the office has confirmed it. */
export function ClientSend() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const types = useLoad<DocTypes>(() => api.get<DocTypes>(`/api/client/${clientId}/doc-types`), [clientId]);
  const sent = useLoad<{ items: Submission[] }>(() => api.get<{ items: Submission[] }>(`/api/client/${clientId}/submissions`), [clientId]);
  const action = useAction();
  const [docTypeId, setDocTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (file === null) {
      return;
    }
    void action
      .run(async () => {
        const form = new FormData();
        form.set("file", file, file.name);
        form.set("docTypeId", docTypeId);
        form.set("targetMonth", targetMonth);
        await api.upload(`/api/client/${clientId}/submissions`, form);
        setFile(null);
        sent.reload();
      });
  };

  const cancel = (submission: Submission) => () => {
    void action.run(() => api.post(`/api/client/${clientId}/submissions/${submission.id}/cancel`, { version: submission.version })).then(() => sent.reload());
  };

  return (
    <div className="page">
      <h1 className="title">{t("client.send.title")}</h1>
      <IndividualNumberNotice />
      <ErrorNotice error={action.error} />
      <form className="card card--pad stack" onSubmit={send} aria-label={t("client.send.form")}>
        {types.data === null ? <Loading /> : null}
        <SelectField
          label={t("client.send.type")}
          value={docTypeId}
          options={[{ value: "", label: t("client.send.chooseType") }, ...(types.data?.inbound ?? []).map((type) => ({ value: type.id, label: type.label }))]}
          onChange={setDocTypeId}
        />
        <TextField label={t("client.send.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
        <label className="field">
          <span className="field__label">{t("client.send.file")}</span>
          <input type="file" className="input" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        <Notice tone="info">{t("client.send.formats")}</Notice>
        <button type="submit" className="button button--primary button--block" disabled={action.busy || file === null || docTypeId === "" || targetMonth === ""}>
          {t("client.send.submit")}
        </button>
      </form>
      <section className="stack" aria-label={t("client.send.sent")}>
        <h2 className="subtitle">{t("client.send.sent")}</h2>
        {sent.data !== null && sent.data.items.length === 0 ? <p className="empty">{t("client.send.none")}</p> : null}
        <ul className="stack">
          {(sent.data?.items ?? []).map((submission) => (
            <li key={submission.id} className="card card--pad stack">
              <strong>{submission.displayName}</strong>
              <span className="muted">
                {submission.docType?.label ?? t("client.home.unknownType")} · {formatSize(submission.sizeBytes)} · {formatDateTime(submission.submittedAt)}
              </span>
              <span className="muted">{submission.acknowledgedAt === null ? t("client.send.waiting") : t("client.send.confirmed", { date: formatDateTime(submission.acknowledgedAt) })}</span>
              {submission.canCancel ? (
                <button type="button" className="button button--danger" disabled={action.busy} onClick={cancel(submission)}>
                  {t("client.send.cancel")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
