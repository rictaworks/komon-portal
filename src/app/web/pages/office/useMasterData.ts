import type { SettingsView } from "../../api/office-types";
import { useLoad, type Loaded } from "../../components/useLoad";
import { useSession } from "../../session";

export function useSettings(): Loaded<SettingsView> {
  const { api } = useSession();
  return useLoad<SettingsView>(() => api.get<SettingsView>("/api/office/settings"), []);
}
