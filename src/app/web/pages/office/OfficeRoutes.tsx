import type { ReactNode } from "react";
import { Route } from "react-router-dom";
import { OfficeLayout } from "../../layouts/OfficeLayout";
import { useSession } from "../../session";
import { NoAccess } from "../common/Status";
import { Audit } from "./Audit";
import { Cases } from "./Cases";
import { ClientDetail, Clients } from "./Clients";
import { Dashboard } from "./Dashboard";
import { Intake } from "./Intake";
import { Review } from "./Review";
import { Settings } from "./Settings";
import { Shelf } from "./Shelf";
import { Staged } from "./Staged";

/** Only active office staff reach the office area; everyone else sees the no-access page. */
function RequireOffice({ children }: { children: ReactNode }) {
  const { me } = useSession();
  if (me === null || me.user.officeStatus !== "Active") {
    return <NoAccess />;
  }
  return <>{children}</>;
}

/** Owner-only screens. Staff see the no-access page instead. */
function RequireOwner({ children }: { children: ReactNode }) {
  const { me } = useSession();
  if (me?.user.officeRole !== "Owner") {
    return <NoAccess />;
  }
  return <>{children}</>;
}

/** Routes of the office area, passed to App as `areas`. */
export function officeAreas(): ReactNode {
  return (
    <Route
      element={
        <RequireOffice>
          <OfficeLayout />
        </RequireOffice>
      }
    >
      <Route path="/office/dashboard" element={<Dashboard />} />
      <Route path="/office/intake" element={<Intake />} />
      <Route path="/office/review" element={<Review />} />
      <Route path="/office/staged" element={<Staged />} />
      <Route path="/office/clients" element={<Clients />} />
      <Route path="/office/clients/:clientId" element={<ClientDetail />} />
      <Route path="/office/shelf/:clientId" element={<Shelf />} />
      <Route path="/office/cases" element={<Cases />} />
      <Route path="/office/settings" element={<Settings />} />
      <Route
        path="/office/audit"
        element={
          <RequireOwner>
            <Audit />
          </RequireOwner>
        }
      />
    </Route>
  );
}
