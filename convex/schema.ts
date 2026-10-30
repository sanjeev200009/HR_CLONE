import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Clerk owns identity. There is no `users` table and no authTables — the only link
// to a human is `clerkUserId`, the Clerk subject from ctx.auth.getUserIdentity().
// Convex has no RLS. Tenant isolation is enforced in convex/lib/guard.ts and
// NOTHING may query these tables without going through it.

const verifyStatus = v.union(
  v.literal("verified"),
  v.literal("out_of_range"),
  v.literal("low_accuracy"),
  v.literal("no_location"),
  v.literal("suspect_mocked"), // Android reported the fix as mock-generated
);

// One side of a clock action. Everything here is a claim by the device except
// distanceM and status, which the mutation computes.
const fix = v.object({
  lat: v.optional(v.number()),
  lng: v.optional(v.number()),
  accuracyM: v.optional(v.number()),
  distanceM: v.optional(v.number()),
  isMocked: v.optional(v.boolean()), // expo-location `mocked`, Android only
  integrity: v.optional(v.string()), // Play Integrity verdict, if checked
  status: verifyStatus,
});

export default defineSchema({
  plans: defineTable({
    name: v.string(),
    monthlyPrice: v.number(),
    annualPrice: v.number(),
    employeeLimit: v.number(),
    isActive: v.boolean(),
  }),

  organizations: defineTable({
    name: v.string(),
    companyEmail: v.optional(v.string()),
    companyAddress: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("suspended")),
    planId: v.optional(v.id("plans")),
    // Subscription lives on the org: one org has exactly one current subscription,
    // so a separate table would be a join for nothing. Payment history waits for a
    // real payment gateway (PRD §11 defers it until after customer validation).
    billingPeriod: v.optional(v.union(v.literal("monthly"), v.literal("annual"), v.literal("trial"))),
    expiresAt: v.optional(v.number()), // a cron suspends the org past this
    // attendance rules: four knobs per org
    timezone: v.string(), // "Asia/Colombo"
    expectedStart: v.string(), // "09:00"
    expectedEnd: v.string(), // "17:30"
    graceMinutes: v.number(),
    minHours: v.number(),
    maxAccuracyM: v.number(), // reject GPS fixes worse than this
  }),

  // platform owner, kept separate so super admin is never implicit
  platformAdmins: defineTable({ clerkUserId: v.string() }).index("by_clerk_user", [
    "clerkUserId",
  ]),

  departments: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
  }).index("by_org", ["orgId"]),

  workplaces: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    address: v.optional(v.string()),
    lat: v.number(),
    lng: v.number(),
    radiusM: v.number(),
    isActive: v.boolean(),
  }).index("by_org", ["orgId"]),

  members: defineTable({
    orgId: v.id("organizations"),
    // Admin creates the row with an email only; clerkUserId is filled on the
    // employee's first sign-in by claimMembership. See convex/lib/guard.ts.
    email: v.string(), // lowercased
    clerkUserId: v.optional(v.string()),
    fullName: v.string(),
    phone: v.optional(v.string()),
    role: v.union(v.literal("employee"), v.literal("admin")),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
    isActive: v.boolean(),
  })
    .index("by_clerk_user", ["clerkUserId"]) // login -> which orgs am I in
    .index("by_email", ["email"]) // claim on first sign-in
    .index("by_org", ["orgId"])
    .index("by_org_clerk_user", ["orgId", "clerkUserId"]),

  attendance: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    workplaceId: v.optional(v.id("workplaces")),
    workDate: v.string(), // org-local "YYYY-MM-DD", computed server side
    clockInAt: v.number(), // Date.now() on the server; device clock is untrusted
    clockOutAt: v.optional(v.number()),
    clockIn: fix,
    clockOut: v.optional(fix),
    isLate: v.boolean(),
    device: v.optional(v.string()), // "android 14 / app 1.2.0"
    reminderSentAt: v.optional(v.number()), // so the sweep never double-notifies
  })
    // ponytail: no partial unique index in Convex — the clockIn mutation reads
    // by_member_open first and rejects a second open session. Convex mutations are
    // serializable, so that read-then-write is safe without a lock.
    .index("by_member_open", ["memberId", "clockOutAt"])
    .index("by_org_date", ["orgId", "workDate"])
    .index("by_member_date", ["memberId", "workDate"]),

  corrections: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    attendanceId: v.id("attendance"),
    requestedChange: v.any(),
    reason: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    reviewedBy: v.optional(v.id("members")),
    reviewedAt: v.optional(v.number()),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_member", ["memberId"]),

  // Expo push tokens, for the one notification we send: missed clock-out.
  pushTokens: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    token: v.string(),
    platform: v.union(v.literal("android"), v.literal("ios")),
  })
    .index("by_member", ["memberId"])
    .index("by_token", ["token"]),

  auditLogs: defineTable({
    orgId: v.optional(v.id("organizations")),
    actorClerkUserId: v.optional(v.string()),
    action: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }).index("by_org", ["orgId"]),
});
