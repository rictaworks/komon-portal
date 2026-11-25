import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ClientMembers, ClientRecord, InvitationView } from "../../api/office-types";
import { Field, SelectField, TextField } from "../../components/Form";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";

const CLIENT_STATUSES = ["Active", "Archived", "Closed"] as const;

function inviteLink(code: string): string {
  return `${window.location.origin}/redeem#${code}`;
}

/** Client list with a register form. */
export function Clients() {
  const t = useT();
  const { api } = useSession();
  const list = useLoad<{ items: ClientRecord[] }>(() => api.get<{ items: ClientRecord[] }>("/api/office/clients"), []);
  const action = useAction();
  const [query, setQuery] = useState("");
  const [code, setCode] = useState("");
  const [corporateName, setCorporateName] = useState("");
  const [corporateNumber, setCorporateNumber] = useState("");
  const needle = query.trim().toLowerCase();
  const visible = (list.data?.items ?? []).filter((client) => needle === "" || `${client.code} ${client.corporateName}`.toLowerCase().includes(needle));

  const register = (event: FormEvent) => {
    event.preventDefault();
    void action.run(async () => {
      await api.post("/api/office/clients", { code, corporateName, corporateNumber: corporateNumber === "" ? undefined : corporateNumber });
      setCode("");
      setCorporateName("");
      setCorporateNumber("");
      list.reload();
    });
  };

  return (
    <div className="page">
      <h1 className="title">{t("office.clients.title")}</h1>
      <ErrorNotice error={list.error ?? action.error} />
      <div className="split">
        <section className="card split__main" aria-label={t("office.clients.list")}>
          <div className="card__head">
            <TextField label={t("office.clients.search")} type="search" value={query} onChange={setQuery} />
          </div>
          {list.loading && list.data === null ? <Loading /> : null}
          {list.data !== null && visible.length === 0 ? <p className="empty">{t("office.clients.empty")}</p> : null}
          <ul className="list">
            {visible.map((client) => (
              <li key={client.id}>
                <Link className="list__item" to={`/office/clients/${client.id}`}>
                  <span className="code">{client.code}</span>
                  <span className="grow">{client.corporateName}</span>
                  <Badge tone={client.status === "Active" ? "published" : "neutral"} label={t(`clientStatus.${client.status}`)} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <form className="card card--pad split__side stack" onSubmit={register} aria-label={t("office.clients.register")}>
          <h2 className="subtitle">{t("office.clients.register")}</h2>
          <Notice tone="info">{t("office.clients.individualNote")}</Notice>
          <TextField label={t("office.clients.code")} value={code} onChange={setCode} mono hint={t("office.clients.codeHint")} />
          <TextField label={t("office.clients.corporateName")} value={corporateName} onChange={setCorporateName} />
          <TextField label={t("office.clients.corporateNumber")} value={corporateNumber} onChange={setCorporateNumber} mono hint={t("office.clients.corporateNumberHint")} />
          <button type="submit" className="button button--primary" disabled={action.busy || code === "" || corporateName === ""}>
            {t("office.clients.registerAction")}
          </button>
        </form>
      </div>
    </div>
  );
}

/** One client: details, status, membership approvals and invitations. */
export function ClientDetail() {
  const t = useT();
  const { clientId = "" } = useParams();
  const { api } = useSession();
  const client = useLoad<ClientRecord>(() => api.get<ClientRecord>(`/api/office/clients/${clientId}`), [clientId]);
  const members = useLoad<ClientMembers>(() => api.get<ClientMembers>(`/api/office/clients/${clientId}/members`), [clientId]);
  const action = useAction();
  const [corporateName, setCorporateName] = useState<string | null>(null);
  const [corporateNumber, setCorporateNumber] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [issued, setIssued] = useState<InvitationView | null>(null);

  if (client.data === null) {
    return <div className="page">{client.error === null ? <Loading /> : <ErrorNotice error={client.error} />}</div>;
  }
  const current = client.data;
  const reload = () => {
    client.reload();
    members.reload();
  };

  const save = () => {
    void action
      .run(() =>
        api.patch(`/api/office/clients/${clientId}`, {
          corporateName: corporateName ?? current.corporateName,
          corporateNumber: (corporateNumber ?? current.corporateNumber ?? "") === "" ? undefined : (corporateNumber ?? current.corporateNumber ?? undefined),
          status: status ?? current.status,
          version: current.version,
        }),
      )
      .then((ok) => {
        if (ok) {
          setCorporateName(null);
          setCorporateNumber(null);
          setStatus(null);
          reload();
        }
      });
  };

  const invite = () => {
    void action.run(async () => setIssued(await api.post<InvitationView>(`/api/office/clients/${clientId}/invitations`, {}))).then(() => members.reload());
  };

  const membership = (id: string, verb: "approve" | "reject" | "revoke") => () => {
    void action.run(() => api.post(`/api/office/memberships/${id}/${verb}`, {})).then((ok) => ok && members.reload());
  };

  const cancelInvitation = (id: string) => () => {
    void action.run(() => api.post(`/api/office/invitations/${id}/cancel`, {})).then((ok) => ok && members.reload());
  };

  return (
    <div className="page">
      <div className="row row--end">
        <h1 className="title grow">
          <span className="code">{current.code}</span> {current.corporateName}
        </h1>
        <Link className="button" to={`/office/shelf/${clientId}`}>
          {t("office.actions.openShelf")}
        </Link>
      </div>
      <ErrorNotice error={action.error} />
      <section className="card card--pad stack" aria-label={t("office.clients.details")}>
        <TextField label={t("office.clients.corporateName")} value={corporateName ?? current.corporateName} onChange={setCorporateName} />
        <TextField label={t("office.clients.corporateNumber")} value={corporateNumber ?? current.corporateNumber ?? ""} onChange={setCorporateNumber} mono />
        <SelectField label={t("office.clients.status")} value={status ?? current.status} options={CLIENT_STATUSES.map((value) => ({ value, label: t(`clientStatus.${value}`) }))} onChange={setStatus} />
        <div className="row">
          <button type="button" className="button button--primary" disabled={action.busy} onClick={save}>
            {t("office.clients.save")}
          </button>
        </div>
      </section>

      <section className="card" aria-label={t("office.clients.members")}>
        <div className="card__head">
          <h2 className="subtitle grow">{t("office.clients.members")}</h2>
          <button type="button" className="button" disabled={action.busy || current.status !== "Active"} onClick={invite}>
            {t("office.clients.invite")}
          </button>
        </div>
        {issued === null ? null : (
          <div className="card--pad stack">
            <Notice tone="success">{t("office.clients.inviteIssued")}</Notice>
            <Field label={t("office.clients.inviteLink")} hint={t("office.clients.inviteHint")}>
              {(id) => <input id={id} className="input input--mono" readOnly value={issued.code === undefined ? "" : inviteLink(issued.code)} />}
            </Field>
          </div>
        )}
        {members.data === null ? <Loading /> : null}
        <ul className="list">
          {(members.data?.members ?? []).map((member) => (
            <li key={member.membershipId} className="list__item">
              <span className="grow">{member.displayName}</span>
              <Badge tone={member.status === "Active" ? "published" : "neutral"} label={t(`membership.${member.status}`)} />
              {member.status === "Pending" ? (
                <>
                  <button type="button" className="button" disabled={action.busy} onClick={membership(member.membershipId, "approve")}>
                    {t("office.clients.approve")}
                  </button>
                  <button type="button" className="button button--danger" disabled={action.busy} onClick={membership(member.membershipId, "reject")}>
                    {t("office.clients.reject")}
                  </button>
                </>
              ) : null}
              {member.status === "Active" ? (
                <button type="button" className="button button--danger" disabled={action.busy} onClick={membership(member.membershipId, "revoke")}>
                  {t("office.clients.revoke")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {(members.data?.invitations ?? []).length === 0 ? null : (
          <ul className="list">
            {(members.data?.invitations ?? []).map((invitation) => (
              <li key={invitation.id} className="list__item">
                <span className="grow muted">{t("office.clients.pendingInvitation", { expires: invitation.expiresAt.slice(0, 10) })}</span>
                <button type="button" className="button" disabled={action.busy} onClick={cancelInvitation(invitation.id)}>
                  {t("office.clients.cancelInvitation")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
