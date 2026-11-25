/** What an area's guard does: send a visitor without a session to sign in, refuse, or let in. */
export type AreaGuard = "sign-in" | "deny" | "allow";

/**
 * Decides an area's guard. A visitor with no session (for example right after Sign out) is
 * always sent to sign in; only a signed-in user is refused by the area's own rule.
 */
export function areaGuard(signedIn: boolean, allowed: boolean): AreaGuard {
  if (!signedIn) {
    return "sign-in";
  }
  return allowed ? "allow" : "deny";
}
