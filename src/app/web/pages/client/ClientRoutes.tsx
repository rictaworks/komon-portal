import type { ReactNode } from "react";
import { Route, useParams } from "react-router-dom";
import { ClientLayout } from "../../layouts/ClientLayout";
import { useSession } from "../../session";
import { NotFound } from "../common/Status";
import { ClientDocuments } from "./ClientDocuments";
import { ClientHome } from "./ClientHome";
import { ClientNotifications } from "./ClientNotifications";
import { ClientSend } from "./ClientSend";

/** Only an active member of the company in the path reaches its pages. Any other company answers "not found". */
function RequireMember({ children }: { children: ReactNode }) {
  const { clientId = "" } = useParams();
  const { me } = useSession();
  const member = (me?.memberships ?? []).some((membership) => membership.clientId === clientId && membership.status === "Active" && membership.clientStatus !== null);
  return member ? <>{children}</> : <NotFound />;
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
