import { describe, expect, test } from "vitest";
import {
  roundCents,
  pct,
  dailyRateCents,
  hourlyRateCents,
  computePaye,
  buildPayslip,
  sumPayslips,
  formatCents,
  parsePeriod,
  periodBounds,
  PayrollRates,
} from "../convex/lib/payroll";

// Payroll is the one module where a rounding error is a legal problem rather
// than a support ticket. Everything here is in integer cents.

const RATES: PayrollRates = {
  epfEmployeePct: 8,
  epfEmployerPct: 12,
  etfEmployerPct: 3,
  payeBands: [],
  otMultiplier: 1.5,
  workingDaysPerMonth: 22,
  hoursPerDay: 8,
};

// LKR 100,000.00 monthly, in cents.
const BASIC = 10_000_000;

describe("money primitives", () => {
  test("rounds half away from zero, symmetrically", () => {
    // Math.round(-0.5) is -0, which biases every deduction. Payroll has
    // negatives, so the symmetry is the point.
    expect(roundCents(0.5)).toBe(1);
    expect(roundCents(-0.5)).toBe(-1);
    expect(roundCents(2.4)).toBe(2);
    expect(roundCents(-2.6)).toBe(-3);
  });

  test("a percentage lands on a whole cent", () => {
    expect(pct(10_000_000, 8)).toBe(800_000);
    expect(pct(333, 8)).toBe(27); // 26.64 -> 27
    expect(Number.isInteger(pct(12_345, 3))).toBe(true);
  });

  test("daily and hourly rates derive from the monthly figure", () => {
    expect(dailyRateCents(BASIC, 22)).toBe(454_545); // 4,545.45
    expect(hourlyRateCents(BASIC, 22, 8)).toBe(56_818);
  });

  test("a zero divisor is refused rather than returning Infinity", () => {
    expect(() => dailyRateCents(BASIC, 0)).toThrow(/positive/);
    expect(() => hourlyRateCents(BASIC, 22, 0)).toThrow(/positive/);
  });
});

describe("computePaye", () => {
  // Deliberately illustrative bands, not a claim about Sri Lankan law.
  const bands = [
    { upToCents: 10_000_000, percent: 0 }, // first 100,000 free
    { upToCents: 14_000_000, percent: 6 }, // next 40,000 at 6%
    { upToCents: 18_000_000, percent: 12 },
  ];

  test("no bands configured means no tax, never a guess", () => {
    // The whole reason PAYE starts empty: inventing a tax number is worse than
    // not computing one.
    expect(computePaye(50_000_000, [])).toBe(0);
  });

  test("income inside the free band is untaxed", () => {
    expect(computePaye(9_000_000, bands)).toBe(0);
  });

  test("each band taxes only its own slice", () => {
    // 120,000: first 100,000 at 0% + next 20,000 at 6% = 1,200.00
    expect(computePaye(12_000_000, bands)).toBe(120_000);
  });

  test("crossing two bands sums the slices, not the top rate on everything", () => {
    // The classic payroll bug is 160,000 x 12%. Correct is
    // 0 + (40,000 x 6%) + (20,000 x 12%) = 2,400 + 2,400 = 4,800.00
    expect(computePaye(16_000_000, bands)).toBe(480_000);
    expect(computePaye(16_000_000, bands)).not.toBe(pct(16_000_000, 12));
  });

  test("income above the last band keeps the top rate", () => {
    // 200,000: 0 + 2,400 + 4,800 + (20,000 x 12% = 2,400) = 9,600.00
    expect(computePaye(20_000_000, bands)).toBe(960_000);
  });

  test("unsorted bands are handled, not trusted", () => {
    const shuffled = [bands[2], bands[0], bands[1]];
    expect(computePaye(16_000_000, shuffled)).toBe(computePaye(16_000_000, bands));
  });

  test("zero and negative taxable income is zero tax", () => {
    expect(computePaye(0, bands)).toBe(0);
    expect(computePaye(-500, bands)).toBe(0);
  });
});

