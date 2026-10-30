import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireOrgAdmin } from "./lib/guard";

// Attendance corrections (PRD §4, §7).
//
// This is the only path by which a stored attendance time can change, and it is
// two-party by design: the employee asks, an admin approves. Nothing here lets
// someone edit their own hours, because that is the one thing an attendance system
// cannot allow.

const requestedChange = v.object({
  clockInAt: v.optional(v.number()),
  clockOutAt: v.optional(v.number()),
});

export const request = mutation({
  args: {
    orgId: v.id("organizations"),
    attendanceId: v.id("attendance"),
    requestedChange,
    reason: v.string(),
  },
  handler: async (ctx, { orgId, attendanceId, requestedChange, reason }) => {
    const member = await requireMember(ctx, orgId);

    const record = await ctx.db.get(attendanceId);
    // Must be this org's record AND this employee's own. Either check alone is a
    // hole: the first lets you edit a colleague's row, the second another company's.
    if (!record || record.orgId !== orgId || record.memberId !== member._id) {
      throw new Error("Attendance record not found");
    }
    if (!reason.trim()) throw new Error("Give a reason for the correction");
    if (requestedChange.clockInAt === undefined && requestedChange.clockOutAt === undefined) {
      throw new Error("Nothing to correct");
    }

    const inAt = requestedChange.clockInAt ?? record.clockInAt;
    const outAt = requestedChange.clockOutAt ?? record.clockOutAt;
    if (outAt !== undefined && outAt <= inAt) {
      throw new Error("Clock-out must be after clock-in");
    }
    // A request for a future time is either a typo or an attempt. Either way, no.
    if (inAt > Date.now() || (outAt !== undefined && outAt > Date.now())) {
      throw new Error("Correction times cannot be in the future");
    }

    const existing = await ctx.db
      .query("corrections")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();
    if (existing.some((c) => c.attendanceId === attendanceId && c.status === "pending")) {
      throw new Error("You already have a pending correction for that day");
    }

    return await ctx.db.insert("corrections", {
      orgId,
      memberId: member._id,
      attendanceId,
      requestedChange,
      reason: reason.trim(),
      status: "pending",
    });
  },
});

/** The employee's own correction requests. */
export const mine = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const member = await requireMember(ctx, orgId);
    return await ctx.db
      .query("corrections")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .order("desc")
      .take(50);
  },
});

/** Admin queue. Defaults to pending, which is the only view with work in it. */
export const list = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(
      v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireOrgAdmin(ctx, orgId);
    const rows = await ctx.db
      .query("corrections")
      .withIndex("by_org_status", (q) =>
        q.eq("orgId", orgId).eq("status", status ?? "pending"),
      )
      .order("desc")
      .take(200);

    return await Promise.all(
      rows.map(async (c) => {
        const member = await ctx.db.get(c.memberId);
        const record = await ctx.db.get(c.attendanceId);
        return {
          ...c,
          fullName: member?.fullName ?? "(removed)",
          workDate: record?.workDate ?? null,
          currentClockInAt: record?.clockInAt ?? null,
          currentClockOutAt: record?.clockOutAt ?? null,
        };
      }),
    );
  },
});

export const review = mutation({
  args: {
    orgId: v.id("organizations"),
    correctionId: v.id("corrections"),
    approve: v.boolean(),
  },
  handler: async (ctx, { orgId, correctionId, approve }) => {
    const admin = await requireOrgAdmin(ctx, orgId);

    const c = await ctx.db.get(correctionId);
    if (!c || c.orgId !== orgId) throw new Error("Correction not found");
    if (c.status !== "pending") throw new Error("That correction was already reviewed");

    if (approve) {
      const record = await ctx.db.get(c.attendanceId);
      if (!record) throw new Error("The attendance record no longer exists");

      const change = c.requestedChange as { clockInAt?: number; clockOutAt?: number };
      const patch: { clockInAt?: number; clockOutAt?: number } = {};
      if (change.clockInAt !== undefined) patch.clockInAt = change.clockInAt;
      if (change.clockOutAt !== undefined) patch.clockOutAt = change.clockOutAt;

      // Re-check the invariant at approval time: the record may have moved since
      // the request was raised.
      const inAt = patch.clockInAt ?? record.clockInAt;
      const outAt = patch.clockOutAt ?? record.clockOutAt;
      if (outAt !== undefined && outAt <= inAt) {
        throw new Error("Approving this would put clock-out before clock-in");
      }

      await ctx.db.patch(c.attendanceId, patch);

      // The corrected time was typed by a human, so the GPS verdict that went with
      // the original reading no longer describes it. Saying "verified" about a
      // hand-entered time would be a lie the audit log can't undo.
      await ctx.db.insert("auditLogs", {
        orgId,
        actorClerkUserId: admin.clerkUserId,
        action: "correction.approved",
        entityType: "attendance",
        entityId: c.attendanceId,
        metadata: {
          before: { clockInAt: record.clockInAt, clockOutAt: record.clockOutAt ?? null },
          after: { clockInAt: inAt, clockOutAt: outAt ?? null },
          reason: c.reason,
          correctionId,
        },
      });
    } else {
      await ctx.db.insert("auditLogs", {
        orgId,
        actorClerkUserId: admin.clerkUserId,
        action: "correction.rejected",
        entityType: "corrections",
        entityId: correctionId,
      });
    }

    await ctx.db.patch(correctionId, {
      status: approve ? "approved" : "rejected",
      reviewedBy: admin._id,
      reviewedAt: Date.now(),
    });
  },
});
