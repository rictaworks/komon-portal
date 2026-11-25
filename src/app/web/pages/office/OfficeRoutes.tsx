import type { ReactNode } from "react";
import { Route } from "react-router-dom";
import { SignInFirst } from "../../App";
import { areaGuard } from "../../area-guard";
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
import { Shelf, ShelfChooser } from "./Shelf";
import { Staged } from "./Staged";

/** Only active office staff reach the office area. Nobody signed in goes to sign in; anyone else sees the no-access page. */
function RequireOffice({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const guard = areaGuard(me !== null, me?.user.officeStatus === "Active");
  if (guard === "sign-in") {
    return <SignInFirst />;
  }
  return guard === "allow" ? <>{children}</> : <NoAccess />;
}

/** Owner-only screens. Nobody signed in goes to sign in; staff see the no-access page instead. */
function RequireOwner({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const guard = areaGuard(me !== null, me?.user.officeRole === "Owner");
  if (guard === "sign-in") {
    return <SignInFirst />;
  }
  return guard === "allow" ? <>{children}</> : <NoAccess />;
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
      <Route path="/office/shelf" element={<ShelfChooser />} />
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
