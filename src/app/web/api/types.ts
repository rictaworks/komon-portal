/** Shapes of the API responses used by the screens. */

export interface PublicConfig {
  environment: "development" | "production";
  turnstileSiteKey: string | null;
  signInAvailable: boolean;
  setupOpen: boolean;
}

export interface MeMembership {
  clientId: string;
  status: "Pending" | "Active" | "Revoked" | "Rejected";
  code: string | null;
  corporateName: string | null;
  clientStatus: "Active" | "Archived" | "Closed" | null;
}

export interface Me {
  user: {
    id: string;
    displayName: string;
    officeRole: "Owner" | "Staff" | null;
    officeStatus: "Pending" | "Active" | "Revoked" | "Rejected" | null;
  };
  memberships: MeMembership[];
  csrfToken: string;
}
