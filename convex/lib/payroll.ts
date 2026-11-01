// Payroll arithmetic. Pure functions, no Convex imports, heavily tested.
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// Payroll is the one module where a rounding error is a legal problem rather than
// a support ticket. Three rules hold throughout:
//
//   1. Money is held in CENTS as integers. Floating point rupees lose money:
//      0.1 + 0.2 !== 0.3, and a payslip that is one cent off is a payslip an
//      auditor does not trust.
//   2. Statutory rates are CONFIGURATION, never constants in code. EPF and ETF
//      percentages and the PAYE bands live on the org and are entered by someone
//      who can be held responsible for them.
//   3. With no PAYE bands configured, PAYE is zero and the caller is told it was
//      not calculated. Inventing a tax number is worse than not computing one.

export type PayeBand = {
  /** Monthly income up to this amount, in cents. The last band uses Infinity. */
  upToCents: number;
  /** Whole percent applied to the portion of income inside this band. */
  percent: number;
};

export type PayrollRates = {
  epfEmployeePct: number;
  epfEmployerPct: number;
  etfEmployerPct: number;
  /** Empty means PAYE is not configured, so it is not deducted. */
  payeBands: PayeBand[];
  /** Overtime pay multiplier on the hourly rate. */
  otMultiplier: number;
  /** Working days used to turn a monthly salary into a daily rate. */
  workingDaysPerMonth: number;
  /** Hours in a standard working day, for the hourly rate. */
  hoursPerDay: number;
};

export type SalaryInput = {
  basicCents: number;
  /** Allowances paid on top of basic. `epfLiable` decides if EPF applies. */
  allowances: { label: string; amountCents: number; epfLiable: boolean }[];
};

export type PeriodFacts = {
  /** Unpaid leave days in the period — deducted pro rata. */
  unpaidLeaveDays: number;
  /** Approved overtime hours. */
  otHours: number;
  /** Ad-hoc deductions (salary advance, loan, damage). */
  otherDeductionsCents: number;
};

export type Payslip = {
  basicCents: number;
  allowancesCents: number;
  unpaidLeaveDeductionCents: number;
  otPayCents: number;
  grossCents: number;
  epfEmployeeCents: number;
  epfEmployerCents: number;
  etfEmployerCents: number;
  payeCents: number;
  /** False when no PAYE bands are configured, so the UI can say so. */
  payeCalculated: boolean;
  otherDeductionsCents: number;
  totalDeductionsCents: number;
  netCents: number;
  /** Employer's total cost: gross plus the employer-side statutory charges. */
  employerCostCents: number;
};

/**
 * Round half away from zero, in integer cents.
 *
 * Deliberately not Math.round, which rounds -0.5 to -0.0 and biases negatives.
 * Payroll has negatives (deductions, corrections), so the symmetry matters.
 */
