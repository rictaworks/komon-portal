import type { ReactNode } from "react";
import { Route, useParams } from "react-router-dom";
import { SignInFirst } from "../../App";
import { areaGuard } from "../../area-guard";
import { ClientLayout } from "../../layouts/ClientLayout";
import { useSession } from "../../session";
import { NotFound } from "../common/Status";
import { ClientDocuments } from "./ClientDocuments";
import { ClientHome } from "./ClientHome";
import { ClientNotifications } from "./ClientNotifications";
import { ClientSend } from "./ClientSend";

/**
 * Only an active member of the company in the path reaches its pages. Nobody signed in goes to
 * sign in; for a signed-in user any other company answers "not found".
 */
function RequireMember({ children }: { children: ReactNode }) {
  const { clientId = "" } = useParams();
  const { me } = useSession();
  const member = (me?.memberships ?? []).some((membership) => membership.clientId === clientId && membership.status === "Active" && membership.clientStatus !== null);
  const guard = areaGuard(me !== null, member);
  if (guard === "sign-in") {
    return <SignInFirst />;
  }
  return guard === "allow" ? <>{children}</> : <NotFound />;
}

/** Routes of the client area, passed to App as `areas`. */
export function clientAreas(): ReactNode {
  return (
    <Route path="/client/:clientId" element={<RequireMember><ClientLayout /></RequireMember>}>
      <Route path="home" element={<ClientHome />} />
      <Route path="documents" element={<ClientDocuments />} />
      <Route path="send" element={<ClientSend />} />
      <Route path="notifications" element={<ClientNotifications />} />
    </Route>
  );
}
