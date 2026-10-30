import { mutation, query, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireOrgAdmin } from "./lib/guard";

// Employee and department management, all admin-only.
//
// There is no "create a login" here. An admin creates a member row keyed on an
// email; the person gets their own Clerk account and members.claim binds the two.
// That means this file never touches credentials — which is the point of using
// Clerk at all.

export const list = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);

    const members = await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();

    const deps = new Map(
      (
        await ctx.db
          .query("departments")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((d) => [d._id, d.name]),
    );
    const wps = new Map(
      (
        await ctx.db
          .query("workplaces")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((w) => [w._id, w.name]),
    );

    return members.map((m) => ({
      _id: m._id,
      email: m.email,
      fullName: m.fullName,
      phone: m.phone ?? null,
      role: m.role,
      isActive: m.isActive,
      // The admin's cue that someone was invited but has never signed in.
      hasSignedIn: m.clerkUserId !== undefined,
      department: m.departmentId ? deps.get(m.departmentId) ?? null : null,
      departmentId: m.departmentId ?? null,
      workplace: m.workplaceId ? wps.get(m.workplaceId) ?? null : null,
      workplaceId: m.workplaceId ?? null,
    }));
  },
});

export const invite = mutation({
  args: {
    orgId: v.id("organizations"),
    email: v.string(),
    fullName: v.string(),
    phone: v.optional(v.string()),
    role: v.union(v.literal("employee"), v.literal("admin")),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
  },
  handler: async (ctx, args) => {
    const admin = await requireOrgAdmin(ctx, args.orgId);
    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email address");

    // Email is the claim key, so a duplicate inside one org would make
    // claimMembership ambiguous. Across orgs it is fine (a consultant at two
    // companies), which is why this is scoped to the org.
    const clash = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    if (clash.some((m) => m.orgId === args.orgId)) {
      throw new Error("Someone with that email is already in this organization");
    }

    await enforceSeatLimit(ctx, args.orgId);
    await assertBelongs(ctx, args.orgId, args.departmentId, args.workplaceId);

    const id = await ctx.db.insert("members", {
      ...args,
      email,
      fullName: args.fullName.trim(),
      isActive: true,
    });
    await ctx.db.insert("auditLogs", {
      orgId: args.orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "member.invite",
      entityType: "members",
      entityId: id,
      metadata: { email, role: args.role },
    });
    return id;
  },
});

export const update = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    fullName: v.optional(v.string()),
    phone: v.optional(v.string()),
    role: v.optional(v.union(v.literal("employee"), v.literal("admin"))),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, memberId, ...patch }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const target = await ctx.db.get(memberId);
    if (!target || target.orgId !== orgId) throw new Error("Employee not found");

    // Do not let an org lock itself out of its own dashboard. Both paths matter:
    // demoting the last admin and deactivating the last admin are the same bug.
    const losingAdmin =
      (patch.role !== undefined && patch.role !== "admin" && target.role === "admin") ||
      (patch.isActive === false && target.role === "admin");
    if (losingAdmin) {
      const admins = (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).filter((m) => m.role === "admin" && m.isActive);
      if (admins.length <= 1) {
        throw new Error("This is the last active admin — promote someone else first");
      }
    }

    // Reactivating consumes a seat, so it has to be checked like an invite.
    if (patch.isActive === true && !target.isActive) await enforceSeatLimit(ctx, orgId);
    await assertBelongs(ctx, orgId, patch.departmentId, patch.workplaceId);

    await ctx.db.patch(memberId, patch);
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "member.update",
      entityType: "members",
      entityId: memberId,
      metadata: patch,
    });
  },
});

export const departments = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireOrgAdmin(ctx, orgId);
    return await ctx.db
      .query("departments")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const createDepartment = mutation({
  args: { orgId: v.id("organizations"), name: v.string() },
  handler: async (ctx, { orgId, name }) => {
    await requireOrgAdmin(ctx, orgId);
    return await ctx.db.insert("departments", { orgId, name: name.trim() });
  },
});

/** The plan's employee_limit, enforced on the paths that add a seat. */
async function enforceSeatLimit(ctx: MutationCtx, orgId: Id<"organizations">) {
  const org = await ctx.db.get(orgId);
  if (!org?.planId) return; // no plan assigned yet -> no limit to enforce
  const plan = await ctx.db.get(org.planId);
  if (!plan) return;

  const active = (
    await ctx.db
      .query("members")
      .withIndex("by_org", (q) => q.eq("orgId", orgId))
      .collect()
  ).filter((m) => m.isActive).length;

  if (active >= plan.employeeLimit) {
    throw new Error(
      `Your ${plan.name} plan allows ${plan.employeeLimit} employees. Upgrade to add more.`,
    );
  }
}

/**
 * A department or workplace id is supplied by the caller, so it must be proved to
 * belong to the caller's org. Otherwise an admin could attach their employee to
 * another company's workplace and geofence against someone else's office.
 */
async function assertBelongs(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
  departmentId?: Id<"departments">,
  workplaceId?: Id<"workplaces">,
) {
  if (departmentId) {
    const d = await ctx.db.get(departmentId);
    if (!d || d.orgId !== orgId) throw new Error("Department not found");
  }
  if (workplaceId) {
    const w = await ctx.db.get(workplaceId);
    if (!w || w.orgId !== orgId) throw new Error("Workplace not found");
  }
}
