import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { NoAccess, NotFound, Pending } from "./pages/common/Status";
import { Notices } from "./pages/common/Notices";
import { Redeem } from "./pages/common/Redeem";
import { Setup } from "./pages/common/Setup";
import { SignIn } from "./pages/common/SignIn";
import { landingOf, useSession } from "./session";

/** Sends a visitor to the place that fits their role. */
function Start() {
  const { me } = useSession();
  if (me === null) {
    return <Navigate to="/sign-in" replace />;
  }
  const landing = landingOf(me);
  if (landing.kind === "office") {
    return <Navigate to="/office/dashboard" replace />;
  }
  if (landing.kind === "client") {
    return <Navigate to={`/client/${landing.clientId}/home`} replace />;
  }
  return <Navigate to={landing.kind === "pending" ? "/pending" : "/no-access"} replace />;
}

/** Requires a session; a visitor without one is sent to sign in and comes back afterwards. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const location = useLocation();
  if (me === null) {
    return <Navigate to={`/sign-in?return=${encodeURIComponent(location.pathname)}`} replace />;
  }
  return <>{children}</>;
}

export interface AppProps {
  /** Routes of the office and client areas, added by their own modules. */
  areas?: ReactNode;
}

export function App({ areas }: AppProps) {
  return (
    <Routes>
      <Route path="/" element={<Start />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/redeem" element={<Redeem />} />
      <Route path="/setup" element={<Setup />} />
      <Route path="/notices" element={<Notices />} />
      <Route path="/pending" element={<RequireSession><Pending /></RequireSession>} />
      <Route path="/no-access" element={<RequireSession><NoAccess /></RequireSession>} />
      {areas}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
