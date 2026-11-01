// Money on the client. Mirrors convex/lib/payroll.ts: integer cents everywhere,
// and the only place a decimal string becomes a number.

/** 100,000.00 cents -> "100,000.00". No currency symbol; the UI adds it. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const part = abs % 100;
  return `${sign}${whole.toLocaleString("en-US")}.${String(part).padStart(2, "0")}`;
}

/**
 * "100,000.50" -> 10000050 cents.
 *
 * Deliberately NOT Math.round(Number(x) * 100): 19.99 * 100 is 1998.9999... in
 * binary floating point, so parsing the decimal digits directly is the only way
 * to be exact. Payroll inputs cannot afford a cent of drift.
 */
export function toCents(input: string): number {
  const clean = input.trim().replace(/,/g, "");
  if (!clean) return 0;
  const m = /^(-?)(\d*)(?:\.(\d{0,2}))?$/.exec(clean);
  if (!m) throw new Error(`"${input}" is not an amount — use digits like 100000.00`);
  const sign = m[1] === "-" ? -1 : 1;
  const whole = m[2] ? Number(m[2]) : 0;
  const frac = (m[3] ?? "").padEnd(2, "0");
  return sign * (whole * 100 + Number(frac));
}
