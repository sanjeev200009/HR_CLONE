import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireOrgAdmin } from "./lib/guard";
import { parseHm } from "./lib/time";

// Org settings: the attendance rules and the working week.
//
// These existed in the schema from the first commit and had NO mutation to edit
// them — they were set once when the platform owner created the org and then
// frozen. PRD §4 lists "configure attendance rules" as an admin requirement, so
// this file is that gap closed.

export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    // Employees read these too: the clock screen shows the expected start and
    // the app explains why a fix was rejected for accuracy.
    await requireMember(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;
    return {
      name: org.name,
      companyEmail: org.companyEmail ?? null,
      companyAddress: org.companyAddress ?? null,
      timezone: org.timezone,
      expectedStart: org.expectedStart,
      expectedEnd: org.expectedEnd,
      graceMinutes: org.graceMinutes,
      minHours: org.minHours,
      maxAccuracyM: org.maxAccuracyM,
      weekendDays: org.weekendDays ?? [0, 6],
      leaveYearStartMonth: org.leaveYearStartMonth ?? 1,
    };
  },
});

export const save = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.optional(v.string()),
    companyEmail: v.optional(v.string()),
    companyAddress: v.optional(v.string()),
    timezone: v.optional(v.string()),
    expectedStart: v.optional(v.string()),
    expectedEnd: v.optional(v.string()),
    graceMinutes: v.optional(v.number()),
    minHours: v.optional(v.number()),
    maxAccuracyM: v.optional(v.number()),
    weekendDays: v.optional(v.array(v.number())),
    leaveYearStartMonth: v.optional(v.number()),
  },
  handler: async (ctx, { orgId, ...patch }) => {
    const admin = await requireOrgAdmin(ctx, orgId);
    const org = (await ctx.db.get(orgId))!;

    if (patch.name !== undefined && !patch.name.trim()) {
      throw new Error("The company name cannot be empty");
    }

    if (patch.timezone !== undefined) {
      // An unknown timezone would make every work date for this org silently
      // wrong, forever and retroactively.
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: patch.timezone }).format(new Date());
      } catch {
        throw new Error(
          `Unknown timezone "${patch.timezone}" — use an IANA name like Asia/Colombo`,
        );
      }
    }

    // parseHm throws on anything that is not HH:MM.
    const start = patch.expectedStart !== undefined ? parseHm(patch.expectedStart) : parseHm(org.expectedStart);
    const end = patch.expectedEnd !== undefined ? parseHm(patch.expectedEnd) : parseHm(org.expectedEnd);
    // Equal is allowed (a 24h operation); reversed is not, or lateness inverts.
    if (end < start) throw new Error("The day cannot end before it starts");

    if (patch.graceMinutes !== undefined) {
      if (patch.graceMinutes < 0 || patch.graceMinutes > 240) {
        throw new Error("Grace must be between 0 and 240 minutes");
      }
    }
    if (patch.minHours !== undefined) {
      if (patch.minHours < 0 || patch.minHours > 24) {
        throw new Error("Minimum hours must be between 0 and 24");
      }
    }
    if (patch.maxAccuracyM !== undefined) {
      // Below ~20m rejects honest employees (consumer GPS is 10-20m at best);
      // above 2km would accept a fix from the next town.
      if (patch.maxAccuracyM < 20 || patch.maxAccuracyM > 2000) {
        throw new Error("Location accuracy limit must be between 20m and 2000m");
      }
    }
    if (patch.weekendDays !== undefined) {
      const days = [...new Set(patch.weekendDays)].sort();
      if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
        throw new Error("Weekend days must be 0 (Sunday) to 6 (Saturday)");
      }
      if (days.length >= 7) throw new Error("The whole week cannot be the weekend");
      patch.weekendDays = days;
    }
    if (patch.leaveYearStartMonth !== undefined) {
      if (
        !Number.isInteger(patch.leaveYearStartMonth) ||
        patch.leaveYearStartMonth < 1 ||
        patch.leaveYearStartMonth > 12
      ) {
        throw new Error("The leave year must start in month 1-12");
      }
    }

    await ctx.db.patch(orgId, patch);
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "org.settingsSaved",
      entityType: "organizations",
      entityId: orgId,
      // Changing the weekend or the leave year changes historic leave arithmetic,
      // so the before/after is logged rather than just the new value.
      metadata: {
        before: {
          expectedStart: org.expectedStart,
          expectedEnd: org.expectedEnd,
          graceMinutes: org.graceMinutes,
          weekendDays: org.weekendDays ?? [0, 6],
          leaveYearStartMonth: org.leaveYearStartMonth ?? 1,
          timezone: org.timezone,
        },
        after: patch,
      },
    });
  },
});
