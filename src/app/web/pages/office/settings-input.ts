/** The range the server accepts for the Jev confidence threshold (see the settings service). */
export const JEV_THRESHOLD_MIN = 0.8;
export const JEV_THRESHOLD_MAX = 1;
/** The spin-button step only. Any value inside the range is valid, on this grid or not. */
export const JEV_THRESHOLD_STEP = 0.01;

/** The threshold typed into the office form, or null when it is not a number inside the accepted range. */
export function parseJevThreshold(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return value >= JEV_THRESHOLD_MIN && value <= JEV_THRESHOLD_MAX ? value : null;
}

/**
 * Copies text with the Clipboard API and reports whether it worked.
 * The API is missing outside a secure context (plain http by host name) and in some embedded views;
 * that is reported as a failure like a refused write, so the caller can always tell the user.
 */
export async function copyText(clipboard: Pick<Clipboard, "writeText"> | undefined, text: string): Promise<boolean> {
  if (clipboard === undefined) {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