describe("buildPayslip", () => {
  const salary = {
    basicCents: BASIC,
    allowances: [
      { label: "Transport", amountCents: 500_000, epfLiable: false },
      { label: "Attendance bonus", amountCents: 250_000, epfLiable: true },
    ],
  };
  const clean = { unpaidLeaveDays: 0, otHours: 0, otherDeductionsCents: 0 };

  test("gross is basic plus allowances plus overtime", () => {
    const s = buildPayslip(salary, clean, RATES);
    expect(s.grossCents).toBe(BASIC + 750_000);
    expect(s.allowancesCents).toBe(750_000);
  });

  test("EPF applies to basic plus EPF-liable allowances only", () => {
    // Base is 100,000 + 2,500 = 102,500. Charging EPF on the transport
    // allowance would take money from both sides that neither owes.
    const s = buildPayslip(salary, clean, RATES);
    const base = BASIC + 250_000;
    expect(s.epfEmployeeCents).toBe(pct(base, 8));
    expect(s.epfEmployerCents).toBe(pct(base, 12));
    expect(s.etfEmployerCents).toBe(pct(base, 3));
  });

  test("overtime is paid at the multiplier and is not EPF-liable", () => {
    const s = buildPayslip(salary, { ...clean, otHours: 10 }, RATES);
    expect(s.otPayCents).toBe(roundCents(hourlyRateCents(BASIC, 22, 8) * 10 * 1.5));
    // EPF base unchanged by overtime.
    const noOt = buildPayslip(salary, clean, RATES);
    expect(s.epfEmployeeCents).toBe(noOt.epfEmployeeCents);
  });

  test("unpaid leave is deducted pro rata at the daily rate", () => {
    const s = buildPayslip(salary, { ...clean, unpaidLeaveDays: 3 }, RATES);
    expect(s.unpaidLeaveDeductionCents).toBe(roundCents(dailyRateCents(BASIC, 22) * 3));
    expect(s.grossCents).toBe(BASIC - s.unpaidLeaveDeductionCents + 750_000);
  });

  test("a half day of unpaid leave is half the daily rate", () => {
    const s = buildPayslip(salary, { ...clean, unpaidLeaveDays: 0.5 }, RATES);
    expect(s.unpaidLeaveDeductionCents).toBe(roundCents(dailyRateCents(BASIC, 22) * 0.5));
  });

  test("unpaid leave can never reduce basic below zero", () => {
    // 40 days of unpaid leave in a 22-day month: the deduction stops at basic
    // rather than running negative and paying the employer.
    const s = buildPayslip(salary, { ...clean, unpaidLeaveDays: 40 }, RATES);
    expect(s.unpaidLeaveDeductionCents).toBe(BASIC);
    expect(s.grossCents).toBe(750_000); // allowances only
    expect(s.epfEmployeeCents).toBe(pct(250_000, 8)); // only the liable allowance
  });

  test("PAYE is charged after employee EPF relief", () => {
    const bands = [{ upToCents: 0, percent: 10 }]; // flat 10% on everything
    const s = buildPayslip(salary, clean, { ...RATES, payeBands: bands });
    expect(s.payeCents).toBe(pct(s.grossCents - s.epfEmployeeCents, 10));
    expect(s.payeCalculated).toBe(true);
  });

  test("with no bands, payeCalculated is false so the UI can say so", () => {
    const s = buildPayslip(salary, clean, RATES);
    expect(s.payeCents).toBe(0);
    expect(s.payeCalculated).toBe(false);
  });

  test("net is gross minus employee EPF, PAYE and other deductions", () => {
    const s = buildPayslip(salary, { ...clean, otherDeductionsCents: 100_000 }, RATES);
    expect(s.netCents).toBe(
      s.grossCents - s.epfEmployeeCents - s.payeCents - 100_000,
    );
    expect(s.totalDeductionsCents).toBe(s.epfEmployeeCents + s.payeCents + 100_000);
  });

  test("net is NOT clamped at zero", () => {
    // A salary advance larger than the month's pay is a real situation, and
    // hiding it would hide a problem payroll has to resolve.
    const s = buildPayslip(salary, { ...clean, otherDeductionsCents: 99_999_999 }, RATES);
    expect(s.netCents).toBeLessThan(0);
  });

  test("employer cost is gross plus the employer-side charges", () => {
    const s = buildPayslip(salary, clean, RATES);
    expect(s.employerCostCents).toBe(
      s.grossCents + s.epfEmployerCents + s.etfEmployerCents,
    );
    // The employee's EPF is NOT an employer cost on top — it comes out of gross.
    expect(s.employerCostCents).not.toBe(
      s.grossCents + s.epfEmployerCents + s.etfEmployerCents + s.epfEmployeeCents,
    );
  });

  test("every figure on the slip is a whole number of cents", () => {
    const s = buildPayslip(salary, { unpaidLeaveDays: 1.5, otHours: 7.25, otherDeductionsCents: 333 }, RATES);
    for (const [k, val] of Object.entries(s)) {
      if (typeof val === "number") {
        expect(Number.isInteger(val), `${k} = ${val} is not a whole cent`).toBe(true);
      }
    }
  });

  test("negative inputs are refused rather than silently paid", () => {
    expect(() => buildPayslip({ ...salary, basicCents: -1 }, clean, RATES)).toThrow(/negative/);
    expect(() => buildPayslip(salary, { ...clean, unpaidLeaveDays: -1 }, RATES)).toThrow(/negative/);
    expect(() => buildPayslip(salary, { ...clean, otHours: -1 }, RATES)).toThrow(/negative/);
  });

  test("a zero salary produces a zero slip, not a crash", () => {
    const s = buildPayslip({ basicCents: 0, allowances: [] }, clean, RATES);
    expect(s.grossCents).toBe(0);
    expect(s.netCents).toBe(0);
    expect(s.employerCostCents).toBe(0);
  });
});

