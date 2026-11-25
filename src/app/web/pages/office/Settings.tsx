import { faCopy } from "@fortawesome/free-solid-svg-icons";
import { useState, type FormEvent } from "react";
import type { DocTypeRecord, SettingsView, StaffList } from "../../api/office-types";
import { CheckField, Field, SelectField, TextField } from "../../components/Form";
import { Icon } from "../../components/Icon";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { isFixedModelName, loadJevSettings, removeJevSettings, saveJevSettings } from "./jev-settings";
import { JEV_THRESHOLD_MAX, JEV_THRESHOLD_MIN, JEV_THRESHOLD_STEP, copyText, docTypeUpdate, parseJevThreshold, submissionCaseTypeOptions, takesSubmissions } from "./settings-input";

const DIRECTIONS = ["Outbound", "Inbound", "Both"] as const;
const CASE_KINDS = ["Procedure", "Payroll", "Other"] as const;
const JEV_PRICING_URL = "https://docs.typesafe.ai/models";
const JEV_LIMITS_URL = "https://docs.typesafe.ai/model-jaggedness/jev-1.13";

function staffInviteLink(code: string): string {
  return `${window.location.origin}/redeem#${code}`;
}

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
  const [threshold, setThreshold] = useState(String(view.office.jevThreshold));
  const [thresholdInvalid, setThresholdInvalid] = useState(false);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const jevThreshold = parseJevThreshold(threshold);
    setThresholdInvalid(jevThreshold === null);
    if (jevThreshold === null) {
      return;
    }
    void action
      .run(() =>
        api.put("/api/office/settings/office", {
          timezone,
          arrivalNumberPattern: pattern,
          retrievalDeadlineDays: Number(days),
          autoPublishEnabled: autoPublish,
          jevThreshold,
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
        // Native validation is off: its step check would block every save while the stored threshold is off the
        // 0.01 grid, and its messages are not ours. The threshold is checked in save and again by the server.
        <form className="stack" noValidate onSubmit={save}>
          <TextField label={t("office.settings.timezone")} value={timezone} onChange={setTimezone} />
          <TextField label={t("office.settings.arrivalPattern")} value={pattern} onChange={setPattern} mono hint={t("office.settings.arrivalHint")} />
          <TextField label={t("office.settings.retrievalDays")} type="number" value={days} onChange={setDays} />
          <CheckField checked={autoPublish} onChange={setAutoPublish}>
            {t("office.settings.autoPublish")}
          </CheckField>
          <Field label={t("office.settings.jevThreshold")} hint={t("office.settings.jevThresholdHint")} error={thresholdInvalid ? t("errors.invalid_input.jev_threshold") : null}>
            {(id) => (
              <input
                id={id}
                className={thresholdInvalid ? "input input--narrow input--invalid" : "input input--narrow"}
                type="number"
                min={JEV_THRESHOLD_MIN}
                max={JEV_THRESHOLD_MAX}
                step={JEV_THRESHOLD_STEP}
                aria-invalid={thresholdInvalid ? true : undefined}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            )}
          </Field>
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

/** Staff members and staff invitations. Rendered for the Owner only, so the Owner-only list is never requested by Staff. */
function StaffSection() {
  const t = useT();
  const { api, me } = useSession();
  const staff = useLoad<StaffList>(() => api.get<StaffList>("/api/office/staff"), []);
  const action = useAction();
  const [staffRole, setStaffRole] = useState<string>("Staff");
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const inviteStaff = () => {
    void action.run(async () => {
      // The code is returned by this one response only; the server keeps its hash.
      const issued = await api.post<{ code: string }>("/api/office/staff/invitations", { role: staffRole });
      setIssuedLink(staffInviteLink(issued.code));
      setCopyState("idle");
      staff.reload();
    });
  };

  const copyLink = (link: string) => () => {
    // navigator.clipboard is undefined outside a secure context, whatever its DOM type says.
    const clipboard = navigator.clipboard as Clipboard | undefined;
    void copyText(clipboard, link).then((copied) => setCopyState(copied ? "copied" : "failed"));
  };

  const staffAction = (userId: string, verb: "approve" | "reject" | "revoke") => () => {
    void action.run(() => api.post(`/api/office/staff/${userId}/${verb}`, {})).then((ok) => ok && staff.reload());
  };

  return (
    <section className="card card--pad stack" aria-label={t("office.settings.staff")}>
      <h2 className="subtitle">{t("office.settings.staff")}</h2>
      <ErrorNotice error={action.error ?? staff.error} />
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
      {issuedLink === null ? null : (
        <div className="stack">
          <Notice tone="success">{t("office.settings.staffInviteIssued")}</Notice>
          <Field label={t("office.settings.staffInviteLink")} hint={t("office.settings.staffInviteHint")}>
            {(id) => <input id={id} className="input mono" readOnly value={issuedLink} />}
          </Field>
          <div className="row">
            <button type="button" className="button" onClick={copyLink(issuedLink)}>
              <Icon icon={faCopy} /> {t("office.settings.copyLink")}
            </button>
            {copyState === "copied" ? <span role="status">{t("office.settings.copied")}</span> : null}
          </div>
          {copyState === "failed" ? <Notice tone="danger">{t("office.settings.copyFailed")}</Notice> : null}
        </div>
      )}
    </section>
  );
}

export function Settings() {
  const t = useT();
  const { api, me } = useSession();
  const settings = useLoad<SettingsView>(() => api.get<SettingsView>("/api/office/settings"), []);
  const action = useAction();
  const isOwner = me?.user.officeRole === "Owner";

  const [docLabel, setDocLabel] = useState("");
  const [docShortCode, setDocShortCode] = useState("");
  const [docDirection, setDocDirection] = useState<string>("Outbound");
  const [docCaseType, setDocCaseType] = useState("");
  const [ruleDocType, setRuleDocType] = useState("");
  const [ruleKeyword, setRuleKeyword] = useState("");
  const [caseKind, setCaseKind] = useState<string>("Procedure");
  const [caseLabel, setCaseLabel] = useState("");

  const jevStored = loadJevSettings();
  const [jevKey, setJevKey] = useState("");
  const [jevModel, setJevModel] = useState(jevStored.model);
  const [jevError, setJevError] = useState<string | null>(null);

  const refresh = () => {
    settings.reload();
  };

  const addDocType = () => {
    void action
      .run(() => api.post("/api/office/doc-types", { label: docLabel, shortCode: docShortCode, direction: docDirection, caseTypeId: docCaseType === "" ? null : docCaseType }))
      .then((ok) => {
        if (ok) {
          setDocLabel("");
          setDocShortCode("");
          setDocCaseType("");
          refresh();
        }
      });
  };

  const setDocTypeCaseType = (docType: DocTypeRecord) => (choice: string) => {
    void action.run(() => api.put(`/api/office/doc-types/${docType.id}`, docTypeUpdate(docType, choice))).then((ok) => ok && refresh());
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
  const docTypeById = new Map(current.docTypes.map((type) => [type.id, type]));
  const caseTypeById = new Map(current.caseTypes.map((type) => [type.id, type]));
  const docCaseTypeOptions = submissionCaseTypeOptions(current.caseTypes, t("office.settings.docCaseTypeNone"));

  return (
    <div className="page">
      <h1 className="title">{t("office.settings.title")}</h1>
      <ErrorNotice error={action.error ?? settings.error} />

      <OfficeSettingsForm view={current} canEdit={isOwner && current.canEditOffice} onSaved={refresh} />

      <section className="card card--pad stack" aria-label={t("office.settings.docTypes")}>
        <h2 className="subtitle">{t("office.settings.docTypes")}</h2>
        <ul className="list">
          {current.docTypes.map((type: DocTypeRecord) => (
            <li key={type.id} className="list__item">
              <span className="code">{type.shortCode}</span>
              <span className="grow">{type.label}</span>
              {takesSubmissions(type) ? (
                <select
                  className="input input--inline"
                  aria-label={t("office.settings.docCaseTypeFor", { docType: type.label })}
                  value={type.caseTypeId ?? ""}
                  disabled={action.busy}
                  onChange={(event) => setDocTypeCaseType(type)(event.target.value)}
                >
                  {docCaseTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : type.caseTypeId === null ? null : (
                <span className="muted">
                  {t("office.settings.docCaseTypeLinked", { caseType: caseTypeById.get(type.caseTypeId)?.label ?? t("office.settings.docCaseTypeUnknown") })}
                </span>
              )}
              <span className="muted">{t(`direction.${type.direction}`)}</span>
            </li>
          ))}
        </ul>
        <div className="grid2">
          <TextField label={t("office.settings.label")} value={docLabel} onChange={setDocLabel} />
          <TextField label={t("office.settings.shortCode")} value={docShortCode} onChange={setDocShortCode} mono />
        </div>
        <div className="grid2">
          <SelectField label={t("office.settings.direction")} value={docDirection} options={DIRECTIONS.map((value) => ({ value, label: t(`direction.${value}`) }))} onChange={setDocDirection} />
          <SelectField
            label={t("office.settings.docCaseType")}
            hint={t("office.settings.docCaseTypeHint")}
            value={docCaseType}
            options={docCaseTypeOptions}
            onChange={setDocCaseType}
          />
        </div>
        <button type="button" className="button" disabled={action.busy || docLabel === "" || docShortCode === ""} onClick={addDocType}>
          {t("office.settings.addDocType")}
        </button>
        <h3 className="heading">{t("office.settings.rules")}</h3>
        <ul className="list">
          {current.docRules.map((rule) => (
            <li key={rule.id} className="list__item">
              <span className="code">{docTypeById.get(rule.docTypeId)?.shortCode}</span>
              <span className="grow">{docTypeById.get(rule.docTypeId)?.label ?? t("office.settings.ruleUnknownType")}</span>
              <span className="code">{rule.keyword}</span>
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

      {isOwner ? <StaffSection /> : null}

      <section className="card card--pad stack" aria-label={t("office.settings.jev.title")}>
        <h2 className="subtitle">{t("office.settings.jev.title")}</h2>
        <Notice tone="info">
          {t("office.settings.jev.note")} {t("office.settings.jev.terms")}{" "}
          <a href={JEV_PRICING_URL} target="_blank" rel="noopener noreferrer">{t("office.settings.jev.pricing")}</a>{" "}
          <a href={JEV_LIMITS_URL} target="_blank" rel="noopener noreferrer">{t("office.settings.jev.limits")}</a>
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

      <section className="card card--pad stack" aria-label={t("office.settings.notifications.title")}>
        <h2 className="subtitle">{t("office.settings.notifications.title")}</h2>
        <p className="muted">{t("office.settings.notifications.lead")}</p>
        {current.notifications.pushConfigured ? (
          <Notice tone="success">{t("office.settings.notifications.configured")}</Notice>
        ) : (
          <Notice tone="review">{t("office.settings.notifications.notConfigured")}</Notice>
        )}
      </section>
    </div>
  );
}
