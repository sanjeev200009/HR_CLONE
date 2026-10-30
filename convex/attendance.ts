import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, distanceM } from "./lib/guard";
import { isLate, workDate, workedMs, isMissedClockOut } from "./lib/time";

// The attendance core. Everything the employee app can do.
//
// The device reports a location; it does NOT report a verdict. distance, status and
// the timestamp are all decided here, because a client that can set its own
// verification status is not a verification system.

const fixArg = v.object({
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  accuracyM: v.optional(v.number()),
  isMocked: v.optional(v.boolean()),
  integrity: v.optional(v.string()),
});

type FixArg = {
  lat?: number;
  lng?: number;
  accuracyM?: number;
  isMocked?: boolean;
  integrity?: string;
};

type VerifyStatus =
  | "verified"
  | "out_of_range"
  | "low_accuracy"
  | "no_location"
  | "suspect_mocked";

/**
 * Turn a device-reported fix into a stored, server-decided verdict.
 *
 * Order matters and is deliberate:
 *   mocked      -> never trust it, whatever the coordinates say
 *   no location -> permission denied or GPS off
 *   low accuracy-> a 2km-accurate fix "inside" a 100m radius proves nothing
 *   distance    -> only now does the geofence mean anything
 *
 * GPS does not prove presence (PRD §5). This records what was claimed and how far
 * it can be trusted; it does not pretend to be proof.
 */
function verdict(
  fix: FixArg,
  workplace: Doc<"workplaces"> | null,
  maxAccuracyM: number,
) {
  const base = {
    lat: fix.lat,
    lng: fix.lng,
    accuracyM: fix.accuracyM,
    isMocked: fix.isMocked,
    integrity: fix.integrity,
  };

  if (fix.isMocked) return { ...base, status: "suspect_mocked" as VerifyStatus };
  if (fix.lat === undefined || fix.lng === undefined) {
    return { ...base, status: "no_location" as VerifyStatus };
  }
  if (fix.accuracyM !== undefined && fix.accuracyM > maxAccuracyM) {
    return { ...base, status: "low_accuracy" as VerifyStatus };
  }
  if (!workplace) {
    // No workplace assigned: we can store the fix but cannot verify it against
    // anything. Not the employee's fault, so it is not "out_of_range".
    return { ...base, status: "no_location" as VerifyStatus };
  }

  const d = distanceM(fix.lat, fix.lng, workplace.lat, workplace.lng);
  return {
    ...base,
    distanceM: Math.round(d),
    status: (d <= workplace.radiusM ? "verified" : "out_of_range") as VerifyStatus,
  };
}

/** The caller's single open (clocked-in, not yet out) record, if any. */
async function openRecord(ctx: QueryCtx | MutationCtx, memberId: Id<"members">) {
  return await ctx.db
    .query("attendance")
    .withIndex("by_member_open", (q) =>
      q.eq("memberId", memberId).eq("clockOutAt", undefined),
    )
    .unique();
}

export const clockIn = mutation({
  args: { orgId: v.id("organizations"), fix: fixArg, device: v.optional(v.string()) },
  handler: async (ctx, { orgId, fix, device }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    // Reject a second open session. Convex mutations are serializable, so this
    // read-then-write needs no lock (see the index comment in schema.ts).
    if (await openRecord(ctx, member._id)) {
      throw new Error("You are already clocked in. Clock out first.");
    }

    const at = Date.now(); // authoritative; the device clock is never used
    const workplace = member.workplaceId ? await ctx.db.get(member.workplaceId) : null;
    const clockInFix = verdict(fix, workplace, org.maxAccuracyM);

    const id = await ctx.db.insert("attendance", {
      orgId,
      memberId: member._id,
      workplaceId: member.workplaceId,
      workDate: workDate(at, org.timezone),
      clockInAt: at,
      clockIn: clockInFix,
      isLate: isLate(at, org),
      device,
    });

    await ctx.db.insert("auditLogs", {
      orgId,
      action: "attendance.clockIn",
      entityType: "attendance",
      entityId: id,
      metadata: { status: clockInFix.status },
    });

    return await ctx.db.get(id);
  },
});

export const clockOut = mutation({
  args: { orgId: v.id("organizations"), fix: fixArg },
  handler: async (ctx, { orgId, fix }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    const open = await openRecord(ctx, member._id);
    if (!open) throw new Error("You are not clocked in.");

    const at = Date.now();
    const workplace = open.workplaceId ? await ctx.db.get(open.workplaceId) : null;

    await ctx.db.patch(open._id, {
      clockOutAt: at,
      clockOut: verdict(fix, workplace, org.maxAccuracyM),
    });

    await ctx.db.insert("auditLogs", {
      orgId,
      action: "attendance.clockOut",
      entityType: "attendance",
      entityId: open._id,
    });

    return await ctx.db.get(open._id);
  },
});

/**
 * Everything the clock screen needs, in one reactive query: am I in or out, since
 * when, how long today, and is the workplace check happy.
 */
export const today = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const now = Date.now();
    const date = workDate(now, org.timezone);

    const records = await ctx.db
      .query("attendance")
      .withIndex("by_member_date", (q) =>
        q.eq("memberId", member._id).eq("workDate", date),
      )
      .collect();

    const open = records.find((r) => r.clockOutAt === undefined) ?? null;

    // PRD §7 allows several sessions in a day, so today's total is the sum.
    const totalMs = records.reduce((sum, r) => sum + workedMs(r, now), 0);

    const workplace = member.workplaceId ? await ctx.db.get(member.workplaceId) : null;

    return {
      serverNow: now, // the screen's clock follows the server, not the device
      workDate: date,
      timezone: org.timezone,
      isClockedIn: open !== null,
      since: open?.clockInAt ?? null,
      lastStatus: open?.clockIn.status ?? records.at(-1)?.clockOut?.status ?? null,
      totalMs,
      sessions: records.length,
      isLate: records.some((r) => r.isLate),
      expectedStart: org.expectedStart,
      expectedEnd: org.expectedEnd,
      minHours: org.minHours,
      maxAccuracyM: org.maxAccuracyM,
      workplace: workplace
        ? { name: workplace.name, lat: workplace.lat, lng: workplace.lng, radiusM: workplace.radiusM }
        : null,
    };
  },
});

/** The employee's own history, newest first. Capped so the list stays cheap. */
export const myHistory = query({
  args: { orgId: v.id("organizations"), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const now = Date.now();

    const rows = await ctx.db
      .query("attendance")
      .withIndex("by_member_date", (q) => q.eq("memberId", member._id))
      .order("desc")
      .take(Math.min(limit ?? 60, 200));

    return rows.map((r) => ({
      _id: r._id,
      workDate: r.workDate,
      clockInAt: r.clockInAt,
      clockOutAt: r.clockOutAt ?? null,
      workedMs: workedMs(r, now),
      isLate: r.isLate,
      missedClockOut: isMissedClockOut(r, now, org.timezone),
      clockInStatus: r.clockIn.status,
      clockOutStatus: r.clockOut?.status ?? null,
    }));
  },
});
