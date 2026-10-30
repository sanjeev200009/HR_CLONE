// All attendance time maths. Pure functions, no Convex imports, so it is testable
// on its own and callable from mutations.
//
// Two rules this file exists to enforce:
//   1. The authoritative instant is always Date.now() taken inside the mutation.
//      A device clock is a claim, not a fact.
//   2. A "work date" is a calendar date in the ORG's timezone, not UTC and not the
//      server's. An 09:00 clock-in in Colombo is 03:30 UTC the same day; a 01:00
//      clock-in is still the previous work date in some orgs' eyes, so the org
//      timezone is the only sane basis.
//
// Intl does the timezone work. It is in the Convex runtime and handles DST per
// instant, so this stays correct when the product leaves Sri Lanka (which has no
// DST) for markets that have it.

/** Org-local calendar date as "YYYY-MM-DD". */
export function workDate(at: number, timezone: string): string {
  // en-CA formats as YYYY-MM-DD, which is the cheapest correct way to get an
  // ISO date in a named timezone without pulling in a date library.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(at));
}

/** Minutes since org-local midnight. 09:30 -> 570. */
export function minutesIntoDay(at: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(at));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  // en-GB can render midnight as 24:00 rather than 00:00. Normalise.
  return (hour % 24) * 60 + minute;
}

/** Parse "09:00" / "17:30" to minutes since midnight. Throws on nonsense. */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
  if (!m) throw new Error(`Bad time "${hm}" — expected HH:MM`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Bad time "${hm}" — out of range`);
  return h * 60 + min;
}

/** Format minutes since midnight back to "HH:MM". */
export function formatHm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Late if the org-local clock-in time is past expectedStart + grace. */
export function isLate(
  clockInAt: number,
  org: { timezone: string; expectedStart: string; graceMinutes: number },
): boolean {
  return (
    minutesIntoDay(clockInAt, org.timezone) >
    parseHm(org.expectedStart) + org.graceMinutes
  );
}

/** Worked milliseconds for a record, counting an open session up to `now`. */
export function workedMs(
  record: { clockInAt: number; clockOutAt?: number },
  now: number,
): number {
  return Math.max(0, (record.clockOutAt ?? now) - record.clockInAt);
}

/** "7h 32m", for screens. */
export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/**
 * Should an open record be treated as a missed clock-out?
 *
 * Deliberately NOT auto-closed: inventing a clock-out time would put a fabricated
 * number into someone's payroll-adjacent record. It gets flagged, and a human
 * approves a correction. PRD §7.
 *
 * The test is "the org-local work date has moved on", not "24 hours elapsed", so a
 * night shift that ends at 02:00 isn't flagged while it is still running.
 */
export function isMissedClockOut(
  record: { clockInAt: number; clockOutAt?: number },
  now: number,
  timezone: string,
): boolean {
  if (record.clockOutAt !== undefined) return false;
  return workDate(record.clockInAt, timezone) !== workDate(now, timezone);
}
