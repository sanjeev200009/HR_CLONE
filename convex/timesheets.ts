import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireOrgAdmin } from "./lib/guard";
import { workDate, workedMs } from "./lib/time";
import { weekStart, datesBetween } from "./lib/leave";

// Weekly timesheets.
//
// A timesheet is NOT a second record of hours. The hours live in `attendance`;
// a timesheet row records only the weekly submission and its approval. Letting
// an employee type hours directly would hand them the one number the GPS
// verification exists to establish.
//
// So: hours are always derived, and the only thing submitted is agreement.

/** The week's attendance, day by day, plus the submission state. */
export const myWeek = query({
  args: { orgId: v.id("organizations"), weekOf: v.optional(v.string()) },
  handler: async (ctx, { orgId, weekOf }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const now = Date.now();
    const monday = weekStart(weekOf ?? workDate(now, org.timezone));
    const days = datesBetween(monday, addDays(monday, 6));

    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_member_date", (q) => q.eq("memberId", member._id))
      .collect();
    const inWeek = rows.filter((r) => r.workDate >= monday && r.workDate <= days[6]);

    // Approved leave shows on the timesheet so a week off does not read as a
    // week of zeroes the employee has to explain.
    const leave = (
      await ctx.db
        .query("leaveRequests")
        .withIndex("by_member", (q) => q.eq("memberId", member._id))
        .collect()
    ).filter((l) => l.status === "approved" && l.startDate <= days[6] && l.endDate >= monday);

    const holidays = new Set(
      (
        await ctx.db
          .query("holidays")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((h) => h.date),
    );

    const sheet = await ctx.db
      .query("timesheets")
      .withIndex("by_member_week", (q) => q.eq("memberId", member._id).eq("weekStart", monday))
      .unique();

    const byDay = days.map((date) => {
      const dayRows = inWeek.filter((r) => r.workDate === date);
      return {
        date,
        totalMs: dayRows.reduce((s, r) => s + workedMs(r, now), 0),
        sessions: dayRows.length,
        isLate: dayRows.some((r) => r.isLate),
        openSession: dayRows.some((r) => r.clockOutAt === undefined),
        flagged: dayRows.some(
          (r) =>
            r.clockIn.status !== "verified" ||
            (r.clockOut !== undefined && r.clockOut.status !== "verified"),
        ),
        onLeave: leave.some((l) => l.startDate <= date && l.endDate >= date),
        isHoliday: holidays.has(date),
      };
    });

    return {
      weekStart: monday,
      weekEnd: days[6],
      timezone: org.timezone,
      days: byDay,
      totalMs: byDay.reduce((s, d) => s + d.totalMs, 0),
      status: sheet?.status ?? "draft",
      submittedAt: sheet?.submittedAt ?? null,
      reviewNote: sheet?.reviewNote ?? null,
      // An open session means the week is not finished being recorded yet.
      canSubmit:
        (sheet === null || sheet.status === "draft" || sheet.status === "rejected") &&
        !byDay.some((d) => d.openSession),
    };
  },
});

export const submit = mutation({
  args: { orgId: v.id("organizations"), weekOf: v.string(), note: v.optional(v.string()) },
  handler: async (ctx, { orgId, weekOf, note }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const monday = weekStart(weekOf);
    const now = Date.now();
    const days = datesBetween(monday, addDays(monday, 6));

    // You cannot sign off a week that has not happened.
    if (monday > workDate(now, org.timezone)) throw new Error("That week hasn't started yet");

    const rows = (
      await ctx.db
        .query("attendance")
        .withIndex("by_member_date", (q) => q.eq("memberId", member._id))
        .collect()
    ).filter((r) => r.workDate >= monday && r.workDate <= days[6]);

    if (rows.some((r) => r.clockOutAt === undefined)) {
      throw new Error("Clock out of your open session before submitting the week");
    }

    const existing = await ctx.db
      .query("timesheets")
      .withIndex("by_member_week", (q) => q.eq("memberId", member._id).eq("weekStart", monday))
      .unique();
    if (existing && (existing.status === "submitted" || existing.status === "approved")) {
      throw new Error(`That week is already ${existing.status}`);
    }

    // Snapshot the total at submission. If attendance is corrected afterwards the
    // approver can see that the number moved, instead of silently approving
    // different hours from the ones the employee agreed to.
    const totalMs = rows.reduce((s, r) => s + workedMs(r, now), 0);

    const patch = {
      status: "submitted" as const,
      totalMs,
      note: note?.trim() || undefined,
      submittedAt: now,
      reviewedBy: undefined,
      reviewedAt: undefined,
      reviewNote: undefined,
    };

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("timesheets", {
      orgId,
      memberId: member._id,
      weekStart: monday,
      ...patch,
    });
  },
});

/** Admin queue. */
export const list = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("submitted"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireOrgAdmin(ctx, orgId);
    const rows = await ctx.db
      .query("timesheets")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status ?? "submitted"))
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(async (t) => {
        const m = await ctx.db.get(t.memberId);
        // Recompute now, so a correction approved after submission is visible as
        // a difference rather than hidden behind the snapshot.
        const live = (
          await ctx.db
            .query("attendance")
            .withIndex("by_member_date", (q) => q.eq("memberId", t.memberId))
            .collect()
        )
          .filter((r) => r.workDate >= t.weekStart && r.workDate <= addDays(t.weekStart, 6))
          .reduce((s, r) => s + workedMs(r, Date.now()), 0);

        return {
          ...t,
          fullName: m?.fullName ?? "(removed)",
          email: m?.email ?? "",
          liveTotalMs: live,
          changedSinceSubmission: live !== t.totalMs,
        };
      }),
    );
  },
});

export const review = mutation({
  args: {
    orgId: v.id("organizations"),
    timesheetId: v.id("timesheets"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, timesheetId, approve, note }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const t = await ctx.db.get(timesheetId);
    if (!t || t.orgId !== orgId) throw new Error("Timesheet not found");
    if (t.status !== "submitted") throw new Error(`That timesheet is ${t.status}`);
    if (t.memberId === admin._id) {
      throw new Error("You cannot approve your own timesheet");
    }
    if (!approve && !note?.trim()) {
      // A rejection without a reason just gets resubmitted unchanged.
      throw new Error("Say why you're rejecting it, so they know what to fix");
    }

    await ctx.db.patch(timesheetId, {
      status: approve ? "approved" : "rejected",
      reviewedBy: admin._id,
      reviewedAt: Date.now(),
      reviewNote: note?.trim() || undefined,
    });

    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: approve ? "timesheet.approved" : "timesheet.rejected",
      entityType: "timesheets",
      entityId: timesheetId,
      metadata: { weekStart: t.weekStart, totalMs: t.totalMs },
    });
  },
});

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
