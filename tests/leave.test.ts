import { describe, expect, test } from "vitest";
import {
  countLeaveDays,
  datesBetween,
  dayOfWeek,
  entitlementDays,
  monthsEmployedInYear,
  carryForward,
  availableDays,
  overlaps,
  weekStart,
  leaveYearOf,
} from "../convex/lib/leave";

// Leave day counting is the #1 source of "your system stole my leave" tickets.
// Every case below is one of those tickets, written down before it happens.

describe("countLeaveDays", () => {
  // 2026-03-09 is a Monday.
  test("a plain Monday-to-Friday week is 5 days", () => {
    expect(countLeaveDays("2026-03-09", "2026-03-13")).toBe(5);
  });

  test("Friday to Monday is 2 days, not 4 — the weekend is not deducted", () => {
    // The single most common way an HR system quietly eats annual leave.
    expect(countLeaveDays("2026-03-13", "2026-03-16")).toBe(2);
  });

  test("a weekend-only request is 0 days", () => {
    expect(countLeaveDays("2026-03-14", "2026-03-15")).toBe(0);
  });

  test("a public holiday inside the range is not deducted", () => {
    const holidays = new Set(["2026-03-11"]); // a Wednesday
    expect(countLeaveDays("2026-03-09", "2026-03-13", { holidays })).toBe(4);
  });

  test("a non-Sat/Sun weekend is respected", () => {
    // A Gulf customer works Sun-Thu. Hardcoding Sat/Sun would deduct their
    // weekend and give them Sunday free.
    expect(countLeaveDays("2026-03-09", "2026-03-13", { weekendDays: [5, 6] })).toBe(4);
  });

  test("a half day is 0.5", () => {
    expect(countLeaveDays("2026-03-10", "2026-03-10", { halfDay: true })).toBe(0.5);
  });

  test("a half day on a weekend is 0, not 0.5", () => {
    expect(countLeaveDays("2026-03-14", "2026-03-14", { halfDay: true })).toBe(0);
  });

  test("a single working day is 1", () => {
    expect(countLeaveDays("2026-03-10", "2026-03-10")).toBe(1);
  });

  test("an inverted range is refused rather than counted as 0", () => {
    expect(() => countLeaveDays("2026-03-13", "2026-03-09")).toThrow(/before/i);
  });

  test("an absurd range is refused", () => {
    expect(() => countLeaveDays("2026-01-01", "2030-01-01")).toThrow(/longer than a year/);
  });
});

