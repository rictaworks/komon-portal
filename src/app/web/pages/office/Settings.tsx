import { useState, type FormEvent } from "react";
import type { DocTypeRecord, SettingsView, StaffList } from "../../api/office-types";
import { CheckField, SelectField, TextField } from "../../components/Form";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { isFixedModelName, loadJevSettings, removeJevSettings, saveJevSettings } from "./jev-settings";

const DIRECTIONS = ["Outbound", "Inbound", "Both"] as const;
const CASE_KINDS = ["Procedure", "Payroll", "Other"] as const;
const JEV_PRICING_URL = "https://docs.typesafe.ai/models";

/** Office settings, document and case types, staff, and the browser-held Jev key. */
/** Office-wide values. Owner only; Staff see them read-only as a notice. */
function OfficeSettingsForm({ view, canEdit, onSaved }: { view: SettingsView; canEdit: boolean; onSaved(): void }) {
  const t = useT();
  const { api } = useSession();
  const action = useAction();
  const [timezone, setTimezone] = useState(view.office.timezone);
  const [pattern, setPattern] = useState(view.office.arrivalNumberPattern);
  const [days, setDays] = useState(String(view.office.retrievalDeadlineDays));
  const [autoPublish, setAutoPublish] = useState(view.office.autoPublishEnabled);

  const save = (event: FormEvent) => {
    event.preventDefault();
    void action
      .run(() =>
        api.put("/api/office/settings/office", {
          timezone,
          arrivalNumberPattern: pattern,
          retrievalDeadlineDays: Number(days),
          autoPublishEnabled: autoPublish,
          version: view.office.version,
        }),
      )
      .then((ok) => ok && onSaved());
  };

  return (
    <section className="card card--pad stack" aria-label={t("office.settings.office")}>
      <h2 className="subtitle">{t("office.settings.office")}</h2>
      <ErrorNotice error={action.error} />
      {canEdit ? (
        <form className="stack" onSubmit={save}>
          <TextField label={t("office.settings.timezone")} value={timezone} onChange={setTimezone} />
          <TextField label={t("office.settings.arrivalPattern")} value={pattern} onChange={setPattern} mono hint={t("office.settings.arrivalHint")} />
          <TextField label={t("office.settings.retrievalDays")} type="number" value={days} onChange={setDays} />
          <CheckField checked={autoPublish} onChange={setAutoPublish}>
            {t("office.settings.autoPublish")}
          </CheckField>
          <button type="submit" className="button button--primary" disabled={action.busy}>
            {t("office.settings.save")}
          </button>
        </form>
      ) : (
        <Notice tone="info">{t("office.settings.ownerOnly")}</Notice>
      )}
    </section>
  );
}

