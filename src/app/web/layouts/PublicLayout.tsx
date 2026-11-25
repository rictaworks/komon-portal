import { faFolderOpen } from "@fortawesome/free-solid-svg-icons";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useT } from "../i18n";

/** Sign-in and the other pages that need no session: brand panel on one side, a card on the other. */
export function PublicLayout({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="public">
      <div className="public__hero">
        <div className="public__brand">
          <Icon icon={faFolderOpen} />
          <span>{t("app.brand")}</span>
        </div>
        <p className="public__headline">{t("app.tagline")}</p>
        <span className="public__rule" />
        <p className="public__lead">{t("app.lead")}</p>
      </div>
      <main className="public__main">
        <div className="public__card">
          {children}
          <div className="public__links">
            <Link to="/notices">{t("common.notices")}</Link>
            <a href={`mailto:${t("app.contact")}`}>{t("app.contact")}</a>
          </div>
        </div>
      </main>
    </div>
  );
}
