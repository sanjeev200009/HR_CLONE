import { QueryCtx, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";

// The whole tenant boundary. Convex has no RLS, so every query/mutation that
// touches org data starts with one of these. If a function skips them, it is a bug.

type Ctx = QueryCtx | MutationCtx;

async function userId(ctx: Ctx) {
  const id = await ctx.auth.getUserIdentity();
  if (!id) throw new Error("Not signed in");
  return id.subject as Id<"users">;
}

/** Caller's active membership in this org, or throw. Use for employee actions. */
export async function requireMember(ctx: Ctx, orgId: Id<"organizations">) {
  const uid = await userId(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_org_user", (q) => q.eq("orgId", orgId).eq("userId", uid))
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
  const uid = await userId(ctx);
  const row = await ctx.db
    .query("platformAdmins")
    .withIndex("by_user", (q) => q.eq("userId", uid))
    .unique();
  if (!row) throw new Error("Platform admin only");
  return uid;
}

/** Metres between two points. Office scale; no PostGIS, no maps API. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(r(lat2 - lat1) / 2) ** 2 +
    Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}
