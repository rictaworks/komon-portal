/** Where to return after sign-in: the path and its query, so that a deep link keeps its filters. */
export function returnTarget(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

/**
 * Where a visitor without a session is sent. After this tab signed out, plain Sign in: the page
 * that was open belonged to the user who left, and the next person to sign in must land on their
 * own start page. Otherwise Sign in, with the page kept to come back to.
 */
export function signInPath(signedOutHere: boolean, pathname: string, search: string): string {
  if (signedOutHere) {
    return "/sign-in";
  }
  return `/sign-in?return=${encodeURIComponent(returnTarget(pathname, search))}`;
}
