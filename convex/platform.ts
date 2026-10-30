import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requirePlatformAdmin } from "./lib/guard";

// SaaS super admin (PRD §4C).
//
// THE RULE FOR THIS FILE: the platform owner gets organizations, plans, seat counts
// and subscription state. Never attendance rows, never coordinates, never a named
// employee's movements. PRD §4C says administrative access must be controlled,
// justified and audited, and the cheapest way to honour that is for the queries
// that would expose location to not exist here at all.
//
// Every export below is requirePlatformAdmin and returns aggregates only.

export const orgs = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const orgs = await ctx.db.query("organizations").collect();
    const plans = new Map((await ctx.db.query("plans").collect()).map((p) => [p._id, p]));

    return await Promise.all(
      orgs.map(async (o) => {
        const members = await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", o._id))
          .collect();
        const plan = o.planId ? plans.get(o.planId) : undefined;
        const active = members.filter((m) => m.isActive).length;
        return {
          _id: o._id,
          name: o.name,
          companyEmail: o.companyEmail ?? null,
          status: o.status,
          timezone: o.timezone,
          planName: plan?.name ?? null,
          employeeLimit: plan?.employeeLimit ?? null,
          employees: active,
          // Counts, not people. No names leave this function.
          seatsLeft: plan ? Math.max(0, plan.employeeLimit - active) : null,
          overLimit: plan ? active > plan.employeeLimit : false,
          neverSignedIn: members.filter((m) => m.clerkUserId === undefined).length,
          billingPeriod: o.billingPeriod ?? null,
          expiresAt: o.expiresAt ?? null,
          createdAt: o._creationTime,
        };
      }),
    );
  },
});

export const createOrg = mutation({
  args: {
    name: v.string(),
    companyEmail: v.optional(v.string()),
    companyAddress: v.optional(v.string()),
    timezone: v.string(),
    planId: v.optional(v.id("plans")),
    billingPeriod: v.optional(
      v.union(v.literal("monthly"), v.literal("annual"), v.literal("trial")),
    ),
    expiresAt: v.optional(v.number()),
    adminEmail: v.string(),
    adminName: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformAdmin(ctx);

    // Reject a timezone the runtime does not know, or every work date for this org
    // is silently wrong forever.
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: args.timezone }).format(new Date());
    } catch {
      throw new Error(`Unknown timezone "${args.timezone}" — use an IANA name like Asia/Colombo`);
    }

    const email = args.adminEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid admin email");

    const orgId = await ctx.db.insert("organizations", {
      name: args.name.trim(),
      companyEmail: args.companyEmail,
      companyAddress: args.companyAddress,
      status: "active",
      planId: args.planId,
      billingPeriod: args.billingPeriod ?? "trial",
      expiresAt: args.expiresAt,
      timezone: args.timezone,
      // Defaults a customer can change; picked so a new org works before anyone
      // touches settings.
      expectedStart: "09:00",
      expectedEnd: "17:30",
      graceMinutes: 15,
      minHours: 8,
      maxAccuracyM: 100,
    });

    // An org with no admin is unusable, so onboarding always seats one. They claim
    // it by signing in with this email (convex/lib/guard.ts claimMembership).
    const memberId = await ctx.db.insert("members", {
      orgId,
      email,
      fullName: args.adminName.trim(),
      role: "admin",
      isActive: true,
    });

    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: actor,
      action: "platform.orgCreated",
      entityType: "organizations",
      entityId: orgId,
      metadata: { name: args.name, adminEmail: email },
    });

    return { orgId, memberId };
  },
});

export const setOrgStatus = mutation({
  args: {
    orgId: v.id("organizations"),
    status: v.union(v.literal("active"), v.literal("suspended")),
  },
  handler: async (ctx, { orgId, status }) => {
    const actor = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");

    await ctx.db.patch(orgId, { status });
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: actor,
      action: status === "active" ? "platform.orgReactivated" : "platform.orgSuspended",
      entityType: "organizations",
      entityId: orgId,
    });
  },
});

export const setOrgPlan = mutation({
  args: {
    orgId: v.id("organizations"),
    planId: v.id("plans"),
    billingPeriod: v.union(
      v.literal("monthly"),
      v.literal("annual"),
      v.literal("trial"),
    ),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, planId, billingPeriod, expiresAt }) => {
    const actor = await requirePlatformAdmin(ctx);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organization not found");
    const plan = await ctx.db.get(planId);
    if (!plan) throw new Error("Plan not found");

    // Downgrading below current headcount is allowed but must be visible: the
    // alternative is silently blocking the customer's next invite with no
    // explanation. Over-limit orgs show up in the orgs query as overLimit.
    await ctx.db.patch(orgId, { planId, billingPeriod, expiresAt });
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: actor,
      action: "platform.planChanged",
      entityType: "organizations",
      entityId: orgId,
      metadata: { plan: plan.name, billingPeriod, expiresAt: expiresAt ?? null },
    });
  },
});

export const plans = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    return await ctx.db.query("plans").collect();
  },
});

export const upsertPlan = mutation({
  args: {
    planId: v.optional(v.id("plans")),
    name: v.string(),
    monthlyPrice: v.number(),
    annualPrice: v.number(),
    employeeLimit: v.number(),
    isActive: v.boolean(),
  },
  handler: async (ctx, { planId, ...plan }) => {
    await requirePlatformAdmin(ctx);
    if (plan.employeeLimit < 1) throw new Error("Employee limit must be at least 1");
    if (plan.monthlyPrice < 0 || plan.annualPrice < 0) throw new Error("Price cannot be negative");
    if (planId) {
      await ctx.db.patch(planId, plan);
      return planId;
    }
    return await ctx.db.insert("plans", plan);
  },
});

/**
 * Platform health. Aggregates only — the attendance count is a number, never rows.
 */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformAdmin(ctx);
    const orgs = await ctx.db.query("organizations").collect();
    const members = await ctx.db.query("members").collect();
    return {
      orgs: orgs.length,
      activeOrgs: orgs.filter((o) => o.status === "active").length,
      suspendedOrgs: orgs.filter((o) => o.status === "suspended").length,
      members: members.length,
      activeMembers: members.filter((m) => m.isActive).length,
      neverSignedIn: members.filter((m) => m.clerkUserId === undefined).length,
    };
  },
});
