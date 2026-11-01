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
    // 0=Sunday .. 6=Saturday. Leave day counting skips these. Sri Lanka is [0,6];
    // a Gulf customer would be [5,6], which is exactly why it is not hardcoded.
    weekendDays: v.optional(v.array(v.number())),
    leaveYearStartMonth: v.optional(v.number()), // 1-12, default January
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
    // Directory + profile. Optional so every existing row stays valid.
    jobTitle: v.optional(v.string()),
    managerId: v.optional(v.id("members")), // reporting line, for approvals
    joinedOn: v.optional(v.string()), // "YYYY-MM-DD"; drives leave pro-rating
    about: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
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

  // ---------------------------------------------------------------------------
  // Leave. The largest module after attendance, and the one with real arithmetic:
  // entitlement, accrual, carry-forward and a day count that has to agree with
  // the customer's weekend and public holidays.
  // ---------------------------------------------------------------------------

  leaveTypes: defineTable({
    orgId: v.id("organizations"),
    name: v.string(), // "Annual", "Casual", "Medical" — Sri Lankan norms differ by org
    daysPerYear: v.number(),
    isPaid: v.boolean(),
    carryForwardMax: v.number(), // 0 = use it or lose it
    // Accrue monthly rather than granting the year up front, so a new hire in
    // November does not get 14 days on day one.
    accrualMode: v.union(v.literal("upfront"), v.literal("monthly")),
    requiresApproval: v.boolean(),
    allowHalfDay: v.boolean(),
    isActive: v.boolean(),
  }).index("by_org", ["orgId"]),

  leaveRequests: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    leaveTypeId: v.id("leaveTypes"),
    startDate: v.string(), // "YYYY-MM-DD", org-local
    endDate: v.string(),
    // Only meaningful for a single-day request; validated in the mutation.
    halfDay: v.optional(v.union(v.literal("morning"), v.literal("afternoon"))),
    days: v.number(), // computed server-side, never trusted from the client
    reason: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
      v.literal("cancelled"),
    ),
    reviewedBy: v.optional(v.id("members")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
  })
    .index("by_org_status", ["orgId", "status"])
    .index("by_member", ["memberId"])
    .index("by_member_start", ["memberId", "startDate"])
    .index("by_org_start", ["orgId", "startDate"]),

  // Balances are a MATERIALISED cache, not the source of truth. The truth is the
  // approved requests; recompute() rebuilds this from them. Storing it keeps the
  // employee's balance screen one read instead of a full scan of their history.
  leaveBalances: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    leaveTypeId: v.id("leaveTypes"),
    year: v.number(),
    entitledDays: v.number(),
    carriedDays: v.number(),
    usedDays: v.number(),
    pendingDays: v.number(),
  })
    .index("by_member_year", ["memberId", "year"])
    .index("by_member_type_year", ["memberId", "leaveTypeId", "year"])
    .index("by_org_year", ["orgId", "year"]),

  // Public holidays. A leave request spanning one must not consume a leave day,
  // and attendance on one must not count as late.
  holidays: defineTable({
    orgId: v.id("organizations"),
    date: v.string(), // "YYYY-MM-DD"
    name: v.string(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_date", ["orgId", "date"]),

  // ---------------------------------------------------------------------------
  // Timesheets. Derived from attendance, not a second source of truth — a
  // timesheet row records only the weekly SUBMISSION and its approval.
  // ---------------------------------------------------------------------------

  timesheets: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    weekStart: v.string(), // Monday, "YYYY-MM-DD", org-local
    status: v.union(
      v.literal("draft"),
      v.literal("submitted"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    totalMs: v.number(), // snapshot at submission, so later edits are visible
    note: v.optional(v.string()),
    submittedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("members")),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
  })
    .index("by_member_week", ["memberId", "weekStart"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_org_week", ["orgId", "weekStart"]),

  // ---------------------------------------------------------------------------
  // Coworker feedback. Visibility is enforced in the query, not the UI.
  // ---------------------------------------------------------------------------

  feedback: defineTable({
    orgId: v.id("organizations"),
    fromMemberId: v.id("members"),
    toMemberId: v.id("members"),
    body: v.string(),
    // private  -> only the recipient and their manager
    // manager  -> only the recipient's manager and admins (upward feedback)
    // team     -> anyone in the org can read it on the profile
    visibility: v.union(v.literal("private"), v.literal("manager"), v.literal("team")),
    isAnonymous: v.boolean(),
  })
    .index("by_to", ["toMemberId"])
    .index("by_from", ["fromMemberId"])
    .index("by_org", ["orgId"]),

  // ---------------------------------------------------------------------------
  // Payroll. Money is held in CENTS as integers throughout — see
  // convex/lib/payroll.ts for why, and for the order of operations.
  //
  // Statutory rates are configuration, not constants. Sri Lankan EPF (8% employee
  // / 12% employer) and ETF (3% employer) are seeded as defaults, but PAYE bands
  // start EMPTY: with none configured no PAYE is deducted and the payslip says so,
  // because inventing a tax number is worse than not computing one.
  // ---------------------------------------------------------------------------

  payrollConfig: defineTable({
    orgId: v.id("organizations"),
    currency: v.string(), // "LKR"
    epfEmployeePct: v.number(),
    epfEmployerPct: v.number(),
    etfEmployerPct: v.number(),
    payeBands: v.array(v.object({ upToCents: v.number(), percent: v.number() })),
    otMultiplier: v.number(),
    workingDaysPerMonth: v.number(),
    hoursPerDay: v.number(),
  }).index("by_org", ["orgId"]),

  salaries: defineTable({
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    basicCents: v.number(),
    allowances: v.array(
      v.object({
        label: v.string(),
        amountCents: v.number(),
        // A travel or meal allowance is normally NOT EPF-liable. Charging EPF on
        // it takes money from both sides that neither owes.
        epfLiable: v.boolean(),
      }),
    ),
    effectiveFrom: v.string(), // "YYYY-MM-DD"
  })
    .index("by_member", ["memberId"])
    .index("by_org", ["orgId"]),

  payRuns: defineTable({
    orgId: v.id("organizations"),
    period: v.string(), // "YYYY-MM"
    // A finalised run is immutable. Correcting it means a new run, so the
    // original payslip an employee was shown never changes under them.
    status: v.union(v.literal("draft"), v.literal("finalised")),
    totals: v.object({
      headcount: v.number(),
      grossCents: v.number(),
      epfEmployeeCents: v.number(),
      epfEmployerCents: v.number(),
      etfEmployerCents: v.number(),
      payeCents: v.number(),
      otherDeductionsCents: v.number(),
      netCents: v.number(),
      employerCostCents: v.number(),
    }),
    finalisedAt: v.optional(v.number()),
    finalisedBy: v.optional(v.id("members")),
  })
    .index("by_org_period", ["orgId", "period"])
    .index("by_org", ["orgId"]),

  payslips: defineTable({
    orgId: v.id("organizations"),
    payRunId: v.id("payRuns"),
    memberId: v.id("members"),
    period: v.string(),
    basicCents: v.number(),
    allowancesCents: v.number(),
    unpaidLeaveDays: v.number(),
    unpaidLeaveDeductionCents: v.number(),
    otHours: v.number(),
    otPayCents: v.number(),
    grossCents: v.number(),
    epfEmployeeCents: v.number(),
    epfEmployerCents: v.number(),
    etfEmployerCents: v.number(),
    payeCents: v.number(),
    payeCalculated: v.boolean(),
    otherDeductionsCents: v.number(),
    totalDeductionsCents: v.number(),
    netCents: v.number(),
    employerCostCents: v.number(),
  })
    .index("by_run", ["payRunId"])
    .index("by_member", ["memberId"])
    .index("by_member_period", ["memberId", "period"]),

  // Queued outbound email. A row, not a direct send, so a failed provider call
  // retries instead of silently losing "your leave was approved".
  emailQueue: defineTable({
    orgId: v.optional(v.id("organizations")),
    to: v.string(),
    subject: v.string(),
    body: v.string(), // plain text; the action wraps it
    kind: v.string(), // "leave.requested" | "leave.reviewed" | ...
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    sentAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_org", ["orgId"]),

  auditLogs: defineTable({
    orgId: v.optional(v.id("organizations")),
    actorClerkUserId: v.optional(v.string()),
    action: v.string(),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    metadata: v.optional(v.any()),
  }).index("by_org", ["orgId"]),
});
