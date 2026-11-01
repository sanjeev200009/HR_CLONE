import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

// Two scheduled jobs. Both are things that must happen with nobody logged in.

/**
 * Suspend organizations whose subscription has lapsed.
 *
 * Suspension is reversible and blocks access via requireMember (which checks
 * org.status), so a customer who pays late loses access, not data. Nothing here
 * deletes anything — PRD §11 wants expiry handling plus reactivation, and a
 * destructive expiry job would make reactivation meaningless.
 */
export const expireSubscriptions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const lapsed = (await ctx.db.query("organizations").collect()).filter(
      (o) => o.status === "active" && o.expiresAt !== undefined && o.expiresAt < now,
    );

    for (const org of lapsed) {
      await ctx.db.patch(org._id, { status: "suspended" });
      await ctx.db.insert("auditLogs", {
        orgId: org._id,
        action: "platform.orgSuspendedForExpiry",
        entityType: "organizations",
        entityId: org._id,
        metadata: { expiresAt: org.expiresAt },
      });
    }
    return { suspended: lapsed.length };
  },
});

const crons = cronJobs();

// Hourly, because "an hour after the working day ends" is local time and the orgs
// are in different zones. push.dueReminders does the per-org clock check.
crons.hourly(
  "missed clock-out reminders",
  { minuteUTC: 5 },
  internal.push.sweepReminders,
);

// Daily is enough: a subscription that lapsed at 00:30 is caught at 01:00 UTC.
crons.cron("expire lapsed subscriptions", "0 1 * * *", internal.crons.expireSubscriptions);

// Email is queued by mutations and sent here. Every 2 minutes, because "your
// leave was approved" arriving an hour late is the same as not arriving.
crons.interval("send queued email", { minutes: 2 }, internal.email.drain);

export default crons;
