import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireOrgAdmin } from "./lib/guard";
import { workDate, workedMs, isMissedClockOut, parseHm, minutesIntoDay } from "./lib/time";

// The company admin dashboard's read side. Reactive, so the "who is in" board
// updates itself — that is the reason the stack is Convex (docs/PLAN.md).

/**
 * Today's board: every active employee with their current state.
 *
 * Deliberately returns one row per EMPLOYEE, not per attendance record, because
 * the question an admin actually has is "who isn't here?" — and that question is
 * unanswerable from a table of attendance rows, which by definition only contains
 * people who turned up.
 */
export const todayBoard = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const now = Date.now();
    const date = workDate(now, org.timezone);

    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((m) => m.isActive);

    const todays = await ctx.db
      .query("attendance")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).eq("workDate", date))
      .collect();

    // Who is legitimately away today. Without this, somebody on approved leave
    // shows up flagged exactly like a no-show, which is the fastest way for an
    // admin to stop trusting the board.
    const onLeave = new Map<string, string>();
    for (const l of await ctx.db
      .query("leaveRequests")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).lte("startDate", date))
      .collect()) {
      if (l.status === "approved" && l.endDate >= date) {
        const type = await ctx.db.get(l.leaveTypeId);
        onLeave.set(l.memberId, type?.name ?? "Leave");
      }
    }

    const isHoliday = await ctx.db
      .query("holidays")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).eq("date", date))
      .first();

    const byMember = new Map<string, typeof todays>();
    for (const r of todays) {
      const list = byMember.get(r.memberId) ?? [];
      list.push(r);
      byMember.set(r.memberId, list);
    }

    // Past the expected end, "hasn't clocked in" stops meaning "running late".
    const pastEnd = minutesIntoDay(now, org.timezone) > parseHm(org.expectedEnd);

    const rows = members.map((m) => {
      const records = byMember.get(m._id) ?? [];
      const open = records.find((r) => r.clockOutAt === undefined);
      const totalMs = records.reduce((sum, r) => sum + workedMs(r, now), 0);

      let state: "in" | "out" | "absent" | "missing_clock_out" | "on_leave";
      // Leave wins over absence, but not over a real clock-in: somebody who came
      // in anyway is in, and that is worth seeing.
      if (records.length === 0 && onLeave.has(m._id)) state = "on_leave";
      else if (records.length === 0) state = "absent";
      else if (open) {
        state = isMissedClockOut(open, now, org.timezone) ? "missing_clock_out" : "in";
      } else state = "out";

      return {
        memberId: m._id,
        fullName: m.fullName,
        email: m.email,
        state,
        isLate: records.some((r) => r.isLate),
        since: open?.clockInAt ?? null,
        totalMs,
        sessions: records.length,
        leaveType: onLeave.get(m._id) ?? null,
        // Anything an admin may need to look at: out of range, bad accuracy, or a
        // mock-location flag on either end of any session today.
        flagged: records.some(
          (r) =>
            r.clockIn.status !== "verified" ||
            (r.clockOut !== undefined && r.clockOut.status !== "verified"),
        ),
      };
    });

    return {
      workDate: date,
      timezone: org.timezone,
      serverNow: now,
      pastExpectedEnd: pastEnd,
      holidayName: isHoliday?.name ?? null,
      counts: {
        employees: rows.length,
        in: rows.filter((r) => r.state === "in").length,
        out: rows.filter((r) => r.state === "out").length,
        onLeave: rows.filter((r) => r.state === "on_leave").length,
        absent: rows.filter((r) => r.state === "absent").length,
        late: rows.filter((r) => r.isLate).length,
        missingClockOut: rows.filter((r) => r.state === "missing_clock_out").length,
        flagged: rows.filter((r) => r.flagged).length,
      },
      rows,
    };
  },
});

/**
 * Attendance rows for a date range. Backs the attendance table, the monthly
 * report and the CSV export — one query, because they are the same data with
 * different rendering.
 *
 * The range is capped: an unbounded export on a 100-employee org is how you
 * discover Convex read limits in front of a customer.
 */
export const attendanceRange = query({
  args: {
    orgId: v.id("organizations"),
    from: v.string(), // "YYYY-MM-DD", org-local, inclusive
    to: v.string(), // inclusive
    memberId: v.optional(v.id("members")),
  },
  handler: async (ctx, { orgId, from, to, memberId }) => {
    await requireOrgAdmin(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const now = Date.now();

    if (from > to) throw new Error("Start date is after end date");
    if (daysBetween(from, to) > 92) {
      throw new Error("Pick a range of 92 days or less (one quarter)");
    }

    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_org_date", (q) =>
        q.eq("orgId", orgId).gte("workDate", from).lte("workDate", to),
      )
      .collect();

    const names = new Map(
      (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((m) => [m._id, m]),
    );

    return rows
      .filter((r) => !memberId || r.memberId === memberId)
      .map((r) => {
        const m = names.get(r.memberId);
        return {
          _id: r._id,
          memberId: r.memberId,
          fullName: m?.fullName ?? "(removed)",
          email: m?.email ?? "",
          workDate: r.workDate,
          clockInAt: r.clockInAt,
          clockOutAt: r.clockOutAt ?? null,
          workedMs: workedMs(r, now),
          isLate: r.isLate,
          missedClockOut: isMissedClockOut(r, now, org.timezone),
          clockInStatus: r.clockIn.status,
          clockOutStatus: r.clockOut?.status ?? null,
          clockInDistanceM: r.clockIn.distanceM ?? null,
          clockOutDistanceM: r.clockOut?.distanceM ?? null,
          clockInLat: r.clockIn.lat ?? null,
          clockInLng: r.clockIn.lng ?? null,
          clockOutLat: r.clockOut?.lat ?? null,
          clockOutLng: r.clockOut?.lng ?? null,
          device: r.device ?? null,
        };
      })
      .sort((a, b) => (a.workDate === b.workDate ? a.clockInAt - b.clockInAt : a.workDate < b.workDate ? 1 : -1));
  },
});

/** Inclusive day count between two "YYYY-MM-DD" strings. */
function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error("Dates must be YYYY-MM-DD");
  return Math.round((b - a) / 86_400_000) + 1;
}
