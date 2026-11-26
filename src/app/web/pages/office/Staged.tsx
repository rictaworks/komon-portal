import { faBan, faCircleCheck } from "@fortawesome/free-solid-svg-icons";
import { useMemo, useState } from "react";
import type { ClientRef, FileView, PublishResult } from "../../api/office-types";
import { ClientPicker } from "../../components/ClientPicker";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { SelectField } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { ErrorNotice } from "../../components/Notice";
import { FileStateBadge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { rowsOutside } from "./list-limit";
import { stagedFilesPath, UNCLASSIFIED } from "./staged-filter";
import { useSettings } from "./useMasterData";

interface Group {
  client: ClientRef;
  files: FileView[];
}

function groupByClient(files: readonly FileView[]): Group[] {
  const groups = new Map<string, Group>();
  for (const file of files) {
    if (file.client !== null) {
      const group = groups.get(file.client.id) ?? { client: file.client, files: [] };
      group.files.push(file);
      groups.set(file.client.id, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.client.code.localeCompare(b.client.code));
}

export function Staged() {
  const t = useT();
  const { api } = useSession();
  const settings = useSettings();
  const action = useAction();
  const [client, setClient] = useState<ClientRef | null>(null);
  const [docType, setDocType] = useState("");
  const clientId = client?.id ?? "";
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<{ result: PublishResult; name: string }[] | null>(null);
  // The server narrows by client and by type, "no type" included, so the list is never a part picked out of another list.
  const path = stagedFilesPath({ clientId, docType });
  const files = useLoad<{ items: FileView[]; total: number }>(() => api.get<{ items: FileView[]; total: number }>(path), [path]);
  // Only documents that are listed can be selected, published or sent back.
  const visible = useMemo(() => files.data?.items ?? [], [files.data]);
  // Rows the server holds beyond the list. They are not shown, so they cannot be published or sent back from here.
  const outside = files.data === null ? 0 : rowsOutside(visible.length, files.data.total);
  const groups = useMemo(() => groupByClient(visible), [visible]);
  const selected = visible.filter((file) => checked.has(file.id));
  const outbound = (settings.data?.docTypes ?? []).filter((type) => type.direction !== "Inbound");
  const selectedGroups = groupByClient(selected);

  const toggle = (ids: readonly string[], on: boolean): void => {
    setChecked((current) => {
      const next = new Set(current);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  };

  const publish = (): void => {
    setConfirming(false);
    void action.run(async () => {
      const response = await api.post<{ results: PublishResult[] }>("/api/office/publish", { items: selected.map((file) => ({ fileId: file.id, version: file.version })) });
      setResults(response.results.map((result) => ({ result, name: selected.find((file) => file.id === result.fileId)?.displayName ?? result.fileId })));
      setChecked(new Set());
      files.reload();
    });
  };

  const sendBack = (): void => {
    void action.run(async () => {
      try {
        for (const file of selected) {
          await api.post(`/api/office/files/${file.id}/send-back`, { version: file.version });
        }
      } finally {
        // Whatever was sent back, the list shows the server's state, not the state before the attempt.
        setChecked(new Set());
        files.reload();
      }
    });
  };

  return (
    <div className="page">
      <div className="row row--end">
        <h1 className="title grow">{t("office.staged.title")}</h1>
        <ClientPicker label={t("office.columns.client")} emptyLabel={t("office.allClients")} value={client} onChange={setClient} status={null} compact />
        <SelectField
          label={t("office.staged.type")}
          value={docType}
          options={[{ value: "", label: t("office.staged.allTypes") }, ...outbound.map((type) => ({ value: type.id, label: `${type.shortCode} ${type.label}` })), { value: UNCLASSIFIED, label: t("office.unclassified") }]}
          onChange={setDocType}
        />
      </div>
      <ErrorNotice error={files.error ?? action.error} />
      {files.data === null || outside === 0 ? null : <p className="muted">{t("office.shownOf", { shown: visible.length, total: files.data.total })}</p>}
      <ErrorNotice error={settings.error} />
      {files.loading && files.data === null ? <Loading /> : null}
      <div className="split">
        <section className="split__main stack" aria-label={t("office.staged.list")}>
          {files.data !== null && groups.length === 0 ? <p className="card empty">{t("office.staged.empty")}</p> : null}
          {groups.map((group) => {
            const ids = group.files.map((file) => file.id);
            const all = ids.every((id) => checked.has(id));
            return (
              <div key={group.client.id} className="card card--open">
                <label className="banner banner--fixed">
                  <input type="checkbox" checked={all} aria-label={t("office.staged.selectAll", { client: group.client.code })} onChange={(event) => toggle(ids, event.target.checked)} />
                  <span className="banner__code">{group.client.code}</span>
                  <span className="banner__name">{group.client.corporateName}</span>
                  <span className="banner__label">{t("office.staged.selectedOf", { selected: ids.filter((id) => checked.has(id)).length, total: ids.length })}</span>
                </label>
                <ul className="list">
                  {group.files.map((file) => (
                    <li key={file.id}>
                      <label className="list__item">
                        <input type="checkbox" checked={checked.has(file.id)} onChange={(event) => toggle([file.id], event.target.checked)} />
                        <span className="grow stack stack--tight">
                          <strong>{file.displayName}</strong>
                          <span className="muted">
                            {file.docType?.label ?? t("office.unclassified")}
                            {file.resolutionMethod === null ? "" : `. ${t(`method.${file.resolutionMethod}`)}`}
                            {file.unmatchedArrivalNumber === null ? "" : `. ${t("office.intake.registerCase", { number: file.unmatchedArrivalNumber })}`}
                          </span>
                        </span>
                        <FileStateBadge state={file.state} />
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
        <section className="card card--pad card--emphasis split__side" aria-label={t("office.staged.confirmation")}>
          <h2 className="heading">{t("office.staged.publishCount", { count: selected.length })}</h2>
          <p className="muted">{t("office.staged.check")}</p>
          {outside === 0 ? null : <p className="muted">{t("office.staged.outside", { count: outside })}</p>}
          <table className="table">
            <thead>
              <tr>
                <th>{t("office.columns.client")}</th>
                <th className="table__num">{t("office.columns.documents")}</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroups.map((group) => (
                <tr key={group.client.id}>
                  <td>
                    <span className="code">{group.client.code}</span> {group.client.corporateName}
                  </td>
                  <td className="table__num">{group.files.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="button button--primary button--block" disabled={action.busy || selected.length === 0} onClick={() => setConfirming(true)}>
            {t("office.staged.publish", { count: selectedGroups.length })}
          </button>
          <button type="button" className="button button--block" disabled={action.busy || selected.length === 0} onClick={sendBack}>
            {t("office.staged.sendBack")}
          </button>
          {results === null ? null : (
            <div className="stack">
              <strong>{t("office.staged.lastPublish")}</strong>
              {results.map(({ result, name }) => (
                <span key={result.fileId} className="row row--top">
                  <Icon icon={result.outcome === "published" ? faCircleCheck : faBan} />
                  <span className="grow">
                    {result.outcome === "published"
                      ? t(result.warning === undefined ? "office.staged.published" : "office.staged.publishedWithWarning", { name })
                      : t("office.staged.skipped", { name, reason: t(`publishSkip.${result.reason}`) })}
                  </span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>
      <ConfirmDialog open={confirming} title={t("office.staged.dialogTitle", { count: selected.length })} confirmLabel={t("office.staged.dialogConfirm")} onConfirm={publish} onCancel={() => setConfirming(false)}>
        <p>{t("office.staged.dialogLead")}</p>
        <ul className="list">
          {selectedGroups.map((group) => (
            <li key={group.client.id} className="list__item">
              <span className="code">{group.client.code}</span>
              <span className="grow">{group.client.corporateName}</span>
              <strong>{t("office.staged.dialogCount", { count: group.files.length })}</strong>
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
