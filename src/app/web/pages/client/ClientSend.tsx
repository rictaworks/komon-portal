import { faUpload, faXmark } from "@fortawesome/free-solid-svg-icons";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import type { DocTypes, ListPage, SendResult, Submission } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { formatSize } from "../../components/format";
import { Icon } from "../../components/Icon";
import { ErrorNotice, IndividualNumberNotice, Notice } from "../../components/Notice";
import { Pager } from "../../components/Pager";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { sendEach, submissionsPath, unsent } from "./client-lists";
import { SendResults, SubmissionCard, type SendRow } from "./ClientRows";

/** A file chosen on this screen. The key keeps two files of the same name apart. */
interface Chosen {
  key: string;
  file: File;
}

/** Send files to the office, each with its own result, and see what was sent and whether the office has confirmed it. */
export function ClientSend() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const [page, setPage] = useState(0);
  const types = useLoad<DocTypes>(() => api.get<DocTypes>(`/api/client/${clientId}/doc-types`), [clientId]);
  const sent = useLoad<ListPage<Submission>>(() => api.get<ListPage<Submission>>(submissionsPath(clientId, page)), [clientId, page]);
  const sending = useAction();
  const cancelling = useAction();
  const picker = useRef<HTMLInputElement>(null);
  const picked = useRef(0);
  const [docTypeId, setDocTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [rows, setRows] = useState<SendRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = sending.busy || cancelling.busy;

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const added = [...(event.target.files ?? [])].map((file) => {
      picked.current += 1;
      return { key: String(picked.current), file };
    });
    setChosen((current) => [...current, ...added]);
    // The same file can be chosen again after it was removed.
    event.target.value = "";
  };

  const send = (event: FormEvent): void => {
    event.preventDefault();
    if (chosen.length === 0 || busy) {
      return;
    }
    const batch = chosen;
    setRows([]);
    void sending.run(async () => {
      // One file per request, in order, so that every file gets its own result.
      const outcomes = await sendEach(
        batch,
        (item) => {
          const form = new FormData();
          form.set("file", item.file, item.file.name);
          form.set("docTypeId", docTypeId);
          form.set("targetMonth", targetMonth);
          return api.upload<SendResult>(`/api/client/${clientId}/submissions`, form);
        },
        (index, outcome) => {
          const item = batch[index];
          if (item === undefined) {
            throw new Error("a result arrived for a file that was not sent");
          }
          setProgress({ done: index + 1, total: batch.length });
          setRows((current) => [...current, { key: item.key, fileName: item.file.name, outcome }]);
        },
      );
      setProgress(null);
      // Only a stored file is sent. Anything else stays chosen, so the member can see why and decide again.
      setChosen(unsent(batch, outcomes));
      setPage(0);
      sent.reload();
    });
  };

  const cancel = (submission: Submission): void => {
    void cancelling.run(() => api.post(`/api/client/${clientId}/submissions/${submission.id}/cancel`, { version: submission.version })).then(() => sent.reload());
  };

  return (
    <div className="page">
      <h1 className="title">{t("client.send.title")}</h1>
      <IndividualNumberNotice />
      <ErrorNotice error={sending.error ?? cancelling.error ?? sent.error} />
      <form className="card card--pad stack" onSubmit={send} aria-label={t("client.send.form")}>
        {types.data === null ? <Loading /> : null}
        <SelectField
          label={t("client.send.type")}
          value={docTypeId}
          options={[{ value: "", label: t("client.send.chooseType") }, ...(types.data?.inbound ?? []).map((type) => ({ value: type.id, label: type.label }))]}
          onChange={setDocTypeId}
        />
        <TextField label={t("client.send.month")} type="month" value={targetMonth} onChange={setTargetMonth} />
        <button type="button" className="chooser" disabled={busy} onClick={() => picker.current?.click()}>
          <Icon icon={faUpload} />
          {t("client.send.chooseFiles")}
        </button>
        <input ref={picker} className="visually-hidden" type="file" multiple tabIndex={-1} aria-label={t("client.send.chooseFiles")} onChange={onPick} />
        <span className="muted">{t("client.send.formats")}</span>
        {chosen.length === 0 ? null : (
          <ul className="list card" aria-label={t("client.send.chosen")}>
            {chosen.map((item) => (
              <li key={item.key} className="list__item">
                <span className="grow stack stack--tight">
                  <strong className="wrap">{item.file.name}</strong>
                  <span className="muted">{formatSize(item.file.size)}</span>
                </span>
                <button type="button" className="button button--small" disabled={busy} onClick={() => setChosen((current) => current.filter((other) => other.key !== item.key))}>
                  <Icon icon={faXmark} />
                  {t("client.send.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="submit" className="button button--primary button--block" disabled={busy || chosen.length === 0 || docTypeId === "" || targetMonth === ""}>
          {t("client.send.submit")}
        </button>
      </form>
      {progress === null ? null : <Notice tone="info">{t("client.send.progress", { done: progress.done, total: progress.total })}</Notice>}
      <SendResults rows={rows} />
      <section className="stack" aria-label={t("client.send.sent")}>
        <h2 className="subtitle">{t("client.send.sent")}</h2>
        {sent.data === null ? (
          sent.error === null ? <Loading /> : null
        ) : (
          <>
            {sent.data.items.length === 0 ? (
              <p className="empty">{t("client.send.none")}</p>
            ) : (
              <ul className="list stack">
                {sent.data.items.map((submission) => (
                  <li key={submission.id}>
                    <SubmissionCard submission={submission} busy={busy} onCancel={cancel} />
                  </li>
                ))}
              </ul>
            )}
            <Pager page={page} hasMore={sent.data.hasMore} busy={sent.loading} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