export function roundCents(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** A whole percent of an amount, in cents. */
export function pct(amountCents: number, percent: number): number {
  return roundCents((amountCents * percent) / 100);
}

/** Daily rate from a monthly salary. */
export function dailyRateCents(monthlyCents: number, workingDaysPerMonth: number): number {
  if (workingDaysPerMonth <= 0) throw new Error("workingDaysPerMonth must be positive");
  return roundCents(monthlyCents / workingDaysPerMonth);
}

/** Hourly rate from a monthly salary. */
export function hourlyRateCents(
  monthlyCents: number,
  workingDaysPerMonth: number,
  hoursPerDay: number,
): number {
  if (hoursPerDay <= 0) throw new Error("hoursPerDay must be positive");
  return roundCents(dailyRateCents(monthlyCents, workingDaysPerMonth) / hoursPerDay);
}

/**
 * PAYE from progressive bands.
 *
 * Each band taxes only the portion of income that falls inside it, which is how
 * a progressive scale works — applying one band's rate to the whole income is the
 * classic payroll bug and overcharges every employee above the first band.
 *
 * Returns 0 when no bands are configured. The caller must surface that.
 */
export function computePaye(taxableCents: number, bands: PayeBand[]): number {
  if (bands.length === 0 || taxableCents <= 0) return 0;

  const sorted = [...bands].sort((a, b) => a.upToCents - b.upToCents);
  let tax = 0;
  let floor = 0;

  for (const band of sorted) {
    if (taxableCents <= floor) break;
    const ceiling = Math.min(taxableCents, band.upToCents);
    const slice = ceiling - floor;
    if (slice > 0) tax += (slice * band.percent) / 100;
    floor = band.upToCents;
  }

  // Income above the last band keeps that band's rate.
  if (taxableCents > floor) {
    const top = sorted[sorted.length - 1];
    tax += ((taxableCents - floor) * top.percent) / 100;
  }

  return roundCents(tax);
}

/**
 * Build one payslip.
 *
 * Order of operations is the thing to get right:
 *   gross      = basic − unpaid leave + allowances + overtime
 *   EPF        = on basic (after unpaid leave) + EPF-liable allowances only
 *   PAYE       = on gross − employee EPF, since EPF is relieved before tax
 *   net        = gross − employee EPF − PAYE − other deductions
 *
 * EPF is computed on the EPF-liable base rather than on gross: a travel or meal
 * allowance is normally not EPF-liable, and charging EPF on it takes money from
 * both the employee and the employer that neither owes.
 */
export function buildPayslip(
  salary: SalaryInput,
  facts: PeriodFacts,
  rates: PayrollRates,
): Payslip {
  if (salary.basicCents < 0) throw new Error("Basic salary cannot be negative");
  if (facts.unpaidLeaveDays < 0) throw new Error("Unpaid leave days cannot be negative");
  if (facts.otHours < 0) throw new Error("Overtime hours cannot be negative");

  const allowancesCents = salary.allowances.reduce((s, a) => s + a.amountCents, 0);
  const epfLiableAllowancesCents = salary.allowances
    .filter((a) => a.epfLiable)
    .reduce((s, a) => s + a.amountCents, 0);

  const dailyRate = dailyRateCents(salary.basicCents, rates.workingDaysPerMonth);
  // Unpaid leave can only ever reduce basic to zero, never below it.
  const unpaidLeaveDeductionCents = Math.min(
    salary.basicCents,
    roundCents(dailyRate * facts.unpaidLeaveDays),
  );
  const paidBasicCents = salary.basicCents - unpaidLeaveDeductionCents;

  const otPayCents = roundCents(
    hourlyRateCents(salary.basicCents, rates.workingDaysPerMonth, rates.hoursPerDay) *
      facts.otHours *
      rates.otMultiplier,
  );

  const grossCents = paidBasicCents + allowancesCents + otPayCents;

  // Overtime is not EPF-liable in the normal case, so the base excludes it.
  const epfBaseCents = paidBasicCents + epfLiableAllowancesCents;
  const epfEmployeeCents = pct(epfBaseCents, rates.epfEmployeePct);
  const epfEmployerCents = pct(epfBaseCents, rates.epfEmployerPct);
  const etfEmployerCents = pct(epfBaseCents, rates.etfEmployerPct);

  const payeCalculated = rates.payeBands.length > 0;
  const payeCents = computePaye(Math.max(0, grossCents - epfEmployeeCents), rates.payeBands);

  const totalDeductionsCents =
    epfEmployeeCents + payeCents + facts.otherDeductionsCents;

  return {
    basicCents: salary.basicCents,
    allowancesCents,
    unpaidLeaveDeductionCents,
    otPayCents,
    grossCents,
    epfEmployeeCents,
    epfEmployerCents,
    etfEmployerCents,
    payeCents,
    payeCalculated,
    otherDeductionsCents: facts.otherDeductionsCents,
    totalDeductionsCents,
    // Net can legitimately be negative if other deductions exceed pay (a large
    // salary advance). It is NOT clamped: hiding that would hide a real problem
    // the person running payroll has to resolve.
    netCents: grossCents - totalDeductionsCents,
    employerCostCents: grossCents + epfEmployerCents + etfEmployerCents,
  };
}

/** Sum payslips for the pay-run totals. Summed from the rows, never recomputed. */
export function sumPayslips(slips: Payslip[]) {
  const add = (f: (s: Payslip) => number) => slips.reduce((t, s) => t + f(s), 0);
  return {
    headcount: slips.length,
    grossCents: add((s) => s.grossCents),
    epfEmployeeCents: add((s) => s.epfEmployeeCents),
    epfEmployerCents: add((s) => s.epfEmployerCents),
    etfEmployerCents: add((s) => s.etfEmployerCents),
    payeCents: add((s) => s.payeCents),
    otherDeductionsCents: add((s) => s.otherDeductionsCents),
    netCents: add((s) => s.netCents),
    employerCostCents: add((s) => s.employerCostCents),
  };
}

/** Rupees-and-cents string for display. No currency symbol — the UI adds it. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${String(part).padStart(2, "0")}`;
}

/** "2026-03" -> { year, month }. Throws rather than guessing. */
export function parsePeriod(period: string): { year: number; month: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new Error(`Bad period "${period}" — expected YYYY-MM`);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new Error(`Bad month in "${period}"`);
  return { year: Number(m[1]), month };
}

/** First and last calendar date of a period, as "YYYY-MM-DD". */
export function periodBounds(period: string): { from: string; to: string } {
  const { year, month } = parsePeriod(period);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, "0")}` };
}
