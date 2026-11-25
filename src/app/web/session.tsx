import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, ApiError } from "./api/client";
import type { Me, PublicConfig } from "./api/types";

export interface Session {
  api: ApiClient;
  config: PublicConfig;
  /** Null when nobody is signed in. */
  me: Me | null;
  /** True once this tab signed out, until someone signs in again. */
  signedOutHere: boolean;
  /** Re-reads the signed-in user. A failure is thrown to the caller; the app keeps its current state. */
  refresh(): Promise<Me | null>;
  signOut(): Promise<void>;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; config: PublicConfig; me: Me | null; signedOutHere: boolean }
  | { status: "failed"; error: ApiError };

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("SessionContext is missing");
  }
  return session;
}

async function loadMe(api: ApiClient): Promise<Me | null> {
  const { me } = await api.get<{ me: Me | null }>("/api/session");
  api.setCsrfToken(me === null ? null : me.csrfToken);
  return me;
}

export interface SessionProviderProps {
  children: ReactNode;
  loading: ReactNode;
  failed: (error: ApiError) => ReactNode;
}

/** Loads the public configuration and the signed-in user once, and shares them with every screen. */
export function SessionProvider({ children, loading, failed }: SessionProviderProps) {
  const api = useMemo(() => new ApiClient(), []);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Only the first load can fail the whole application; later failures belong to the request that caused them.
  const load = useCallback(async () => {
    try {
      const config = await api.get<PublicConfig>("/api/config");
      setState({ status: "ready", config, me: await loadMe(api), signedOutHere: false });
    } catch (error) {
      setState({ status: "failed", error: error instanceof ApiError ? error : new ApiError(0, "network_error", null) });
    }
  }, [api]);

  const refresh = useCallback(async (): Promise<Me | null> => {
    const me = await loadMe(api);
    setState((current) => (current.status === "ready" ? { ...current, me, signedOutHere: me === null && current.signedOutHere } : current));
    return me;
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    api.setCsrfToken(null);
    const me = await loadMe(api);
    setState((current) => (current.status === "ready" ? { ...current, me, signedOutHere: me === null } : current));
  }, [api]);

  if (state.status === "loading") {
    return <>{loading}</>;
  }
  if (state.status === "failed") {
    return <>{failed(state.error)}</>;
  }
  return <SessionContext.Provider value={{ api, config: state.config, me: state.me, signedOutHere: state.signedOutHere, refresh, signOut }}>{children}</SessionContext.Provider>;
}

/** Where a signed-in user belongs. */
export type Landing =
  | { kind: "office" }
  | { kind: "client"; clientId: string }
  | { kind: "pending" }
  | { kind: "none" };

export function landingOf(me: Me): Landing {
  if (me.user.officeStatus === "Active") {
    return { kind: "office" };
  }
  const active = me.memberships.find((membership) => membership.status === "Active" && membership.clientStatus !== null);
  if (active !== undefined) {
    return { kind: "client", clientId: active.clientId };
  }
  if (me.user.officeStatus === "Pending" || me.memberships.some((membership) => membership.status === "Pending")) {
    return { kind: "pending" };
  }
  return { kind: "none" };
}
