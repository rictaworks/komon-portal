/** Where to return after sign-in: the path and its query, so that a deep link keeps its filters. */
export function returnTarget(pathname: string, search: string): string {
  return `${pathname}${search}`;
}
