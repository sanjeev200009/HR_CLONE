// Shared formatters. Every displayed time is rendered in the ORG's timezone, not
// the admin's browser — an admin checking Colombo attendance from London must see
// Colombo times or the whole board is a lie.

export function time(at: number, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

export function duration(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/** Org-local "YYYY-MM-DD" for today, for date range defaults. */
export function todayIso(timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** First day of the current month, org-local. */
export function monthStartIso(timezone: string) {
  return `${todayIso(timezone).slice(0, 7)}-01`;
}
