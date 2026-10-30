import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// The whole tenant boundary. Convex has no RLS, so every query/mutation that
// touches org data starts with one of these. If a function skips them, it is a bug.
// Identity comes from Clerk: identity.subject is the Clerk user id.

type Ctx = QueryCtx | MutationCtx;

async function clerkUserId(ctx: Ctx) {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.subject;
}

/** Caller's active membership in this org, or throw. Use for employee actions. */
export async function requireMember(ctx: Ctx, orgId: Id<"organizations">) {
  const uid = await clerkUserId(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_clerk_user", (q) => q.eq("orgId", orgId).eq("clerkUserId", uid))
    .unique();
  if (!member || !member.isActive) throw new Error("Not a member of this organization");
  const org = await ctx.db.get(orgId);
  if (!org || org.status !== "active") throw new Error("Organization is suspended");
  return member;
}

/** Same, but the membership must be an admin. Use for all dashboard reads/writes. */
export async function requireOrgAdmin(ctx: Ctx, orgId: Id<"organizations">) {
  const member = await requireMember(ctx, orgId);
  if (member.role !== "admin") throw new Error("Admin only");
  return member;
}

/** Platform owner. Grants org/plan/usage access only — never attendance or location. */
export async function requirePlatformAdmin(ctx: Ctx) {
  const uid = await clerkUserId(ctx);
  const row = await ctx.db
    .query("platformAdmins")
    .withIndex("by_clerk_user", (q) => q.eq("clerkUserId", uid))
    .unique();
  if (!row) throw new Error("Platform admin only");
  return uid;
}

/**
 * Bind the signed-in Clerk user to the member row an admin pre-created for their
 * email. Called once, on first sign-in, from a mutation.
 *
 * SECURITY: the email must be verified by Clerk. Without that check anyone could
 * sign up as someone@customer.lk and claim that company's membership. This is the
 * one place in the app where an unauthenticated-ish identity gains tenant access,
 * so it does not get simplified.
 */
export async function claimMembership(ctx: MutationCtx) {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  if (!id.emailVerified) throw new Error("Verify your email address first");
  const email = (id.email ?? "").toLowerCase();
  if (!email) throw new Error("No email on this account");

  const claimed: Id<"members">[] = [];
  const rows = await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const row of rows) {
    if (row.clerkUserId === undefined) {
      await ctx.db.patch(row._id, { clerkUserId: id.subject });
      await ctx.db.insert("auditLogs", {
        orgId: row.orgId,
        actorClerkUserId: id.subject,
        action: "membership.claimed",
        entityType: "members",
        entityId: row._id,
      });
      claimed.push(row._id);
    }
  }
  return claimed;
}

/** Metres between two points. Office scale; no PostGIS, no maps API. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}
