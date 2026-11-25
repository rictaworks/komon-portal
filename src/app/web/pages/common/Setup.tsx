import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Turnstile } from "../../components/Turnstile";
import { useT } from "../../i18n";
import { PublicLayout } from "../../layouts/PublicLayout";
import { useSession } from "../../session";

/** First-time setup: the first signed-in user who presents the setup token becomes the Owner. */
export function Setup() {
  const t = useT();
  const navigate = useNavigate();
  const { api, config, me, refresh } = useSession();
  const [setupToken, setSetupToken] = useState("");
  const [token, setToken] = useState<string | null>(null);
  // Turnstile tokens are single use: after every attempt the widget is rendered again for a fresh token.
  const [widgetKey, setWidgetKey] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post("/api/setup/claim", { token: setupToken, turnstileToken: token ?? "" });
      await refresh();
      void navigate("/");
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
      setToken(null);
      setWidgetKey((key) => key + 1);
    }
  };

  return (
    <PublicLayout>
      <h1 className="title">{t("setup.title")}</h1>
      <p className="muted">{t("setup.lead")}</p>
      <ErrorNotice error={error} />
      {!config.setupOpen ? <Notice tone="info">{t("setup.closed")}</Notice> : null}
      {config.setupOpen && me === null ? (
        <a className="button button--primary button--block" href={`/api/auth/login?return=${encodeURIComponent("/setup")}`}>
          {t("signIn.google")}
        </a>
      ) : null}
      {config.setupOpen && me !== null ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="setup-token">
              {t("setup.token")}
            </label>
            <input id="setup-token" className="input mono" type="password" value={setupToken} autoComplete="off" onChange={(event) => setSetupToken(event.target.value)} />
          </div>
          {config.turnstileSiteKey === null ? <Notice tone="review">{t("redeem.turnstileMissing")}</Notice> : <Turnstile key={widgetKey} siteKey={config.turnstileSiteKey} onToken={onToken} />}
          <button type="button" className="button button--primary button--block" disabled={busy || setupToken === "" || token === null} onClick={() => void submit()}>
            {t("setup.submit")}
          </button>
        </>
      ) : null}
    </PublicLayout>
  );
}
