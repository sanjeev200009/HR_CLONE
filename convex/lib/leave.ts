// Leave arithmetic. Pure functions, no Convex imports, so it is testable alone.
//
// This is the file customers will argue with you about. "I took 3 days, why did it
// deduct 5?" is a support ticket caused by day counting, so the counting is here,
// in one place, with the weekend and the holiday list as explicit inputs rather
// than assumptions.

/** Calendar days as "YYYY-MM-DD", inclusive. Short ranges only. */
export function datesBetween(start: string, end: string): string[] {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("Dates must be YYYY-MM-DD");
  if (b < a) throw new Error("End date is before start date");
  // A year is the most anyone can request in one go; beyond that something is wrong.
  if (b - a > 366 * 86_400_000) throw new Error("That range is longer than a year");

  const out: string[] = [];
  for (let t = a; t <= b; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** 0 = Sunday … 6 = Saturday, for a "YYYY-MM-DD". */
export function dayOfWeek(date: string): number {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error("Date must be YYYY-MM-DD");
  return new Date(t).getUTCDay();
}

export const DEFAULT_WEEKEND = [0, 6]; // Sri Lanka: Saturday and Sunday

/**
 * Leave days consumed by a request.
 *
 * Weekends and public holidays inside the range are NOT deducted — an employee
 * taking Friday to Monday off spends 2 days, not 4. Counting the weekend is the
 * single most common way an HR system quietly steals someone's annual leave.
 *
 * A half day only applies to a single-day request; the caller validates that.
 */
export function countLeaveDays(
  start: string,
  end: string,
  opts: { weekendDays?: number[]; holidays?: Set<string>; halfDay?: boolean } = {},
): number {
  const weekend = new Set(opts.weekendDays ?? DEFAULT_WEEKEND);
  const holidays = opts.holidays ?? new Set<string>();

  const working = datesBetween(start, end).filter(
    (d) => !weekend.has(dayOfWeek(d)) && !holidays.has(d),
  );

  if (opts.halfDay) {
    // A half day on a weekend or holiday is zero days, not half of nothing.
    return working.length === 0 ? 0 : 0.5;
  }
  return working.length;
}

/**
 * Entitlement for a member in a given leave year.
 *
 * Two things make this more than a constant:
 *   - monthly accrual, so a November joiner does not receive a full year
 *   - pro-rating by join date, for the year they actually started
 *
 * `asOfMonth` is 1-12 and is how far through the leave year we are. Accrual is
 * credited for months already begun, which is the generous reading — an employee
 * who joins on the 2nd still accrues that month. Picked deliberately: the mean
 * reading saves the company a fraction of a day and costs you the relationship.
 */
export function entitlementDays(
  type: { daysPerYear: number; accrualMode: "upfront" | "monthly" },
  opts: { asOfMonth: number; monthsEmployedThisYear?: number },
): number {
  if (type.accrualMode === "upfront") return type.daysPerYear;

  const monthsElapsed = Math.min(12, Math.max(0, opts.asOfMonth));
  const months = Math.min(monthsElapsed, opts.monthsEmployedThisYear ?? monthsElapsed);
  const perMonth = type.daysPerYear / 12;
  // Round to halves: leave is taken in half days, so an entitlement of 7.4166
  // days is a number no HR manager can reconcile against a request form.
  return Math.round(months * perMonth * 2) / 2;
}

/** Months of the leave year this member was employed for, given a join date. */
export function monthsEmployedInYear(
  joinedOn: string | undefined,
  year: number,
  asOfMonth: number,
): number {
  if (!joinedOn) return asOfMonth;
  const joinYear = Number(joinedOn.slice(0, 4));
  const joinMonth = Number(joinedOn.slice(5, 7));
  if (joinYear > year) return 0; // not employed yet
  if (joinYear < year) return asOfMonth; // employed all year
  return Math.max(0, asOfMonth - joinMonth + 1);
}

/** Carry-forward from last year, capped by the policy. */
export function carryForward(
  previous: { entitledDays: number; carriedDays: number; usedDays: number } | null,
  carryForwardMax: number,
): number {
  if (!previous) return 0;
  const unused = previous.entitledDays + previous.carriedDays - previous.usedDays;
  return Math.max(0, Math.min(unused, carryForwardMax));
}

/** What the employee can still take. Pending requests are held, not ignored. */
export function availableDays(balance: {
  entitledDays: number;
  carriedDays: number;
  usedDays: number;
  pendingDays: number;
}): number {
  return (
    balance.entitledDays + balance.carriedDays - balance.usedDays - balance.pendingDays
  );
}

/** Do two date ranges touch? Used to reject double-booked leave. */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** Monday of the week containing `date`, as "YYYY-MM-DD". For timesheets. */
export function weekStart(date: string): string {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error("Date must be YYYY-MM-DD");
  const dow = new Date(t).getUTCDay(); // 0=Sun
  const backToMonday = (dow + 6) % 7; // Sunday counts as the END of a week
  return new Date(t - backToMonday * 86_400_000).toISOString().slice(0, 10);
}

/** The leave year a date falls in, honouring a non-January year start. */
export function leaveYearOf(date: string, startMonth = 1): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month < startMonth ? year - 1 : year;
}
