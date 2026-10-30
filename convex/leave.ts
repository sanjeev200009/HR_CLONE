import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, requireOrgAdmin } from "./lib/guard";
import { workDate } from "./lib/time";
import {
  countLeaveDays,
  entitlementDays,
  monthsEmployedInYear,
  carryForward,
  availableDays,
  overlaps,
  leaveYearOf,
  DEFAULT_WEEKEND,
} from "./lib/leave";

// Leave management.
//
// The arithmetic is in convex/lib/leave.ts and tested there. This file is the
// access control, the validation, and the balance bookkeeping.
//
// Invariant worth stating up front: leaveRequests is the source of truth and
// leaveBalances is a cache of it. Anything that changes a request's status must
// call recompute() for that member+type+year, and recompute() must be derivable
// from requests alone. If those drift, trust the requests.

// ---------------------------------------------------------------------------
// Leave types (admin)
// ---------------------------------------------------------------------------

export const types = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    // Employees need the list to file a request, so member-level, not admin.
    await requireMember(ctx, orgId);
    return await ctx.db
      .query("leaveTypes")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const upsertType = mutation({
  args: {
    orgId: v.id("organizations"),
    leaveTypeId: v.optional(v.id("leaveTypes")),
    name: v.string(),
    daysPerYear: v.number(),
    isPaid: v.boolean(),
    carryForwardMax: v.number(),
    accrualMode: v.union(v.literal("upfront"), v.literal("monthly")),
    requiresApproval: v.boolean(),
    allowHalfDay: v.boolean(),
    isActive: v.boolean(),
  },
  handler: async (ctx, { orgId, leaveTypeId, ...type }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    if (!type.name.trim()) throw new Error("Give the leave type a name");
    if (type.daysPerYear < 0 || type.daysPerYear > 365) {
      throw new Error("Days per year must be between 0 and 365");
    }
    if (type.carryForwardMax < 0 || type.carryForwardMax > type.daysPerYear) {
      throw new Error("Carry-forward cannot exceed the yearly entitlement");
    }

    if (leaveTypeId) {
      const existing = await ctx.db.get(leaveTypeId);
      if (!existing || existing.orgId !== orgId) throw new Error("Leave type not found");
      await ctx.db.patch(leaveTypeId, type);
      await log(ctx, orgId, admin, "leaveType.update", "leaveTypes", leaveTypeId, type);
      return leaveTypeId;
    }
    const id = await ctx.db.insert("leaveTypes", { orgId, ...type });
    await log(ctx, orgId, admin, "leaveType.create", "leaveTypes", id, { name: type.name });
    return id;
  },
});

// ---------------------------------------------------------------------------
// Public holidays (admin). They matter because they must not consume leave days.
// ---------------------------------------------------------------------------

export const holidays = query({
  args: { orgId: v.id("organizations"), year: v.optional(v.number()) },
  handler: async (ctx, { orgId, year }) => {
    await requireMember(ctx, orgId);
    const rows = await ctx.db
      .query("holidays")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
    const filtered = year ? rows.filter((h) => h.date.startsWith(String(year))) : rows;
    return filtered.sort((a, b) => (a.date < b.date ? -1 : 1));
  },
});

export const addHoliday = mutation({
  args: { orgId: v.id("organizations"), date: v.string(), name: v.string() },
  handler: async (ctx, { orgId, date, name }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must be YYYY-MM-DD");
    if (!name.trim()) throw new Error("Give the holiday a name");

    const clash = await ctx.db
      .query("holidays")
      .withIndex("by_org_date", (q) => q.eq("orgId", orgId).eq("date", date))
      .first();
    if (clash) throw new Error("That date is already a holiday");

    const id = await ctx.db.insert("holidays", { orgId, date, name: name.trim() });
    await log(ctx, orgId, admin, "holiday.add", "holidays", id, { date, name });
    return id;
  },
});

export const removeHoliday = mutation({
  args: { orgId: v.id("organizations"), holidayId: v.id("holidays") },
  handler: async (ctx, { orgId, holidayId }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const h = await ctx.db.get(holidayId);
    if (!h || h.orgId !== orgId) throw new Error("Holiday not found");
    await ctx.db.delete(holidayId);
    await log(ctx, orgId, admin, "holiday.remove", "holidays", holidayId, { date: h.date });
  },
});

// ---------------------------------------------------------------------------
// Requesting leave (employee)
// ---------------------------------------------------------------------------

