import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Dev seed. internalMutation, so it is NOT callable from the app — only via
// `npx convex run seed:dev '{"email":"you@example.com"}'`.
// Creates one plan, one org with Colombo attendance rules, one workplace, and an
// admin member row for the given email. clerkUserId is left unset on purpose:
// that is exactly the state members.claim exists to resolve on first sign-in.
export const dev = internalMutation({
  args: { email: v.string(), fullName: v.optional(v.string()) },
  handler: async (ctx, { email, fullName }) => {
    const existing = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email.toLowerCase()))
      .first();
    if (existing) return { already: true, orgId: existing.orgId, memberId: existing._id };

    const planId = await ctx.db.insert("plans", {
      name: "Starter",
      monthlyPrice: 1000,
      annualPrice: 10000,
      employeeLimit: 10,
      isActive: true,
    });

    const orgId = await ctx.db.insert("organizations", {
      name: "Career141 (dev)",
      status: "active",
      planId,
      timezone: "Asia/Colombo",
      expectedStart: "09:00",
      expectedEnd: "17:30",
      graceMinutes: 15,
      minHours: 8,
      maxAccuracyM: 100,
    });

    // Colombo Fort, as a placeholder until a real office is registered.
    const workplaceId = await ctx.db.insert("workplaces", {
      orgId,
      name: "Main Office",
      address: "Colombo, Sri Lanka",
      lat: 6.9271,
      lng: 79.8612,
      radiusM: 100,
      isActive: true,
    });

    const memberId = await ctx.db.insert("members", {
      orgId,
      email: email.toLowerCase(),
      fullName: fullName ?? "Dev Admin",
      role: "admin",
      workplaceId,
      isActive: true,
    });

    return { already: false, orgId, workplaceId, memberId };
  },
});

/**
 * Grant platform-owner access.
 *
 * Takes a Clerk user id rather than an email because platformAdmins is keyed on
 * the Clerk subject, and Convex cannot look a user up in Clerk without the secret
 * key. Sign in to the app once, then find your id in the Clerk dashboard under
 * Users (it looks like user_2abc...), or run `npx clerk users list`.
 *
 *   npx convex run seed:platformAdmin '{"clerkUserId":"user_..."}'
 */
export const platformAdmin = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const existing = await ctx.db
      .query("platformAdmins")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", clerkUserId))
      .unique();
    if (existing) return { already: true, id: existing._id };
    return { already: false, id: await ctx.db.insert("platformAdmins", { clerkUserId }) };
  },
});
