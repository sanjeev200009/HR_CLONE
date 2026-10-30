import { query, mutation } from "./_generated/server";
import { claimMembership } from "./lib/guard";

/**
 * Who am I? Every active membership for the signed-in Clerk user, with its org.
 * Drives post-sign-in routing: employee -> clock screen, admin -> web dashboard.
 * Returns null when not signed in, [] when signed in but not yet claimed.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const id = await ctx.auth.getUserIdentity();
    if (!id) return null;

    const rows = await ctx.db
      .query("members")
      .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", id.subject))
      .collect();

    const out = [];
    for (const m of rows) {
      if (!m.isActive) continue;
      const org = await ctx.db.get(m.orgId);
      if (!org || org.status !== "active") continue;
      out.push({
        memberId: m._id,
        orgId: m.orgId,
        orgName: org.name,
        timezone: org.timezone,
        role: m.role,
        fullName: m.fullName,
        workplaceId: m.workplaceId,
      });
    }
    return out;
  },
});

/** Bind this Clerk user to the member row(s) an admin pre-created for their email. */
export const claim = mutation({
  args: {},
  handler: async (ctx) => claimMembership(ctx),
});
