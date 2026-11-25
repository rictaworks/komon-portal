/** The most rows one office list request asks for: the largest page the API serves. */
export const LIST_LIMIT = 200;

/** How many rows of the total the screen does not hold. Zero when every row is shown. */
export function rowsOutside(shown: number, total: number): number {
  return total - shown;
}
