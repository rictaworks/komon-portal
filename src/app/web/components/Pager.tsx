import { faChevronLeft, faChevronRight } from "@fortawesome/free-solid-svg-icons";
import { useT } from "../i18n";
import { Icon } from "./Icon";

export interface PagerProps {
  /** Zero-based page shown now. */
  page: number;
  /** Whether rows exist beyond this page. */
  hasMore: boolean;
  busy: boolean;
  onPage(page: number): void;
}

/** Steps through a list one page at a time. Renders nothing while the whole list fits on the first page. */
export function Pager({ page, hasMore, busy, onPage }: PagerProps) {
  const t = useT();
  if (page === 0 && !hasMore) {
    return null;
  }
  return (
    <nav className="pager" aria-label={t("client.paging.label")}>
      <button type="button" className="button" disabled={busy || page === 0} onClick={() => onPage(page - 1)}>
        <Icon icon={faChevronLeft} />
        {t("client.paging.previous")}
      </button>
      <span className="pager__page" aria-current="page">
        {t("client.paging.page", { page: page + 1 })}
      </span>
      <button type="button" className="button" disabled={busy || !hasMore} onClick={() => onPage(page + 1)}>
        {t("client.paging.next")}
        <Icon icon={faChevronRight} />
      </button>
    </nav>
  );
}
