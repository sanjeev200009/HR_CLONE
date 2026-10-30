import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

// Convex has no RLS. Tenant isolation is enforced in convex/lib/guard.ts and
// NOTHING may query these tables without going through it.

const verifyStatus = v.union(
  v.literal("verified"),
  v.literal("out_of_range"),
  v.literal("low_accuracy"),
  v.literal("no_location"),
);

export default defineSchema({
  ...authTables, // users, authAccounts, authSessions… from @convex-dev/auth

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
    // attendance rules: four knobs per org
    timezone: v.string(), // "Asia/Colombo"
    expectedStart: v.string(), // "09:00"
    expectedEnd: v.string(), // "17:30"
    graceMinutes: v.number(),
    minHours: v.number(),
    maxAccuracyM: v.number(), // reject GPS fixes worse than this
  }),

  // platform owner, kept separate so super admin is never implicit
  platformAdmins: defineTable({ userId: v.id("users") }).index("by_user", ["userId"]),

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
    userId: v.id("users"),
    fullName: v.string(),
    phone: v.optional(v.string()),
    role: v.union(v.literal("employee"), v.literal("admin")),
    departmentId: v.optional(v.id("departments")),
    workplaceId: v.optional(v.id("workplaces")),
    isActive: v.boolean(),
  })
    .index("by_user", ["userId"]) // login -> which orgs am I in
    .index("by_org", ["orgId"])
    .index("by_org_user", ["orgId", "userId"]),

  attendance: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    workplaceId: v.optional(v.id("workplaces")),
    workDate: v.string(), // org-local "YYYY-MM-DD", computed server side
    clockInAt: v.number(), // Date.now() on the server; device clock is untrusted
    clockOutAt: v.optional(v.number()),
    clockIn: v.object({
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      accuracyM: v.optional(v.number()),
      distanceM: v.optional(v.number()),
      status: verifyStatus,
    }),
    clockOut: v.optional(
      v.object({
        lat: v.optional(v.number()),
        lng: v.optional(v.number()),
        accuracyM: v.optional(v.number()),
        distanceM: v.optional(v.number()),
        status: verifyStatus,
      }),
    ),
    isLate: v.boolean(),
    device: v.optional(v.string()),
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

  auditLogs: defineTable({
    orgId: v.optional(v.id("organizations")),
    actorUserId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }).index("by_org", ["orgId"]),
});
