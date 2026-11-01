import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireOrgAdmin } from "./lib/guard";
import { workedMs } from "./lib/time";
import { countLeaveDays, DEFAULT_WEEKEND } from "./lib/leave";
import {
  buildPayslip,
  sumPayslips,
  periodBounds,
  parsePeriod,
  PayrollRates,
} from "./lib/payroll";

// Payroll.
//
// What makes this payroll rather than a calculator: it reads the attendance and
// leave that the rest of the product already records. Unpaid leave comes out of
// the month pro rata, and overtime comes from hours actually clocked beyond the
// org's standard day. Nobody retypes a number that the system already knows.

const DEFAULTS = {
  currency: "LKR",
  // Long-standing Sri Lankan statutory rates. Editable, and the UI says so.
  epfEmployeePct: 8,
  epfEmployerPct: 12,
  etfEmployerPct: 3,
  // Empty: no PAYE until somebody who can be held responsible enters the bands.
  payeBands: [] as { upToCents: number; percent: number }[],
  otMultiplier: 1.5,
  workingDaysPerMonth: 22,
  hoursPerDay: 8,
};

export const config = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);
    const row = await ctx.db
      .query("payrollConfig")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();
    return row ?? { ...DEFAULTS, orgId, _id: null, isDefault: true };
  },
});

export const saveConfig = mutation({
  args: {
    orgId: v.id("organizations"),
    currency: v.string(),
    epfEmployeePct: v.number(),
    epfEmployerPct: v.number(),
    etfEmployerPct: v.number(),
    payeBands: v.array(v.object({ upToCents: v.number(), percent: v.number() })),
    otMultiplier: v.number(),
    workingDaysPerMonth: v.number(),
    hoursPerDay: v.number(),
  },
  handler: async (ctx, { orgId, ...cfg }) => {
    const admin = await requireOrgAdmin(ctx, orgId);

    for (const [k, val] of Object.entries({
      epfEmployeePct: cfg.epfEmployeePct,
      epfEmployerPct: cfg.epfEmployerPct,
      etfEmployerPct: cfg.etfEmployerPct,
    })) {
      if (val < 0 || val > 100) throw new Error(`${k} must be between 0 and 100`);
    }
    if (cfg.workingDaysPerMonth < 1 || cfg.workingDaysPerMonth > 31) {
      throw new Error("Working days per month must be between 1 and 31");
    }
    if (cfg.hoursPerDay < 1 || cfg.hoursPerDay > 24) {
      throw new Error("Hours per day must be between 1 and 24");
    }
    if (cfg.otMultiplier < 1 || cfg.otMultiplier > 5) {
      throw new Error("Overtime multiplier must be between 1 and 5");
    }
    // Bands must ascend, or the progressive walk taxes the wrong slices.
    let prev = 0;
    for (const b of cfg.payeBands) {
      if (b.upToCents <= prev) throw new Error("PAYE bands must ascend");
      if (b.percent < 0 || b.percent > 100) throw new Error("A PAYE rate must be 0-100%");
      prev = b.upToCents;
    }

    const existing = await ctx.db
      .query("payrollConfig")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .unique();

    if (existing) await ctx.db.patch(existing._id, cfg);
    else await ctx.db.insert("payrollConfig", { orgId, ...cfg });

    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "payroll.configSaved",
      entityType: "payrollConfig",
      metadata: { payeBands: cfg.payeBands.length },
    });
  },
});

// ---------------------------------------------------------------------------
// Salaries
// ---------------------------------------------------------------------------

export const salaries = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);
    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((m) => m.isActive);

    return await Promise.all(
      members.map(async (m) => {
        const current = await currentSalary(ctx, m._id);
        return {
          memberId: m._id,
          fullName: m.fullName,
          email: m.email,
          jobTitle: m.jobTitle ?? null,
          basicCents: current?.basicCents ?? null,
          allowances: current?.allowances ?? [],
          effectiveFrom: current?.effectiveFrom ?? null,
        };
      }),
    );
  },
});

