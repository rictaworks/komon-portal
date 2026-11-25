import type { ClientRecord, SettingsView } from "../../api/office-types";
import type { SelectOption } from "../../components/Form";
import { useLoad, type Loaded } from "../../components/useLoad";
import { useSession } from "../../session";

const CLIENT_LIMIT = 200;

/** Active clients for destination pickers. */
export function useClients(status = "Active"): Loaded<ClientRecord[]> {
  const { api } = useSession();
  return useLoad<ClientRecord[]>(async () => (await api.get<{ items: ClientRecord[] }>(`/api/office/clients?status=${status}&limit=${CLIENT_LIMIT}`)).items, [status]);
}

export function useSettings(): Loaded<SettingsView> {
  const { api } = useSession();
  return useLoad<SettingsView>(() => api.get<SettingsView>("/api/office/settings"), []);
}

export function clientOptions(clients: readonly ClientRecord[] | null): SelectOption[] {
  return (clients ?? []).map((client) => ({ value: client.id, label: `${client.code} ${client.corporateName}` }));
}
