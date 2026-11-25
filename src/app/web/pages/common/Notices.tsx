import { Link } from "react-router-dom";
import { webAnalyticsEnabled } from "../../web-analytics";
import { useT } from "../../i18n";

const JEV_LINKS = [
  { key: "notices.jev.models", href: "https://docs.typesafe.ai/models" },
  { key: "notices.jev.limits", href: "https://docs.typesafe.ai/model-jaggedness/jev-1.13" },
] as const;

const SOFTWARE = ["React", "React Router", "Hono", "jose", "fflate", "Font Awesome Free", "Montserrat"] as const;

/** Open-source notices, the terms that apply to the Jev classifier, and what data the portal keeps. */
export function Notices() {
  const t = useT();
  return (
    <main className="document">
      <h1 className="title">{t("notices.title")}</h1>
      <section className="card card--pad">
        <h2 className="subtitle">{t("notices.license.title")}</h2>
        <p>{t("notices.license.body")}</p>
        <p className="muted">{t("notices.license.thirdParty")}</p>
        <ul>
          {SOFTWARE.map((name) => (
            <li key={name}>
              {name} {t(`notices.software.${name.replaceAll(" ", "")}`)}
            </li>
          ))}
        </ul>
      </section>
      <section className="card card--pad">
        <h2 className="subtitle">{t("notices.jev.title")}</h2>
        <p>{t("notices.jev.use")}</p>
        <p>{t("notices.jev.key")}</p>
        <p>{t("notices.jev.sent")}</p>
        <p>{t("notices.jev.cost")}</p>
        <ul>
          {JEV_LINKS.map((link) => (
            <li key={link.key}>
              <a href={link.href} rel="noreferrer noopener" target="_blank">
                {t(link.key)}
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section className="card card--pad">
        <h2 className="subtitle">{t("notices.privacy.title")}</h2>
        <p>{t("notices.privacy.identity")}</p>
        <p>{t("notices.privacy.cookies")}</p>
        {webAnalyticsEnabled(document) ? <p>{t("notices.privacy.pageViews")}</p> : null}
        <p>{t("notices.privacy.individualNumber")}</p>
      </section>
      <section className="card card--pad">
        <h2 className="subtitle">{t("notices.ai.title")}</h2>
        <p>{t("notices.ai.body")}</p>
      </section>
      <p>
        <Link to="/">{t("common.backToStart")}</Link>
      </p>
    </main>
  );
}