describe("datesBetween / dayOfWeek", () => {
  test("is inclusive at both ends", () => {
    expect(datesBetween("2026-03-09", "2026-03-11")).toEqual([
      "2026-03-09",
      "2026-03-10",
      "2026-03-11",
    ]);
  });

  test("crosses a month boundary", () => {
    expect(datesBetween("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
  });

  test("handles a leap day", () => {
    expect(datesBetween("2028-02-28", "2028-03-01")).toEqual([
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  test("0 is Sunday and 6 is Saturday", () => {
    expect(dayOfWeek("2026-03-08")).toBe(0);
    expect(dayOfWeek("2026-03-09")).toBe(1);
    expect(dayOfWeek("2026-03-14")).toBe(6);
  });
});

describe("entitlementDays", () => {
  const annual = { daysPerYear: 14, accrualMode: "upfront" as const };
  const monthly = { daysPerYear: 14, accrualMode: "monthly" as const };

  test("upfront grants the whole year regardless of month", () => {
    expect(entitlementDays(annual, { asOfMonth: 1 })).toBe(14);
    expect(entitlementDays(annual, { asOfMonth: 11 })).toBe(14);
  });

  test("monthly accrual gives a November joiner a fraction, not a full year", () => {
    // 2 months of 14/12 = 2.333 -> 2.5 after half-day rounding.
    expect(entitlementDays(monthly, { asOfMonth: 11, monthsEmployedThisYear: 2 })).toBe(2.5);
  });

  test("monthly accrual reaches the full year by December", () => {
    expect(entitlementDays(monthly, { asOfMonth: 12, monthsEmployedThisYear: 12 })).toBe(14);
  });

  test("rounds to halves, because leave is taken in half days", () => {
    // Nobody can reconcile 7.4166 days against a request form.
    const r = entitlementDays(monthly, { asOfMonth: 6, monthsEmployedThisYear: 6 });
    expect(r * 2 === Math.round(r * 2)).toBe(true);
    expect(r).toBe(7);
  });

  test("a future year accrues nothing", () => {
    expect(entitlementDays(monthly, { asOfMonth: 0, monthsEmployedThisYear: 0 })).toBe(0);
  });
});

describe("monthsEmployedInYear", () => {
  test("no join date means assume employed all along", () => {
    expect(monthsEmployedInYear(undefined, 2026, 7)).toBe(7);
  });

  test("joined a previous year means the whole year counts", () => {
    expect(monthsEmployedInYear("2024-05-01", 2026, 7)).toBe(7);
  });

  test("joined in March of this year, now July, is 5 months", () => {
    // Inclusive of the joining month: joining on the 2nd still accrues March.
    expect(monthsEmployedInYear("2026-03-15", 2026, 7)).toBe(5);
  });

  test("joins next year, so nothing this year", () => {
    expect(monthsEmployedInYear("2027-01-01", 2026, 7)).toBe(0);
  });

  test("joined this month is 1, never 0", () => {
    expect(monthsEmployedInYear("2026-07-20", 2026, 7)).toBe(1);
  });
});

describe("carryForward", () => {
  test("no previous year means nothing carried", () => {
    expect(carryForward(null, 7)).toBe(0);
  });

  test("unused days carry, capped by the policy", () => {
    const prev = { entitledDays: 14, carriedDays: 0, usedDays: 2 }; // 12 unused
    expect(carryForward(prev, 7)).toBe(7); // capped
    expect(carryForward(prev, 20)).toBe(12); // uncapped by policy
  });

  test("a zero cap means use it or lose it", () => {
    expect(carryForward({ entitledDays: 14, carriedDays: 0, usedDays: 0 }, 0)).toBe(0);
  });

  test("overspent leave never carries a negative", () => {
    // An approved overspend must not become a debt against next year.
    expect(carryForward({ entitledDays: 14, carriedDays: 0, usedDays: 20 }, 7)).toBe(0);
  });
});

describe("availableDays", () => {
  test("pending requests are held, not ignored", () => {
    // Otherwise someone books their remaining 3 days twice before either is
    // approved and the balance goes negative.
    expect(
      availableDays({ entitledDays: 14, carriedDays: 0, usedDays: 8, pendingDays: 3 }),
    ).toBe(3);
  });

  test("carried days are spendable", () => {
    expect(
      availableDays({ entitledDays: 14, carriedDays: 5, usedDays: 14, pendingDays: 0 }),
    ).toBe(5);
  });
});

describe("overlaps", () => {
  test("touching ranges overlap", () => {
    expect(overlaps("2026-03-09", "2026-03-13", "2026-03-13", "2026-03-16")).toBe(true);
  });

  test("adjacent ranges do not", () => {
    expect(overlaps("2026-03-09", "2026-03-12", "2026-03-13", "2026-03-16")).toBe(false);
  });

  test("a range fully inside another overlaps", () => {
    expect(overlaps("2026-03-01", "2026-03-31", "2026-03-10", "2026-03-11")).toBe(true);
  });
});

describe("weekStart", () => {
  test("Monday maps to itself", () => {
    expect(weekStart("2026-03-09")).toBe("2026-03-09");
  });

  test("mid-week maps back to Monday", () => {
    expect(weekStart("2026-03-12")).toBe("2026-03-09");
  });

  test("Sunday is the END of its week, not the start", () => {
    // ISO weeks. Getting this wrong puts Sunday's hours on next week's timesheet.
    expect(weekStart("2026-03-15")).toBe("2026-03-09");
  });
});

describe("leaveYearOf", () => {
  test("a January leave year is just the calendar year", () => {
    expect(leaveYearOf("2026-03-10", 1)).toBe(2026);
  });

  test("an April leave year puts March into the previous year", () => {
    // A customer on an April-March financial year: March 2026 belongs to the
    // 2025 leave year, and getting it wrong resets balances three months early.
    expect(leaveYearOf("2026-03-10", 4)).toBe(2025);
    expect(leaveYearOf("2026-04-01", 4)).toBe(2026);
  });
});
