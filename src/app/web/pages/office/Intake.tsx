import { faUpload } from "@fortawesome/free-solid-svg-icons";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Link } from "react-router-dom";
import type { ClassificationResult, FileView, IntakeResult } from "../../api/office-types";
import { SelectField } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { ErrorNotice, IndividualNumberNotice, Notice } from "../../components/Notice";
import { Badge, FileStateBadge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { loadJevSettings } from "./jev-settings";
import { clientOptions, useClients } from "./useMasterData";

interface Row {
  key: string;
  /** Kept in memory for this screen only: needed to ask the classifier, never sent for storage. */
  fileName: string;
  result: IntakeResult | { outcome: "failed"; error: unknown };
}

function fileOf(row: Row): FileView | null {
  if (row.result.outcome === "stored") {
    return row.result.file;
  }
  return row.result.outcome === "duplicate" ? row.result.existing : null;
}

export function Intake() {
  const t = useT();
  const { api } = useSession();
  const clients = useClients();
  const upload = useAction();
  const classify = useAction();
  const [hint, setHint] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [classified, setClassified] = useState<ClassificationResult[] | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  const takeIn = (files: File[]): void => {
    // One batch at a time: a second drop while an upload runs would interleave two result lists.
    if (files.length === 0 || upload.busy) {
      return;
    }
    setClassified(null);
    void upload.run(async () => {
      const batch = await api.post<{ id: string }>("/api/office/batches", hint === "" ? {} : { hintClientId: hint });
      setRows([]);
      // One file per request, in order, so that every file gets its own result.
      for (const [index, file] of files.entries()) {
        setProgress({ done: index, total: files.length });
        const form = new FormData();
        form.set("file", file, file.name);
        let row: Row;
        try {
          row = { key: `${batch.id}-${index}`, fileName: file.name, result: await api.upload<IntakeResult>(`/api/office/batches/${batch.id}/files`, form) };
        } catch (error) {
          row = { key: `${batch.id}-${index}`, fileName: file.name, result: { outcome: "failed", error } };
        }
        setRows((current) => [...current, row]);
      }
      setProgress(null);
    });
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    takeIn([...(event.target.files ?? [])]);
    event.target.value = "";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    takeIn([...event.dataTransfer.files]);
  };

  const unclassified = rows.filter((row) => row.result.outcome === "stored" && row.result.file.docType === null);

  const runClassifier = (): void => {
    const jev = loadJevSettings();
    void classify.run(async () => {
      const report = await api.post<{ results: ClassificationResult[] }>(
        "/api/office/classify",
        { model: jev.model, items: unclassified.map((row) => ({ fileId: fileOf(row)?.id ?? "", fileName: row.fileName })) },
        { "X-Jev-Key": jev.key },
      );
      setClassified(report.results);
    });
  };

  const count = (outcome: Row["result"]["outcome"], state?: string): number =>
    rows.filter((row) => row.result.outcome === outcome && (state === undefined || (row.result.outcome === "stored" && row.result.file.state === state))).length;

  return (
    <div className="page">
      <h1 className="title">{t("office.intake.title")}</h1>
      <IndividualNumberNotice />
      <ErrorNotice error={upload.error} />
      <section className="card card--pad">
        <div className="split">
          <div
            className={`dropzone split__main${dragging ? " dropzone--active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <Icon icon={faUpload} />
            <strong>{t("office.intake.drop")}</strong>
            <span className="muted">{t("office.intake.formats")}</span>
            <div className="row">
              <button type="button" className="button button--primary" disabled={upload.busy} onClick={() => filePicker.current?.click()}>
                {t("office.intake.chooseFiles")}
              </button>
              <button type="button" className="button" disabled={upload.busy} onClick={() => folderPicker.current?.click()}>
                {t("office.intake.chooseFolder")}
              </button>
            </div>
            <input ref={filePicker} className="visually-hidden" type="file" multiple tabIndex={-1} aria-label={t("office.intake.chooseFiles")} onChange={onPick} />
            <input
              ref={folderPicker}
              className="visually-hidden"
              type="file"
              multiple
              tabIndex={-1}
              aria-label={t("office.intake.chooseFolder")}
              onChange={onPick}
              {...{ webkitdirectory: "" }}
            />
          </div>
          <div className="split__side stack">
            <SelectField
              label={t("office.intake.destination")}
              value={hint}
              options={[{ value: "", label: t("office.intake.noDestination") }, ...clientOptions(clients.data)]}
              onChange={setHint}
              hint={t("office.intake.destinationHint")}
            />
          </div>
        </div>
      </section>
      {progress === null ? null : <Notice tone="info">{t("office.intake.progress", { done: progress.done, total: progress.total })}</Notice>}
      {rows.length === 0 ? null : (
        <section className="card">
          <div className="card__head">
            <h2 className="subtitle grow">{t("office.intake.results")}</h2>
            <span>{t("office.intake.countStaged", { count: count("stored", "Staged") + count("stored", "Published") })}</span>
            <span>{t("office.intake.countReview", { count: count("stored", "NeedsReview") })}</span>
            <span>{t("office.intake.countDuplicate", { count: count("duplicate") })}</span>
            <span>{t("office.intake.countRejected", { count: count("rejected") + count("failed") })}</span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("office.columns.document")}</th>
                  <th>{t("office.columns.result")}</th>
                  <th>{t("office.columns.client")}</th>
                  <th>{t("office.columns.decidedBy")}</th>
                  <th>{t("office.columns.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const file = fileOf(row);
                  const jev = classified?.find((entry) => entry.fileId === file?.id);
                  return (
                    <tr key={row.key}>
                      <td>
                        <strong>{file?.displayName ?? t("office.intake.fileNumber", { number: index + 1 })}</strong>
                      </td>
                      <td>
                        {row.result.outcome === "stored" ? <FileStateBadge state={row.result.published ? "Published" : row.result.file.state} /> : null}
                        {row.result.outcome === "duplicate" ? <Badge tone="neutral" label={t("office.intake.duplicate")} /> : null}
                        {row.result.outcome === "rejected" || row.result.outcome === "failed" ? <Badge tone="danger" label={t("office.intake.rejected")} /> : null}
                      </td>
                      <td>{file?.client === null || file === null ? t("office.intake.notDecided") : `${file.client?.code} ${file.client?.corporateName}`}</td>
                      <td className="muted">{file?.resolutionMethod === null || file === null || file.resolutionMethod === undefined ? "" : t(`method.${file.resolutionMethod}`)}</td>
                      <td className="muted">
                        {row.result.outcome === "rejected" ? t(`rejection.${row.result.reason}`) : null}
                        {row.result.outcome === "failed" ? <ErrorNotice error={row.result.error} /> : null}
                        {row.result.outcome === "duplicate" ? t("office.intake.duplicateReason") : null}
                        {row.result.outcome === "stored" && file?.reviewReason ? t(`reviewReason.${file.reviewReason}`) : null}
                        {row.result.outcome === "stored" && file?.unmatchedArrivalNumber ? t("office.intake.registerCase", { number: file.unmatchedArrivalNumber }) : null}
                        {jev === undefined ? null : ` ${t(`office.intake.jev.${jev.outcome}`)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="card__foot">
            <span className="grow muted">{unclassified.length === 0 ? t("office.intake.allClassified") : t("office.intake.unclassified", { count: unclassified.length })}</span>
            <button type="button" className="button" disabled={classify.busy || unclassified.length === 0 || classified !== null} onClick={runClassifier}>
              {t("office.intake.classify")}
            </button>
            <Link className="button button--primary" to="/office/review">
              {t("office.intake.goToReview")}
            </Link>
          </div>
          {classify.error === null ? null : (
            <div className="card__foot">
              <div className="grow">
                <ErrorNotice error={classify.error} />
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