export const setSalary = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    basicCents: v.number(),
    allowances: v.array(
      v.object({ label: v.string(), amountCents: v.number(), epfLiable: v.boolean() }),
    ),
    effectiveFrom: v.string(),
  },
  handler: async (ctx, { orgId, memberId, basicCents, allowances, effectiveFrom }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const target = await ctx.db.get(memberId);
    if (!target || target.orgId !== orgId) throw new Error("Employee not found");

    if (!Number.isInteger(basicCents) || basicCents < 0) {
      throw new Error("Basic salary must be a whole number of cents, and not negative");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      throw new Error("Effective date must be YYYY-MM-DD");
    }
    for (const a of allowances) {
      if (!a.label.trim()) throw new Error("Every allowance needs a label");
      if (!Number.isInteger(a.amountCents) || a.amountCents < 0) {
        throw new Error("An allowance must be a whole number of cents, and not negative");
      }
    }

    // A new row per change, never an edit: a payslip already issued must stay
    // explainable against the salary that produced it.
    const id = await ctx.db.insert("salaries", {
      orgId,
      memberId,
      basicCents,
      allowances,
      effectiveFrom,
    });
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "payroll.salarySet",
      entityType: "members",
      entityId: memberId,
      metadata: { basicCents, effectiveFrom },
    });
    return id;
  },
});

// ---------------------------------------------------------------------------
// Pay runs
// ---------------------------------------------------------------------------

export const runs = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);
    return await ctx.db
      .query("payRuns")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(36);
  },
});

/**
 * Build (or rebuild) a draft pay run for a period.
 *
 * Idempotent: running it again on a draft replaces its payslips, so an admin can
 * fix a salary and recalculate. A FINALISED run is never touched.
 */
export const buildRun = mutation({
  args: { orgId: v.id("organizations"), period: v.string() },
  handler: async (ctx, { orgId, period }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    parsePeriod(period); // throws on nonsense before anything is written

    const existing = await ctx.db
      .query("payRuns")
      .withIndex("by_org_period", (q) => q.eq("orgId", orgId).eq("period", period))
      .unique();
    if (existing?.status === "finalised") {
      throw new Error(`${period} is finalised. Create a correction run instead.`);
    }

    const rates = await ratesFor(ctx, orgId);
    const { from, to } = periodBounds(period);

    const holidays = new Set(
      (
        await ctx.db
          .query("holidays")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((h) => h.date),
    );

    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((m) => m.isActive);

    // Clear a previous draft's payslips before rebuilding.
    if (existing) {
      const old = await ctx.db
        .query("payslips")
        .withIndex("by_run", (q) => q.eq("payRunId", existing._id))
        .collect();
      for (const row of old) await ctx.db.delete(row._id);
    }

    const built: {
      memberId: Id<"members">;
      slip: ReturnType<typeof buildPayslip>;
      unpaidLeaveDays: number;
      otHours: number;
    }[] = [];

    for (const member of members) {
      const salary = await currentSalary(ctx, member._id, to);
      // No salary on file means no payslip. Silently paying zero would hide the
      // fact that somebody was never set up.
      if (!salary) continue;

      const unpaidLeaveDays = await unpaidLeaveIn(ctx, orgId, member._id, from, to, {
        weekendDays: org.weekendDays ?? DEFAULT_WEEKEND,
        holidays,
      });
      const otHours = await overtimeHoursIn(ctx, member._id, from, to, rates.hoursPerDay);

      built.push({
        memberId: member._id,
        unpaidLeaveDays,
        otHours,
        slip: buildPayslip(
          { basicCents: salary.basicCents, allowances: salary.allowances },
          { unpaidLeaveDays, otHours, otherDeductionsCents: 0 },
          rates,
        ),
      });
    }

    // Totals summed from the rows as shown, never recomputed from raw salaries.
    const totals = sumPayslips(built.map((b) => b.slip));

    const runId =
      existing?._id ??
      (await ctx.db.insert("payRuns", { orgId, period, status: "draft", totals }));
    if (existing) await ctx.db.patch(runId, { totals, status: "draft" });

    for (const b of built) {
      await ctx.db.insert("payslips", {
        orgId,
        payRunId: runId,
        memberId: b.memberId,
        period,
        unpaidLeaveDays: b.unpaidLeaveDays,
        otHours: b.otHours,
        ...b.slip,
      });
    }

    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "payroll.runBuilt",
      entityType: "payRuns",
      entityId: runId,
      metadata: { period, headcount: totals.headcount, netCents: totals.netCents },
    });

    return { runId, ...totals, skipped: members.length - built.length };
  },
});

export const finalise = mutation({
  args: { orgId: v.id("organizations"), payRunId: v.id("payRuns") },
  handler: async (ctx, { orgId, payRunId }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const run = await ctx.db.get(payRunId);
    if (!run || run.orgId !== orgId) throw new Error("Pay run not found");
    if (run.status === "finalised") throw new Error("That run is already finalised");
    if (run.totals.headcount === 0) {
      throw new Error("Nothing to finalise — no employee has a salary on file");
    }

    await ctx.db.patch(payRunId, {
      status: "finalised",
      finalisedAt: Date.now(),
      finalisedBy: admin._id,
    });
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "payroll.runFinalised",
      entityType: "payRuns",
      entityId: payRunId,
      metadata: { period: run.period, netCents: run.totals.netCents },
    });
  },
});

