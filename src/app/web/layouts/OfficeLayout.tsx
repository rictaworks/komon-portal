import {
  faBoxArchive, faBriefcase, faBuilding, faClipboardList, faClock, faFolderOpen, faGauge, faSliders, faTriangleExclamation, faUpload,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { NavLink, Outlet } from "react-router-dom";
import { Icon } from "../components/Icon";
import { useLoad } from "../components/useLoad";
import { useT } from "../i18n";
import { useSession } from "../session";

interface MenuItem {
  to: string;
  labelKey: string;
  icon: IconDefinition;
  count?: "needsReview" | "staged";
  ownerOnly?: boolean;
}

const MENU: readonly MenuItem[] = [
  { to: "/office/dashboard", labelKey: "office.menu.dashboard", icon: faGauge },
  { to: "/office/intake", labelKey: "office.menu.intake", icon: faUpload },
  { to: "/office/review", labelKey: "office.menu.review", icon: faTriangleExclamation, count: "needsReview" },
  { to: "/office/staged", labelKey: "office.menu.staged", icon: faClock, count: "staged" },
  { to: "/office/clients", labelKey: "office.menu.clients", icon: faBuilding },
  { to: "/office/shelf", labelKey: "office.menu.shelf", icon: faBoxArchive },
  { to: "/office/cases", labelKey: "office.menu.cases", icon: faBriefcase },
  { to: "/office/settings", labelKey: "office.menu.settings", icon: faSliders },
  { to: "/office/audit", labelKey: "office.menu.audit", icon: faClipboardList, ownerOnly: true },
];

interface Counts {
  needsReview: number;
  staged: number;
}

/** Office layout: a fixed menu on the left and the working area on the right. The menu stacks on top at phone width. */
export function OfficeLayout() {
  const t = useT();
  const { api, me, signOut } = useSession();
  const counts = useLoad<Counts>(() => api.get<Counts>("/api/office/dashboard"), []);
  const isOwner = me?.user.officeRole === "Owner";

  return (
    <div className="office">
      <nav className="sidebar" aria-label={t("office.menu.label")}>
        <NavLink to="/office/dashboard" className="sidebar__brand">
          <Icon icon={faFolderOpen} />
          <span>{t("app.brand")}</span>
        </NavLink>
        <div className="sidebar__nav">
          {MENU.filter((item) => item.ownerOnly !== true || isOwner).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `sidebar__link${isActive ? " sidebar__link--active" : ""}`}>
              <Icon icon={item.icon} />
              <span className="sidebar__label">{t(item.labelKey)}</span>
              {item.count !== undefined && counts.data !== null && counts.data[item.count] > 0 ? (
                <span className={`sidebar__count sidebar__count--${item.count === "needsReview" ? "review" : "staged"}`}>{counts.data[item.count]}</span>
              ) : null}
            </NavLink>
          ))}
        </div>
        <div className="sidebar__foot">
          <span>{me?.user.displayName}</span>
          <span className="sidebar__muted">{t(isOwner ? "office.role.owner" : "office.role.staff")}</span>
          <button type="button" className="sidebar__signout" onClick={() => void signOut()}>
            {t("common.signOut")}
          </button>
        </div>
      </nav>
      <div className="content">
        <Outlet />
      </div>
    </div>
  );
}
