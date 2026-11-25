import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNotice, Notice } from "../../components/Notice";
import { Turnstile } from "../../components/Turnstile";
import { useT } from "../../i18n";
import { PublicLayout } from "../../layouts/PublicLayout";
import { useSession } from "../../session";

const STORAGE_KEY = "komon.invitation";

/** Reads the one-time code from the URL fragment and keeps it for this tab only while the visitor signs in. */
function takeCode(): string {
  const fromUrl = window.location.hash.replace(/^#/, "");
  if (fromUrl !== "") {
    window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
    window.history.replaceState(null, "", window.location.pathname);
    return fromUrl;
  }
  return window.sessionStorage.getItem(STORAGE_KEY) ?? "";
}

export function Redeem() {
  const t = useT();
  const navigate = useNavigate();
  const { api, config, me, refresh } = useSession();
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((value: string | null) => setToken(value), []);

  useEffect(() => {
    setCode(takeCode());
  }, []);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post("/api/invitations/redeem", { code, turnstileToken: token ?? "" });
      window.sessionStorage.removeItem(STORAGE_KEY);
      await refresh();
      void navigate("/pending");
    } catch (reason) {
      setError(reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PublicLayout>
      <h1 className="title">{t("redeem.title")}</h1>
      <p className="muted">{t("redeem.lead")}</p>
      <ErrorNotice error={error} />
      {me === null ? (
        <>
          <Notice tone="info">{t("redeem.signInFirst")}</Notice>
          <a className="button button--primary button--block" href={`/api/auth/login?return=${encodeURIComponent("/redeem")}`}>
            {t("signIn.google")}
          </a>
        </>
      ) : (
        <>
          <div className="field">
            <label className="field__label" htmlFor="invitation-code">
              {t("redeem.code")}
            </label>
            <input id="invitation-code" className="input mono" value={code} autoComplete="off" onChange={(event) => setCode(event.target.value.trim())} />
          </div>
          {config.turnstileSiteKey === null ? <Notice tone="review">{t("redeem.turnstileMissing")}</Notice> : <Turnstile siteKey={config.turnstileSiteKey} onToken={onToken} />}
          <button type="button" className="button button--primary button--block" disabled={busy || code === "" || token === null} onClick={() => void submit()}>
            {t("redeem.submit")}
          </button>
        </>
      )}
    </PublicLayout>
  );
}
