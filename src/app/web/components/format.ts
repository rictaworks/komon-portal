/** Date and time as shown in lists: 24 Nov 2026 09:12. */
export function formatDateTime(iso: string | null): string {
  if (iso === null) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** A calendar day (YYYY-MM-DD) as 24 Nov 2026, without shifting it by time zone. */
export function formatDay(day: string | null): string {
  if (day === null) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
}

/** A month (YYYY-MM) as November 2026. */
export function formatMonth(month: string | null): string {
  if (month === null) {
    return "";
  }
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
}

export function formatSize(bytes: number): string {
  const units = ["B", "KB", "MB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
