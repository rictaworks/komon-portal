import { faRightToBracket } from "@fortawesome/free-solid-svg-icons";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../../components/Icon";
import { ErrorNotice, Notice } from "../../components/Notice";
import { useT } from "../../i18n";
import { PublicLayout } from "../../layouts/PublicLayout";
import { useSession } from "../../session";

const DEV_ROLES = ["owner", "staff", "member"] as const;

export function SignIn() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { api, config, refresh } = useSession();
  const [error, setError] = useState<unknown>(null);
  const returnTo = params.get("return") ?? "/";

  const developmentSignIn = async (role: (typeof DEV_ROLES)[number]): Promise<void> => {
    try {
      await api.post("/api/dev/login", { role });
      await refresh();
      void navigate(returnTo);
    } catch (reason) {
      setError(reason);
    }
  };

  return (
    <PublicLayout>
      <h1 className="title">{t("signIn.title")}</h1>
      <p className="muted">{t("signIn.privacy")}</p>
      <ErrorNotice error={error} />
      {config.signInAvailable ? (
        <a className="button button--block" href={`/api/auth/login?return=${encodeURIComponent(returnTo)}`}>
          <Icon icon={faRightToBracket} />
          {t("signIn.google")}
        </a>
      ) : (
        <Notice tone="review">{t("signIn.notConfigured")}</Notice>
      )}
      <Link className="button button--primary button--block" to="/redeem">
        {t("signIn.haveInvitation")}
      </Link>
      <p className="muted">{t("signIn.approvalNote")}</p>
      {config.environment === "development" ? (
        <div className="stack">
          <Notice tone="info">{t("signIn.developmentNote")}</Notice>
          <div className="row">
            {DEV_ROLES.map((role) => (
              <button key={role} type="button" className="button button--small" onClick={() => void developmentSignIn(role)}>
                {t(`signIn.development.${role}`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </PublicLayout>
  );
}
