import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiClient, ApiError } from "./api/client";
import type { Me, PublicConfig } from "./api/types";

export interface Session {
  api: ApiClient;
  config: PublicConfig;
  /** Null when nobody is signed in. */
  me: Me | null;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

type LoadState = { status: "loading" } | { status: "ready"; config: PublicConfig; me: Me | null } | { status: "failed"; error: ApiError };

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) {
    throw new Error("SessionContext is missing");
  }
  return session;
}

async function loadMe(api: ApiClient): Promise<Me | null> {
  try {
    const me = await api.get<Me>("/api/me");
    api.setCsrfToken(me.csrfToken);
    return me;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      api.setCsrfToken(null);
      return null;
    }
    throw error;
  }
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

  const load = useCallback(async () => {
    try {
      const config = await api.get<PublicConfig>("/api/config");
      setState({ status: "ready", config, me: await loadMe(api) });
    } catch (error) {
      setState({ status: "failed", error: error instanceof ApiError ? error : new ApiError(0, "network_error", null) });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = useCallback(async () => {
    await api.post("/api/auth/logout");
    api.setCsrfToken(null);
    await load();
  }, [api, load]);

  if (state.status === "loading") {
    return <>{loading}</>;
  }
  if (state.status === "failed") {
    return <>{failed(state.error)}</>;
  }
  return <SessionContext.Provider value={{ api, config: state.config, me: state.me, refresh: load, signOut }}>{children}</SessionContext.Provider>;
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
