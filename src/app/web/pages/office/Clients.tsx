import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { ClientListItem, ClientMembers, ClientRecord, InvitationView } from "../../api/office-types";
import { Field, SelectField, TextField } from "../../components/Form";
import { formatDateTime } from "../../components/format";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Badge } from "../../components/StatusBadge";
import { useAction } from "../../components/useAction";
import { useLoad } from "../../components/useLoad";
import { useT } from "../../i18n";
import { useSession } from "../../session";
import { Loading } from "../common/Status";
import { clientListPath, rowsFor, type ClientListPage } from "./client-list";

const CLIENT_STATUSES = ["Active", "Archived", "Closed"] as const;

const ALL_STATUSES = "All";
/** Clients shown per page. The API counts members for at most 50 clients in one request. */
const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

function inviteLink(code: string): string {
  return `${window.location.origin}/redeem#${code}`;
}

function memberCountKey(members: ClientListItem["members"]): string {
  if (members.active > 0 && members.pending > 0) {
    return "office.clients.memberCounts.both";
  }
  if (members.pending > 0) {
    return "office.clients.memberCounts.pending";
  }
  return members.active > 0 ? "office.clients.memberCounts.active" : "office.clients.memberCounts.none";
}

/** Client list with a register form. */
export function Clients() {
  const t = useT();
  const { api } = useSession();
  const action = useAction();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("Active");
  const [offset, setOffset] = useState(0);
  const path = clientListPath({ status: status === ALL_STATUSES ? null : status, search, offset, pageSize: PAGE_SIZE });
  // The rows are kept with the request they answer, so rows of an earlier filter are never shown under a new one.
  const list = useLoad<ClientListPage<ClientListItem>>(async () => ({ path, items: (await api.get<{ items: ClientListItem[] }>(path)).items }), [path]);
  const [code, setCode] = useState("");
  const [corporateName, setCorporateName] = useState("");
  const [corporateNumber, setCorporateNumber] = useState("");
  // Null while the list for the chosen filters and page is loading, or when loading it failed.
  const current = rowsFor(list.data, path, PAGE_SIZE);
  const visible = current === null ? [] : current.rows;
  const hasNext = current !== null && current.hasNext;

  // The server does the search; typing waits a moment so that each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query.trim());
      setOffset(0);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [query]);

  const chooseStatus = (value: string) => {
    setStatus(value);
    setOffset(0);
  };

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
            <SelectField
              label={t("office.clients.statusFilter")}
              value={status}
              options={[...CLIENT_STATUSES.map((value) => ({ value, label: t(`clientStatus.${value}`) })), { value: ALL_STATUSES, label: t("office.clients.allStatuses") }]}
              onChange={chooseStatus}
            />
          </div>
          {current === null && list.loading ? <Loading /> : null}
          {current !== null && visible.length === 0 ? <p className="empty">{t("office.clients.empty")}</p> : null}
          {visible.length === 0 ? null : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{t("office.clients.columns.code")}</th>
                    <th>{t("office.clients.columns.corporateName")}</th>
                    <th>{t("office.clients.columns.corporateNumber")}</th>
                    <th>{t("office.clients.columns.status")}</th>
                    <th>{t("office.clients.columns.members")}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <Link className="code" to={`/office/clients/${client.id}`}>
                          {client.code}
                        </Link>
                      </td>
                      <td>{client.corporateName}</td>
                      <td className="muted">{client.corporateNumber ?? t("office.clients.notRegistered")}</td>
                      <td>
                        <Badge tone={client.status === "Active" ? "published" : "neutral"} label={t(`clientStatus.${client.status}`)} />
                      </td>
                      <td>{t(memberCountKey(client.members), client.members)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {offset === 0 && !hasNext ? null : (
            <div className="card__head">
              <span className="grow muted">{visible.length === 0 ? "" : t("office.clients.pageRange", { first: offset + 1, last: offset + visible.length })}</span>
              <button type="button" className="button" disabled={list.loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                {t("office.clients.previousPage")}
              </button>
              <button type="button" className="button" disabled={list.loading || !hasNext} onClick={() => setOffset(offset + PAGE_SIZE)}>
                {t("office.clients.nextPage")}
              </button>
            </div>
          )}
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
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);

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
        }
        // Reloaded after every attempt, so a version conflict is followed by the current version.
        reload();
      });
  };

  const invite = () => {
    setCopied(null);
    void action.run(async () => setIssued(await api.post<InvitationView>(`/api/office/clients/${clientId}/invitations`, {}))).then(() => members.reload());
  };

  const copyLink = (link: string) => () => {
    // The clipboard is unavailable outside a secure context or when the browser refuses; both are reported.
    void (async () => {
      try {
        await navigator.clipboard.writeText(link);
        setCopied("copied");
      } catch {
        setCopied("failed");
      }
    })();
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
            {issued.code === undefined ? null : (
              <div className="row">
                <button type="button" className="button" onClick={copyLink(inviteLink(issued.code))}>
                  {t("office.clients.copyLink")}
                </button>
              </div>
            )}
            {copied === "copied" ? <Notice tone="success">{t("office.clients.linkCopied")}</Notice> : null}
            {copied === "failed" ? <Notice tone="danger">{t("office.clients.linkCopyFailed")}</Notice> : null}
          </div>
        )}
        {members.data === null ? <Loading /> : null}
        <ul className="list">
          {(members.data?.members ?? []).map((member) => (
            <li key={member.membershipId} className="list__item">
              <span className="grow stack stack--tight">
                <strong>{member.displayName}</strong>
                {member.status === "Pending" ? (
                  <span className="muted">
                    {member.redeemedAt === null ? t("office.clients.useTimeUnknown") : t("office.clients.usedInvitation", { when: formatDateTime(member.redeemedAt) })} {t("office.clients.approveHint")}
                  </span>
                ) : null}
                {member.status === "Active" && member.approvedAt !== null ? <span className="muted">{t("office.clients.activeSince", { when: formatDateTime(member.approvedAt) })}</span> : null}
              </span>
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
