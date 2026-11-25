import type { InvitationView } from "../../api/office-types";

/**
 * The staff invitations that can still be used at `now`: issued, not yet used or cancelled, and not past
 * their expiry. An expiry that is not a valid time is an error, not an invitation to hide.
 */
export function outstandingInvitations(invitations: readonly InvitationView[], now: Date): InvitationView[] {
  return invitations.filter((invitation) => {
    const expiresAt = Date.parse(invitation.expiresAt);
    if (Number.isNaN(expiresAt)) {
      throw new Error(`invalid invitation expiry: ${invitation.id}`);
    }
    return invitation.status === "Issued" && expiresAt > now.getTime();
  });
}