/** Payslips in a run, with names. Admin view. */
export const runPayslips = query({
  args: { orgId: v.id("organizations"), payRunId: v.id("payRuns") },
  handler: async (ctx, { orgId, payRunId }) => {
    await requireOrgAdmin(ctx, orgId);
    const run = await ctx.db.get(payRunId);
    if (!run || run.orgId !== orgId) throw new Error("Pay run not found");

    const rows = await ctx.db
      .query("payslips")
      .withIndex("by_run", (q) => q.eq("payRunId", payRunId))
      .collect();

    return await Promise.all(
      rows.map(async (p) => {
        const m = await ctx.db.get(p.memberId);
        return { ...p, fullName: m?.fullName ?? "(removed)", email: m?.email ?? "" };
      }),
    );
  },
});

/**
 * An employee's own payslips — FINALISED runs only.
 *
 * A draft is working material: showing it would have people reading a number
 * that is about to change.
 */
export const myPayslips = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const member = await requireMember(ctx, orgId);
    const rows = await ctx.db
      .query("payslips")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .order("desc")
      .take(36);

    const out = [];
    for (const p of rows) {
      const run = await ctx.db.get(p.payRunId);
      if (run?.status !== "finalised") continue;
      out.push({ ...p, finalisedAt: run.finalisedAt ?? null });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ratesFor(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
): Promise<PayrollRates> {
  const row = await ctx.db
    .query("payrollConfig")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .unique();
  return row ?? DEFAULTS;
}

/** The salary in force on a date (latest effectiveFrom at or before it). */
async function currentSalary(
  ctx: QueryCtx | MutationCtx,
  memberId: Id<"members">,
  onDate?: string,
): Promise<Doc<"salaries"> | null> {
  const rows = await ctx.db
    .query("salaries")
    .withIndex("by_member", (q) => q.eq("memberId", memberId))
    .collect();
  const eligible = rows
    .filter((r) => !onDate || r.effectiveFrom <= onDate)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return eligible[0] ?? null;
}

/**
 * Unpaid leave days inside a period.
 *
 * Only APPROVED leave of a type whose `isPaid` is false. Counted with the same
 * countLeaveDays() the leave module uses, so payroll and the leave balance can
 * never disagree about how long a Friday-to-Monday absence was.
 */
async function unpaidLeaveIn(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<"organizations">,
  memberId: Id<"members">,
  from: string,
  to: string,
  opts: { weekendDays: number[]; holidays: Set<string> },
): Promise<number> {
  const requests = (
    await ctx.db
      .query("leaveRequests")
      .withIndex("by_member", (q) => q.eq("memberId", memberId))
      .collect()
  ).filter((r) => r.status === "approved" && r.startDate <= to && r.endDate >= from);

  let days = 0;
  for (const r of requests) {
    const type = await ctx.db.get(r.leaveTypeId);
    if (!type || type.isPaid) continue;
    // Clip to the period: leave spanning a month boundary is split across runs,
    // so neither month double-counts it.
    const start = r.startDate < from ? from : r.startDate;
    const end = r.endDate > to ? to : r.endDate;
    days += countLeaveDays(start, end, {
      weekendDays: opts.weekendDays,
      holidays: opts.holidays,
      halfDay: r.halfDay !== undefined && start === end,
    });
  }
  return days;
}

/**
 * Overtime hours from attendance.
 *
 * Hours clocked beyond the standard day, per day, summed. Per-day rather than
 * per-month: four 10-hour days and one 2-hour day is 8 hours of overtime, not
 * zero, and a monthly comparison would erase it.
 */
async function overtimeHoursIn(
  ctx: QueryCtx | MutationCtx,
  memberId: Id<"members">,
  from: string,
  to: string,
  hoursPerDay: number,
): Promise<number> {
  const rows = (
    await ctx.db
      .query("attendance")
      .withIndex("by_member_date", (q) => q.eq("memberId", memberId))
      .collect()
  ).filter((r) => r.workDate >= from && r.workDate <= to && r.clockOutAt !== undefined);

  const byDay = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.workDate, (byDay.get(r.workDate) ?? 0) + workedMs(r, r.clockOutAt!));
  }

  let otHours = 0;
  for (const ms of byDay.values()) {
    const hours = ms / 3_600_000;
    if (hours > hoursPerDay) otHours += hours - hoursPerDay;
  }
  // Quarter-hour rounding: paying to seven decimal places is noise, and rounding
  // down to whole hours quietly takes money off people.
  return Math.round(otHours * 4) / 4;
}
