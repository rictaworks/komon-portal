import { faBell, faFolderOpen, faHouse, faUpload, type IconDefinition } from "@fortawesome/free-solid-svg-icons";
import { NavLink, Outlet, useNavigate, useParams } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useT } from "../i18n";
import { useSession } from "../session";

const TABS: readonly { path: string; labelKey: string; icon: IconDefinition }[] = [
  { path: "home", labelKey: "client.menu.home", icon: faHouse },
  { path: "documents", labelKey: "client.menu.documents", icon: faFolderOpen },
  { path: "send", labelKey: "client.menu.send", icon: faUpload },
  { path: "notifications", labelKey: "client.menu.notifications", icon: faBell },
];

/** Client layout: one column, the company switch on top and the four destinations at the bottom. */
export function ClientLayout() {
  const t = useT();
  const navigate = useNavigate();
  const { clientId = "" } = useParams();
  const { me, signOut } = useSession();
  const reachable = (me?.memberships ?? []).filter((membership) => membership.status === "Active" && membership.corporateName !== null);

  return (
    <div className="client">
      <header className="client__header">
        <div className="row">
          <span className="client__brand grow">{t("app.brand")}</span>
          <button type="button" className="sidebar__signout" onClick={() => void signOut()}>
            {t("common.signOut")}
          </button>
        </div>
        <label className="client__label" htmlFor="client-switch">
          {t("client.company")}
        </label>
        <select id="client-switch" className="client__switch" value={clientId} onChange={(event) => void navigate(`/client/${event.target.value}/home`)}>
          {reachable.map((membership) => (
            <option key={membership.clientId} value={membership.clientId}>
              {membership.corporateName}
            </option>
          ))}
        </select>
      </header>
      <main className="client__main">
        <Outlet />
      </main>
      <nav className="tabbar" aria-label={t("client.menu.label")}>
        {TABS.map((tab) => (
          <NavLink key={tab.path} to={`/client/${clientId}/${tab.path}`} className={({ isActive }) => `tabbar__link${isActive ? " tabbar__link--active" : ""}`}>
            <Icon icon={tab.icon} />
            {t(tab.labelKey)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
