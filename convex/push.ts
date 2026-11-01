import { internalAction, internalMutation, internalQuery, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { requireMember } from "./lib/guard";
import { minutesIntoDay, parseHm, workDate } from "./lib/time";

// The one notification this product sends: "you never clocked out".
//
// Not a notification platform. No digests, no marketing, no "good morning".
// Every extra push is a reason for an employee to turn notifications off, which
// would cost us the only one that matters.

export const register = mutation({
  args: {
    orgId: v.id("organizations"),
    token: v.string(),
    platform: v.union(v.literal("android"), v.literal("ios")),
  },
  handler: async (ctx, { orgId, token, platform }) => {
    const member = await requireMember(ctx, orgId);

    // One row per token, not per member: a person may have two phones, and the
    // same phone may be handed to a new employee. Re-registering an existing
    // token re-points it at whoever is signed in now.
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (existing) {
      if (existing.memberId !== member._id || existing.orgId !== orgId) {
        await ctx.db.patch(existing._id, { memberId: member._id, orgId, platform });
      }
      return existing._id;
    }
    return await ctx.db.insert("pushTokens", { orgId, memberId: member._id, token, platform });
  },
});

/**
 * Find open sessions that deserve a reminder, across every active org.
 *
 * Crons fire on a UTC schedule but "an hour after the working day ends" is a
 * local-time idea, so this runs hourly and asks each org whether its own clock has
 * passed expectedEnd + 60min. One sweep, every timezone, no per-org scheduling.
 */
type DueReminder = { attendanceId: Id<"attendance">; tokens: string[]; orgName: string };

export const dueReminders = internalQuery({
  args: {},
  // Explicit return type: sweepReminders calls this from the same file.
  handler: async (ctx): Promise<DueReminder[]> => {
    const now = Date.now();
    const orgs = (await ctx.db.query("organizations").collect()).filter(
      (o) => o.status === "active",
    );

    const due: DueReminder[] = [];

    for (const org of orgs) {
      const localMin = minutesIntoDay(now, org.timezone);
      const target = parseHm(org.expectedEnd) + 60;
      // Hourly cron, so a 60-minute window fires exactly once per day per org.
      if (localMin < target || localMin >= target + 60) continue;

      const open = (
        await ctx.db
          .query("attendance")
          .withIndex("by_org_date", (q) =>
            q.eq("orgId", org._id).eq("workDate", workDate(now, org.timezone)),
          )
          .collect()
      ).filter((r) => r.clockOutAt === undefined && r.reminderSentAt === undefined);

      for (const record of open) {
        const tokens = await ctx.db
          .query("pushTokens")
          .withIndex("by_member", (q) => q.eq("memberId", record.memberId))
          .collect();
        if (tokens.length === 0) continue;
        due.push({
          attendanceId: record._id,
          tokens: tokens.map((t) => t.token),
          orgName: org.name,
        });
      }
    }
    return due;
  },
});

export const markReminded = internalMutation({
  args: { attendanceId: v.id("attendance") },
  handler: async (ctx, { attendanceId }) => {
    const record = await ctx.db.get(attendanceId);
    // Still open? If they clocked out while the push was in flight, leave it be.
    if (record && record.clockOutAt === undefined) {
      await ctx.db.patch(attendanceId, { reminderSentAt: Date.now() });
    }
  },
});

export const removeToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const row = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/**
 * Send the due reminders through Expo's push service.
 *
 * internalAction: it talks to the network, and nothing a client can call should be
 * able to trigger a push sweep. Marks each record only after Expo accepts it, so a
 * failed send retries on the next sweep instead of being lost.
 */
export const sweepReminders = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number }> => {
    const due: DueReminder[] = await ctx.runQuery(internal.push.dueReminders, {});
    if (due.length === 0) return { sent: 0 };

    let sent = 0;
    for (const item of due) {
      const messages = item.tokens.map((to) => ({
        to,
        title: "Did you forget to clock out?",
        body: `You are still clocked in at ${item.orgName}. Open AttendanceHR to clock out.`,
        priority: "high",
      }));

      try {
        const res = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(messages),
        });
        if (!res.ok) continue; // leave unmarked; next sweep retries

        const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
        const tickets = body.data ?? [];

        // Expo reports a dead token as DeviceNotRegistered. Dropping it keeps the
        // table from filling with tokens for uninstalled apps forever.
        tickets.forEach((t, i) => {
          if (t.details?.error === "DeviceNotRegistered") {
            void ctx.runMutation(internal.push.removeToken, { token: item.tokens[i] });
          }
        });

        if (tickets.some((t) => t.status === "ok")) {
          await ctx.runMutation(internal.push.markReminded, { attendanceId: item.attendanceId });
          sent += 1;
        }
      } catch {
        // Network blip. Deliberately swallowed: the next sweep picks it up, and a
        // thrown action would abandon every remaining reminder in this batch.
        continue;
      }
    }
    return { sent };
  },
});
