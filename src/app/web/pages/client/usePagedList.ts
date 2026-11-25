import { useCallback, useEffect, useState } from "react";
import type { ListPage } from "../../api/client-types";
import { useLoad } from "../../components/useLoad";
import { emptiedPage, requestedPage, shownPage, type PageOf, type PageRequest } from "./client-lists";

export interface PagedList<T> {
  /** The rows on the screen with the page they belong to; null while this list has none loaded. */
  shown: PageOf<T> | null;
  error: unknown;
  loading: boolean;
  /** Loads that page. Asking for the page already asked for loads it again, which retries a failed load. */
  goTo(page: number): void;
  reload(): void;
}

/**
 * Loads a client list a page at a time. `list` names the list (company and filter): a new list starts at its first
 * page. The page number on the screen is the one of the rows shown, not the one last asked for, so a failed load
 * cannot mislabel the rows; a later page that has become empty steps back to the page before it.
 */
export function usePagedList<T>(list: string, loadPage: (page: number) => Promise<ListPage<T>>): PagedList<T> {
  const [request, setRequest] = useState<PageRequest>({ list, page: 0 });
  const page = requestedPage(request, list);
  const load = useLoad<PageOf<T>>(async () => ({ ...(await loadPage(page)), list, page }), [list, page]);
  const { data, reload } = load;

  useEffect(() => {
    const back = emptiedPage(data, list, page);
    if (back !== null) {
      setRequest({ list, page: back });
    }
  }, [data, list, page]);

  const goTo = useCallback(
    (next: number): void => {
      if (next === page) {
        reload();
      } else {
        setRequest({ list, page: next });
      }
    },
    [list, page, reload],
  );

  // An error belongs to the load that failed: while the next one is under way it says nothing about it.
  return { shown: shownPage(data, list), error: load.loading ? null : load.error, loading: load.loading, goTo, reload };
}