export function Settings() {
  const t = useT();
  const { api, me } = useSession();
  const settings = useLoad<SettingsView>(() => api.get<SettingsView>("/api/office/settings"), []);
  const staff = useLoad<StaffList>(() => api.get<StaffList>("/api/office/staff"), []);
  const action = useAction();
  const isOwner = me?.user.officeRole === "Owner";

  const [docLabel, setDocLabel] = useState("");
  const [docShortCode, setDocShortCode] = useState("");
  const [docDirection, setDocDirection] = useState<string>("Outbound");
  const [ruleDocType, setRuleDocType] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [caseKind, setCaseKind] = useState<string>("Procedure");
  const [caseLabel, setCaseLabel] = useState("");
  const [staffRole, setStaffRole] = useState<string>("Staff");

  const jevStored = loadJevSettings();
  const [jevKey, setJevKey] = useState("");
  const [jevModel, setJevModel] = useState(jevStored.model);
  const [jevError, setJevError] = useState<string | null>(null);

  const refresh = () => {
    settings.reload();
    staff.reload();
  };

  const addDocType = () => {
    void action
      .run(() => api.post("/api/office/doc-types", { label: docLabel, shortCode: docShortCode, direction: docDirection }))
      .then((ok) => {
        if (ok) {
          setDocLabel("");
          setDocShortCode("");
          refresh();
        }
      });
  };

  const addRule = () => {
    void action
      .run(() => api.post("/api/office/doc-rules", { docTypeId: ruleDocType, keyword: ruleKeyword }))
      .then((ok) => {
        if (ok) {
          setRuleKeyword("");
          refresh();
        }
      });
  };

  const removeRule = (id: string) => () => {
    void action.run(() => api.delete(`/api/office/doc-rules/${id}`)).then((ok) => ok && refresh());
  };

  const addCaseType = () => {
    void action
      .run(() => api.post("/api/office/case-types", { kind: caseKind, label: caseLabel }))
      .then((ok) => {
        if (ok) {
          setCaseLabel("");
          refresh();
        }
      });
  };

  const inviteStaff = () => {
    void action.run(() => api.post("/api/office/staff/invitations", { role: staffRole })).then((ok) => ok && refresh());
  };

  const staffAction = (userId: string, verb: "approve" | "reject" | "revoke") => () => {
    void action.run(() => api.post(`/api/office/staff/${userId}/${verb}`, {})).then((ok) => ok && refresh());
  };

  const saveJev = () => {
    if (!isFixedModelName(jevModel)) {
      setJevError(t("office.settings.jev.aliasRejected"));
      return;
    }
    if (jevKey.trim() === "") {
      setJevError(t("office.settings.jev.keyMissing"));
      return;
    }
    setJevError(null);
    saveJevSettings({ key: jevKey.trim(), model: jevModel });
    setJevKey("");
  };

  const forgetJev = () => {
    removeJevSettings();
    setJevModel(loadJevSettings().model);
    setJevKey("");
  };

  if (settings.data === null) {
    return <div className="page">{settings.error === null ? <Loading /> : <ErrorNotice error={settings.error} />}</div>;
  }
  const current = settings.data;

  return (
    <div className="page">
      <h1 className="title">{t("office.settings.title")}</h1>
      <ErrorNotice error={action.error ?? settings.error ?? staff.error} />

      <OfficeSettingsForm view={current} canEdit={isOwner && current.canEditOffice} onSaved={refresh} />

      <section className="card card--pad stack" aria-label={t("office.settings.docTypes")}>
        <h2 className="subtitle">{t("office.settings.docTypes")}</h2>
        <ul className="list">
          {current.docTypes.map((type: DocTypeRecord) => (
            <li key={type.id} className="list__item">
              <span className="code">{type.shortCode}</span>
              <span className="grow">{type.label}</span>
              <span className="muted">{t(`direction.${type.direction}`)}</span>
            </li>
          ))}
        </ul>
        <div className="grid2">
          <TextField label={t("office.settings.label")} value={docLabel} onChange={setDocLabel} />
          <TextField label={t("office.settings.shortCode")} value={docShortCode} onChange={setDocShortCode} mono />
        </div>
        <SelectField label={t("office.settings.direction")} value={docDirection} options={DIRECTIONS.map((value) => ({ value, label: t(`direction.${value}`) }))} onChange={setDocDirection} />
        <button type="button" className="button" disabled={action.busy || docLabel === "" || docShortCode === ""} onClick={addDocType}>
          {t("office.settings.addDocType")}
        </button>
        <h3 className="heading">{t("office.settings.rules")}</h3>
        <ul className="list">
          {current.docRules.map((rule) => (
            <li key={rule.id} className="list__item">
              <span className="grow code">{rule.keyword}</span>
              <button type="button" className="button button--danger" disabled={action.busy} onClick={removeRule(rule.id)}>
                {t("office.settings.removeRule")}
              </button>
            </li>
          ))}
        </ul>
        <div className="grid2">
          <SelectField label={t("office.settings.docType")} value={ruleDocType} options={[{ value: "", label: t("office.settings.chooseDocType") }, ...current.docTypes.map((type) => ({ value: type.id, label: type.label }))]} onChange={setRuleDocType} />
          <TextField label={t("office.settings.keyword")} value={ruleKeyword} onChange={setRuleKeyword} />
        </div>
        <button type="button" className="button" disabled={action.busy || ruleDocType === "" || ruleKeyword === ""} onClick={addRule}>
          {t("office.settings.addRule")}
        </button>
      </section>

      <section className="card card--pad stack" aria-label={t("office.settings.caseTypes")}>
        <h2 className="subtitle">{t("office.settings.caseTypes")}</h2>
        <ul className="list">
          {current.caseTypes.map((type) => (
            <li key={type.id} className="list__item">
              <span className="grow">{type.label}</span>
              <span className="muted">{t(`caseKind.${type.kind}`)}</span>
            </li>
          ))}
        </ul>
        <div className="grid2">
          <SelectField label={t("office.settings.caseKind")} value={caseKind} options={CASE_KINDS.map((value) => ({ value, label: t(`caseKind.${value}`) }))} onChange={setCaseKind} />
          <TextField label={t("office.settings.label")} value={caseLabel} onChange={setCaseLabel} />
        </div>
        <button type="button" className="button" disabled={action.busy || caseLabel === ""} onClick={addCaseType}>
          {t("office.settings.addCaseType")}
        </button>
      </section>

      {isOwner ? (
        <section className="card card--pad stack" aria-label={t("office.settings.staff")}>
          <h2 className="subtitle">{t("office.settings.staff")}</h2>
          <ul className="list">
            {(staff.data?.members ?? []).map((member) => (
              <li key={member.userId} className="list__item">
                <span className="grow">{member.displayName}</span>
                <span className="muted">{member.officeRole === null ? "" : t(`role.${member.officeRole}`)}</span>
                {member.officeStatus === "Pending" ? (
                  <>
                    <button type="button" className="button" disabled={action.busy} onClick={staffAction(member.userId, "approve")}>
                      {t("office.clients.approve")}
                    </button>
                    <button type="button" className="button button--danger" disabled={action.busy} onClick={staffAction(member.userId, "reject")}>
                      {t("office.clients.reject")}
                    </button>
                  </>
                ) : null}
                {member.officeStatus === "Active" && member.userId !== me?.user.id ? (
                  <button type="button" className="button button--danger" disabled={action.busy} onClick={staffAction(member.userId, "revoke")}>
                    {t("office.clients.revoke")}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="grid2">
            <SelectField label={t("office.settings.staffRole")} value={staffRole} options={[{ value: "Staff", label: t("role.Staff") }, { value: "Owner", label: t("role.Owner") }]} onChange={setStaffRole} />
          </div>
          <button type="button" className="button" disabled={action.busy} onClick={inviteStaff}>
            {t("office.settings.inviteStaff")}
          </button>
        </section>
      ) : null}

      <section className="card card--pad stack" aria-label={t("office.settings.jev.title")}>
        <h2 className="subtitle">{t("office.settings.jev.title")}</h2>
        <Notice tone="info">
          {t("office.settings.jev.note")} <a href={JEV_PRICING_URL} target="_blank" rel="noopener noreferrer">{t("office.settings.jev.pricing")}</a>
        </Notice>
        <TextField label={t("office.settings.jev.model")} value={jevModel} onChange={setJevModel} mono hint={t("office.settings.jev.modelHint")} />
        <TextField label={t("office.settings.jev.key")} type="password" value={jevKey} onChange={setJevKey} mono hint={t("office.settings.jev.keyHint")} />
        {jevError === null ? null : <Notice tone="danger">{jevError}</Notice>}
        <div className="row">
          <button type="button" className="button button--primary" disabled={action.busy} onClick={saveJev}>
            {t("office.settings.jev.save")}
          </button>
          <button type="button" className="button" disabled={action.busy} onClick={forgetJev}>
            {t("office.settings.jev.forget")}
          </button>
        </div>
      </section>
    </div>
  );
}
