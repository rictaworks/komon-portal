import { createContext, useContext } from "react";

/** Re-reads the office settings the sidebar shows, so a newly saved office name appears without a page reload. */
export const OfficeNameReloadContext = createContext<(() => void) | null>(null);

export function useOfficeNameReload(): () => void {
  const reload = useContext(OfficeNameReloadContext);
  if (reload === null) {
    throw new Error("OfficeNameReloadContext is missing");
  }
  return reload;
}
