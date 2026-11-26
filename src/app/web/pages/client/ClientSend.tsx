import { faUpload } from "@fortawesome/free-solid-svg-icons";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import type { DocTypes, ListPage, SendResult, Submission } from "../../api/client-types";
import { SelectField, TextField } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { ErrorNotice, IndividualNumberNotice, Notice } from "../../components/Notice";
import { Pager } from "../../components/Pager";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { followDownload, openFile } from "../../api/client";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { sendEach, submissionsPath, unsent } from "./client-lists";
import { ChosenFiles, SendResults, SubmissionCard, type SendRow } from "./ClientRows";
import { usePagedList } from "./usePagedList";

/** A file chosen on this screen. The key keeps two files of the same name apart; the number is fixed when it is chosen. */
interface Chosen {
  key: string;
  number: number;
  file: File;
}

/** Send files to the office, each with its own result, and see what was sent and whether the office has confirmed it. */
export function ClientSend() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const types = useLoad<DocTypes>(() => api.get<DocTypes>(`/api/client/${clientId}/doc-types`), [clientId]);
  const sent = usePagedList<Submission>(clientId, (page) => api.get<ListPage<Submission>>(submissionsPath(clientId, page)));
  const sending = useAction();
  const cancelling = useAction();
  const opening = useAction();
  const picker = useRef<HTMLInputElement>(null);
  const picked = useRef(0);
  const [docTypeId, setDocTypeId] = useState("");
  const [targetMonth, setTargetMonth] = useState("");
  const [chosen, setChosen] = useState<Chosen[]>([]);
  const [rows, setRows] = useState<SendRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = sending.busy || cancelling.busy || opening.busy;
  // Whether the member is still on this screen. A send that is under way stops before its next file once they leave.
  const onScreen = useRef(false);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const added = [...(event.target.files ?? [])].map((file) => {
      picked.current += 1;
      return { key: String(picked.current), number: picked.current, file };
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
          setRows((current) => [...current, { key: item.key, position: item.number, size: item.file.size, outcome }]);
        },
        () => onScreen.current,
      );
      if (!onScreen.current) {
        // The member left: the remaining files were not sent, and there is no screen to report on.
        return;
      }
      setProgress(null);
      // Only a stored file is sent. Anything else stays chosen, so the member can see why and decide again.
      setChosen(unsent(batch, outcomes));
      // The newest files are on the first page; asking for it again reloads it.
      sent.goTo(0);
    });
  };

  // The server answers with the existing copy's id only for a member who may open it; the open is recorded as usual.
  const openExisting = (fileId: string): void => {
    void opening.run(() => openFile(api, fileId, "view", followDownload));
  };

  const cancel = (submission: Submission): void => {
    void cancelling.run(() => api.post(`/api/client/${clientId}/submissions/${submission.id}/cancel`, { version: submission.version })).then(() => sent.reload());
  };

  return (
    <div className="page">
      <h1 className="title">{t("client.send.title")}</h1>
      <IndividualNumberNotice />
      <ErrorNotice error={sending.error ?? cancelling.error ?? opening.error} />
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
          <ChosenFiles
            files={chosen.map((item) => ({ key: item.key, number: item.number, size: item.file.size }))}
            busy={busy}
            onRemove={(key) => setChosen((current) => current.filter((other) => other.key !== key))}
          />
        )}
        <button type="submit" className="button button--primary button--block" disabled={busy || chosen.length === 0 || docTypeId === "" || targetMonth === ""}>
          {t("client.send.submit")}
        </button>
      </form>
      {progress === null ? null : <Notice tone="info">{t("client.send.progress", { done: progress.done, total: progress.total })}</Notice>}
      <SendResults rows={rows} busy={busy} onOpenExisting={openExisting} />
      <section className="stack" aria-label={t("client.send.sent")}>
        <h2 className="subtitle">{t("client.send.sent")}</h2>
        {sent.shown === null ? (
          sent.error === null ? <Loading /> : <ErrorNotice error={sent.error} />
        ) : (
          <>
            {sent.shown.items.length === 0 ? (
              <p className="empty">{t("client.send.none")}</p>
            ) : (
              <ul className="list stack">
                {sent.shown.items.map((submission) => (
                  <li key={submission.id}>
                    <SubmissionCard submission={submission} busy={busy} onCancel={cancel} />
                  </li>
                ))}
              </ul>
            )}
            {/* A page that failed to load is reported beside the pager that asked for it; the rows above are still those of the page named here. */}
            <ErrorNotice error={sent.error} />
            <Pager page={sent.shown.page} hasMore={sent.shown.hasMore} busy={sent.loading} onPage={sent.goTo} />
          </>
        )}
      </section>
    </div>
  );
}