export const request = mutation({
  args: {
    orgId: v.id("organizations"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(),
    endDate: v.string(),
    halfDay: v.optional(v.union(v.literal("morning"), v.literal("afternoon"))),
    reason: v.string(),
  },
  handler: async (ctx, { orgId, leaveTypeId, startDate, endDate, halfDay, reason }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    const type = await ctx.db.get(leaveTypeId);
    if (!type || type.orgId !== orgId) throw new Error("Leave type not found");
    if (!type.isActive) throw new Error(`${type.name} leave is no longer available`);
    if (!reason.trim()) throw new Error("Give a reason for the leave");

    if (halfDay) {
      if (!type.allowHalfDay) throw new Error(`${type.name} leave cannot be taken as a half day`);
      if (startDate !== endDate) throw new Error("A half day must be a single date");
    }

    // Overlap check against this member's own live requests. Without it someone
    // can book the same week twice and the balance goes negative.
    const mine = await ctx.db
      .query("leaveRequests")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .collect();
    const live = mine.filter((r) => r.status === "pending" || r.status === "approved");
    if (live.some((r) => overlaps(startDate, endDate, r.startDate, r.endDate))) {
      throw new Error("You already have leave booked or requested in that range");
    }

    const holidaySet = await holidaySetFor(ctx, orgId);
    const days = countLeaveDays(startDate, endDate, {
      weekendDays: org.weekendDays ?? DEFAULT_WEEKEND,
      holidays: holidaySet,
      halfDay: halfDay !== undefined,
    });
    if (days === 0) {
      // Everything in the range is a weekend or a holiday: there is nothing to
      // deduct, so the request would be meaningless rather than free.
      throw new Error("That range is all weekend or public holidays — no leave needed");
    }

    const year = leaveYearOf(startDate, org.leaveYearStartMonth ?? 1);
    const balance = await ensureBalance(ctx, orgId, member, leaveTypeId, year);
    const left = availableDays(balance);
    if (days > left) {
      throw new Error(
        `You have ${left} day${left === 1 ? "" : "s"} of ${type.name} leave left and asked for ${days}`,
      );
    }

    const id = await ctx.db.insert("leaveRequests", {
      orgId,
      memberId: member._id,
      leaveTypeId,
      startDate,
      endDate,
      halfDay,
      days,
      reason: reason.trim(),
      // A type that needs no approval is granted immediately, which is how
      // unpaid/short-notice categories are usually configured.
      status: type.requiresApproval ? "pending" : "approved",
    });

    await recompute(ctx, member._id, leaveTypeId, year, org);
    return id;
  },
});

/** An employee may withdraw their own request while it is still pending. */
export const cancel = mutation({
  args: { orgId: v.id("organizations"), requestId: v.id("leaveRequests") },
  handler: async (ctx, { orgId, requestId }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    const r = await ctx.db.get(requestId);
    if (!r || r.orgId !== orgId || r.memberId !== member._id) {
      throw new Error("Leave request not found");
    }
    if (r.status === "cancelled") return;
    if (r.status === "rejected") throw new Error("That request was already rejected");

    // Cancelling approved leave that has already started would rewrite history.
    // Future approved leave can be given back; past leave needs an admin.
    const today = workDate(Date.now(), org.timezone);
    if (r.status === "approved" && r.startDate <= today) {
      throw new Error("That leave has already started — ask your admin to amend it");
    }

    await ctx.db.patch(requestId, { status: "cancelled" });
    await recompute(ctx, member._id, r.leaveTypeId, leaveYearOf(r.startDate, org.leaveYearStartMonth ?? 1), org);
  },
});

export const myRequests = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const member = await requireMember(ctx, orgId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_member", (q) => q.eq("memberId", member._id))
      .order("desc")
      .take(100);

    const types = new Map(
      (
        await ctx.db
          .query("leaveTypes")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((t) => [t._id, t.name]),
    );
    return rows.map((r) => ({ ...r, typeName: types.get(r.leaveTypeId) ?? "(removed)" }));
  },
});