describe("sumPayslips", () => {
  test("totals are summed from the rows as shown", () => {
    // Totals must come from the displayed rows, never from a separate
    // calculation over raw salaries, or the run disagrees with its own table.
    const a = buildPayslip({ basicCents: 5_000_000, allowances: [] }, { unpaidLeaveDays: 0, otHours: 0, otherDeductionsCents: 0 }, RATES);
    const b = buildPayslip({ basicCents: 3_333_333, allowances: [] }, { unpaidLeaveDays: 0, otHours: 0, otherDeductionsCents: 0 }, RATES);
    const t = sumPayslips([a, b]);
    expect(t.headcount).toBe(2);
    expect(t.grossCents).toBe(a.grossCents + b.grossCents);
    expect(t.netCents).toBe(a.netCents + b.netCents);
    expect(t.employerCostCents).toBe(a.employerCostCents + b.employerCostCents);
  });

  test("an empty run totals zero rather than NaN", () => {
    const t = sumPayslips([]);
    expect(t.headcount).toBe(0);
    expect(t.grossCents).toBe(0);
  });
});

describe("formatting and periods", () => {
  test("cents render with two decimals and thousands separators", () => {
    expect(formatCents(10_000_000)).toBe("100,000.00");
    expect(formatCents(5)).toBe("0.05");
    expect(formatCents(-12_345)).toBe("-123.45");
    expect(formatCents(0)).toBe("0.00");
  });

  test("a period is parsed strictly", () => {
    expect(parsePeriod("2026-03")).toEqual({ year: 2026, month: 3 });
    expect(() => parsePeriod("2026-3")).toThrow();
    expect(() => parsePeriod("2026-13")).toThrow();
    expect(() => parsePeriod("March 2026")).toThrow();
  });

  test("period bounds cover the whole month, including February", () => {
    expect(periodBounds("2026-03")).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(periodBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(periodBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodBounds("2026-04")).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });
});
