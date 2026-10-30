import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireOrgAdmin } from "./lib/guard";

// Workplace registration. A workplace is a point plus a radius; that is the whole
// geofence. No PostGIS, no maps API — see docs/PLAN.md.

export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    // Employees need to see their own workplace on the clock screen, so this is
    // requireMember, not requireOrgAdmin. It exposes office coordinates to staff,
    // which is fine: they are told to stand in them.
    await requireMember(ctx, orgId);
    return await ctx.db
      .query("workplaces")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    address: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    radiusM: v.number(),
  },
  handler: async (ctx, args) => {
    const admin = await requireOrgAdmin(ctx, args.orgId);
    validate(args);
    const id = await ctx.db.insert("workplaces", { ...args, isActive: true });
    await ctx.db.insert("auditLogs", {
      orgId: args.orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "workplace.create",
      entityType: "workplaces",
      entityId: id,
      metadata: { name: args.name, radiusM: args.radiusM },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    orgId: v.id("organizations"),
    workplaceId: v.id("workplaces"),
    name: v.optional(v.string()),
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    radiusM: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, workplaceId, ...patch }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const existing = await ctx.db.get(workplaceId);
    // Belt and braces: the guard proves the CALLER's org, this proves the ROW's.
    // Without it an admin of org A could patch org B's workplace by id.
    if (!existing || existing.orgId !== orgId) throw new Error("Workplace not found");

    validate({ ...existing, ...patch });
    await ctx.db.patch(workplaceId, patch);
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "workplace.update",
      entityType: "workplaces",
      entityId: workplaceId,
      metadata: patch,
    });
  },
});

/**
 * Reject coordinates and radii that cannot be right.
 *
 * The radius floor matters: a 5m geofence looks strict but consumer GPS is rarely
 * better than 10-20m even outdoors, so it would reject honest employees all day.
 * The ceiling stops "50km radius" from being used to disable verification quietly.
 */
function validate(w: { lat: number; lng: number; radiusM: number }) {
  if (w.lat < -90 || w.lat > 90) throw new Error("Latitude must be between -90 and 90");
  if (w.lng < -180 || w.lng > 180) throw new Error("Longitude must be between -180 and 180");
  if (!Number.isFinite(w.radiusM) || w.radiusM < 20 || w.radiusM > 5000) {
    throw new Error("Radius must be between 20m and 5000m");
  }
}