/** The employee's balance card: entitled, carried, used, pending, left. */
export const myBalances = query({
  args: { orgId: v.id("organizations"), year: v.optional(v.number()) },
  handler: async (ctx, { orgId, year }) => {
    const member = await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    const y = year ?? leaveYearOf(workDate(Date.now(), org.timezone), org.leaveYearStartMonth ?? 1);

    const types = (
      await ctx.db
        .query("leaveTypes")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((t) => t.isActive);

    const out = [];
    for (const type of types) {
      // A read-only projection: the balance row may not exist yet for a new
      // hire, so compute it rather than writing from a query.
      const stored = await ctx.db
        .query("leaveBalances")
        .withIndex("by_member_type_year", (q) =>
          q.eq("memberId", member._id).eq("leaveTypeId", type._id).eq("year", y),
        )
        .unique();

      const projected = stored ?? (await projectBalance(ctx, member, type, y, org));
      out.push({
        leaveTypeId: type._id,
        typeName: type.name,
        isPaid: type.isPaid,
        allowHalfDay: type.allowHalfDay,
        year: y,
        entitledDays: projected.entitledDays,
        carriedDays: projected.carriedDays,
        usedDays: projected.usedDays,
        pendingDays: projected.pendingDays,
        availableDays: availableDays(projected),
      });
    }
    return out;
  },
});

// ---------------------------------------------------------------------------
// Approving leave (admin)
// ---------------------------------------------------------------------------

export const pending = query({
  args: {
    orgId: v.id("organizations"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
        v.literal("cancelled"),
      ),
    ),
  },
  handler: async (ctx, { orgId, status }) => {
    await requireOrgAdmin(ctx, orgId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_org_status", (q) => q.eq("orgId", orgId).eq("status", status ?? "pending"))
      .order("desc")
      .take(200);

    const types = new Map(
      (
        await ctx.db
          .query("leaveTypes")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((t) => [t._id, t.name]),
    );

    return await Promise.all(
      rows.map(async (r) => {
        const m = await ctx.db.get(r.memberId);
        return {
          ...r,
          typeName: types.get(r.leaveTypeId) ?? "(removed)",
          fullName: m?.fullName ?? "(removed)",
          email: m?.email ?? "",
        };
      }),
    );
  },
});

export const review = mutation({
  args: {
    orgId: v.id("organizations"),
    requestId: v.id("leaveRequests"),
    approve: v.boolean(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, requestId, approve, note }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    const r = await ctx.db.get(requestId);
    if (!r || r.orgId !== orgId) throw new Error("Leave request not found");
    if (r.status !== "pending") throw new Error(`That request is already ${r.status}`);

    // An admin cannot sign off their own leave. Gallery HR's model has one admin
    // per small company, so this is a real constraint rather than a formality —
    // it is why requests can also be reviewed by a manager below.
    if (r.memberId === admin._id) {
      throw new Error("You cannot approve your own leave — another admin must review it");
    }

    if (approve) {
      // Re-check the balance at approval time. Entitlement accrues monthly and
      // other requests may have been approved since this one was filed.
      const year = leaveYearOf(r.startDate, org.leaveYearStartMonth ?? 1);
      const member = (await ctx.db.get(r.memberId))!;
      const balance = await ensureBalance(ctx, orgId, member, r.leaveTypeId, year);
      // pendingDays still includes this request, so add it back before comparing.
      const freeIgnoringThis = availableDays(balance) + r.days;
      if (r.days > freeIgnoringThis) {
        throw new Error("Approving this would push them past their entitlement");
      }
    }

    await ctx.db.patch(requestId, {
      status: approve ? "approved" : "rejected",
      reviewedBy: admin._id,
      reviewedAt: Date.now(),
      reviewNote: note?.trim() || undefined,
    });

    await recompute(
      ctx,
      r.memberId,
      r.leaveTypeId,
      leaveYearOf(r.startDate, org.leaveYearStartMonth ?? 1),
      org,
    );
    await log(ctx, orgId, admin, approve ? "leave.approved" : "leave.rejected", "leaveRequests", requestId, {
      days: r.days,
      range: `${r.startDate}..${r.endDate}`,
    });
  },
});

/** Who is off, between two dates. Backs the admin leave calendar. */
export const calendar = query({
  args: { orgId: v.id("organizations"), from: v.string(), to: v.string() },
  handler: async (ctx, { orgId, from, to }) => {
    await requireOrgAdmin(ctx, orgId);
    const rows = await ctx.db
      .query("leaveRequests")
      .withIndex("by_org_start", (q) => q.eq("orgId", orgId).lte("startDate", to))
      .collect();

    const names = new Map(
      (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((m) => [m._id, m.fullName]),
    );
    const types = new Map(
      (
        await ctx.db
          .query("leaveTypes")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((t) => [t._id, t.name]),
    );

    return rows
      .filter((r) => r.status === "approved" && r.endDate >= from)
      .map((r) => ({
        _id: r._id,
        fullName: names.get(r.memberId) ?? "(removed)",
        typeName: types.get(r.leaveTypeId) ?? "",
        startDate: r.startDate,
        endDate: r.endDate,
        days: r.days,
        halfDay: r.halfDay ?? null,
      }))
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  },
});

// ---------------------------------------------------------------------------
// Balance bookkeeping
// ---------------------------------------------------------------------------

async function holidaySetFor(ctx: QueryCtx | MutationCtx, orgId: Id<"organizations">) {
  const rows = await ctx.db
    .query("holidays")
    .withIndex("by_org", (q) => q.eq("orgId", orgId))
    .collect();
  return new Set(rows.map((h) => h.date));
}

/**
 * Derive a balance from the requests, without writing. Used by queries and as
 * the body of recompute().
 */
async function projectBalance(
  ctx: QueryCtx | MutationCtx,
  member: Doc<"members">,
  type: Doc<"leaveTypes">,
  year: number,
  org: Doc<"organizations">,
) {
  const startMonth = org.leaveYearStartMonth ?? 1;
  const today = workDate(Date.now(), org.timezone);
  const currentYear = leaveYearOf(today, startMonth);

  // How far through the leave year we are. A past year is complete; a future
  // year has not started accruing.
  const asOfMonth =
    year < currentYear ? 12 : year > currentYear ? 0 : monthsInto(today, startMonth);

  const entitledDays = entitlementDays(type, {
    asOfMonth,
    monthsEmployedThisYear: monthsEmployedInYear(member.joinedOn, year, asOfMonth),
  });

  const all = await ctx.db
    .query("leaveRequests")
    .withIndex("by_member", (q) => q.eq("memberId", member._id))
    .collect();
  const forYear = all.filter(
    (r) => r.leaveTypeId === type._id && leaveYearOf(r.startDate, startMonth) === year,
  );

  const usedDays = forYear
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + r.days, 0);
  const pendingDays = forYear
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + r.days, 0);

  // Carry-forward needs last year's closing position, which is itself derived.
  const prev = await ctx.db
    .query("leaveBalances")
    .withIndex("by_member_type_year", (q) =>
      q.eq("memberId", member._id).eq("leaveTypeId", type._id).eq("year", year - 1),
    )
    .unique();
  const carriedDays = carryForward(prev, type.carryForwardMax);

  return { entitledDays, carriedDays, usedDays, pendingDays };
}

/** Read-or-create the stored balance row. */
async function ensureBalance(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  member: Doc<"members">,
  leaveTypeId: Id<"leaveTypes">,
  year: number,
) {
  const existing = await ctx.db
    .query("leaveBalances")
    .withIndex("by_member_type_year", (q) =>
      q.eq("memberId", member._id).eq("leaveTypeId", leaveTypeId).eq("year", year),
    )
    .unique();
  if (existing) return existing;

  const org = (await ctx.db.get(orgId))!;
  const type = (await ctx.db.get(leaveTypeId))!;
  const projected = await projectBalance(ctx, member, type, year, org);
  const id = await ctx.db.insert("leaveBalances", {
    orgId,
    memberId: member._id,
    leaveTypeId,
    year,
    ...projected,
  });
  return (await ctx.db.get(id))!;
}

/**
 * Rebuild the cached balance from the requests. Called after every status change.
 * Idempotent by construction: it derives, it does not increment.
 */
async function recompute(
  ctx: MutationCtx,
  memberId: Id<"members">,
  leaveTypeId: Id<"leaveTypes">,
  year: number,
  org: Doc<"organizations">,
) {
  const member = await ctx.db.get(memberId);
  const type = await ctx.db.get(leaveTypeId);
  if (!member || !type) return;

  const projected = await projectBalance(ctx, member, type, year, org);
  const existing = await ctx.db
    .query("leaveBalances")
    .withIndex("by_member_type_year", (q) =>
      q.eq("memberId", memberId).eq("leaveTypeId", leaveTypeId).eq("year", year),
    )
    .unique();

  if (existing) await ctx.db.patch(existing._id, projected);
  else
    await ctx.db.insert("leaveBalances", {
      orgId: member.orgId,
      memberId,
      leaveTypeId,
      year,
      ...projected,
    });
}

/** Months begun in the current leave year, 1-12. */
function monthsInto(today: string, startMonth: number): number {
  const month = Number(today.slice(5, 7));
  return ((month - startMonth + 12) % 12) + 1;
}

async function log(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  admin: Doc<"members">,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: unknown,
) {
  await ctx.db.insert("auditLogs", {
    orgId,
    actorClerkUserId: admin.clerkUserId,
    action,
    entityType,
    entityId,
    metadata,
  });
}
