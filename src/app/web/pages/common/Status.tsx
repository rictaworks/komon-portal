import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useState } from "react";
import { ErrorNotice, errorText, Notice } from "../../components/Notice";
import { useT } from "../../i18n";
import { PublicLayout } from "../../layouts/PublicLayout";
import { landingOf, useSession } from "../../session";

/** Shown after an invitation was used and before the office approved it. Nothing else is visible until then. */
export function Pending() {
  const t = useT();
  const navigate = useNavigate();
  const { me, signOut, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Once the office has approved the visitor, the start page sends them to their area.
  const check = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const current = await refresh();
      if (current === null || landingOf(current).kind !== "pending") {
        navigate("/", { replace: true });
      }
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PublicLayout>
      <h1 className="title">{t("pending.title")}</h1>
      <Notice tone="info">{t("pending.lead", { name: me?.user.displayName ?? "" })}</Notice>
      <p className="muted">{t("pending.note")}</p>
      <ErrorNotice error={error} />
      <button type="button" className="button button--primary button--block" disabled={busy} onClick={() => void check()}>
        {t("pending.check")}
      </button>
      <button type="button" className="button button--block" onClick={() => void signOut()}>
        {t("common.signOut")}
      </button>
    </PublicLayout>
  );
}

/** A signed-in user with no role and no membership. */
export function NoAccess() {
  const t = useT();
  const { config, signOut } = useSession();
  return (
    <PublicLayout>
      <h1 className="title">{t("noAccess.title")}</h1>
      <p className="muted">{t("noAccess.lead")}</p>
      <Link className="button button--primary button--block" to="/redeem">
        {t("signIn.haveInvitation")}
      </Link>
      {config.setupOpen ? (
        <Link className="button button--block" to="/setup">
          {t("setup.title")}
        </Link>
      ) : null}
      <button type="button" className="button button--block" onClick={() => void signOut()}>
        {t("common.signOut")}
      </button>
    </PublicLayout>
  );
}

export function NotFound() {
  const t = useT();
  return (
    <PublicLayout>
      <h1 className="title">{t("notFound.title")}</h1>
      <p className="muted">{t("notFound.lead")}</p>
      <Link className="button button--primary button--block" to="/">
        {t("common.backToStart")}
      </Link>
    </PublicLayout>
  );
}

/** Shown when the application itself cannot start, before any session is known. */
export function StartupError({ error }: { error: ApiError }) {
  const t = useT();
  return (
    <div className="document">
      <h1 className="title">{t("startupError.title")}</h1>
      <Notice tone="danger">{errorText(t, error)}</Notice>
      <a className="button" href="/">
        {t("common.reload")}
      </a>
    </div>
  );
}

export function Loading() {
  const t = useT();
  return (
    <p className="spinner" role="status">
      {t("common.loading")}
    </p>
  );
}
