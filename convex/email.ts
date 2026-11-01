import { internalAction, internalMutation, internalQuery, MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Doc, Id } from "./_generated/dataModel";

// Outbound email.
//
// Mail is QUEUED to a table and sent by a cron, never sent inline from the
// mutation that caused it. Three reasons, all learned the hard way:
//
//   1. A Convex mutation cannot do network I/O at all, so an inline send is not
//      even possible from `leave.review`.
//   2. A provider outage must not fail the business action. Approving leave has
//      to succeed whether or not the email goes out.
//   3. A queue row is a retry and an audit trail. "Did they get told?" is a
//      question with an answer.
//
// With no RESEND_API_KEY set the queue still fills and the sender no-ops, so
// nothing breaks in development and nothing is silently dropped either — the
// rows sit as `pending` and say why.

/** Enqueue. Called from inside a mutation; never throws on a bad address. */
export async function enqueue(
  ctx: MutationCtx,
  mail: {
    orgId?: Id<"organizations">;
    to: string;
    subject: string;
    body: string;
    kind: string;
  },
) {
  const to = mail.to.trim().toLowerCase();
  // A member row with no usable email must not break an approval.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return null;

  return await ctx.db.insert("emailQueue", {
    orgId: mail.orgId,
    to,
    subject: mail.subject,
    body: mail.body,
    kind: mail.kind,
    status: "pending",
    attempts: 0,
  });
}

export const pending = internalQuery({
  args: {},
  // Explicit return type: drain() below calls this from the same file, and
  // without the annotation TypeScript cannot break the inference cycle.
  handler: async (ctx): Promise<Doc<"emailQueue">[]> => {
    const rows = await ctx.db
      .query("emailQueue")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(50);
    // Give up after 5 tries rather than hammering a dead provider forever.
    return rows.filter((r) => r.attempts < 5);
  },
});

export const markSent = internalMutation({
  args: { id: v.id("emailQueue") },
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "sent", sentAt: Date.now() });
  },
});

export const markFailed = internalMutation({
  args: { id: v.id("emailQueue"), error: v.string(), permanent: v.boolean() },
  handler: async (ctx, { id, error, permanent }) => {
    const row = await ctx.db.get(id);
    if (!row) return;
    const attempts = row.attempts + 1;
    await ctx.db.patch(id, {
      attempts,
      lastError: error.slice(0, 500),
      // Stop retrying a rejected address; keep retrying a network blip.
      status: permanent || attempts >= 5 ? "failed" : "pending",
    });
  },
});

/**
 * Drain the queue through Resend.
 *
 * Resend because it is one HTTP call with no SDK. Swapping provider means
 * changing this function and nothing else — the queue, the templates and every
 * caller stay as they are.
 */
export const drain = internalAction({
  args: {},
  handler: async (ctx): Promise<{ sent: number; skipped: number }> => {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    const rows: Doc<"emailQueue">[] = await ctx.runQuery(internal.email.pending, {});
    if (rows.length === 0) return { sent: 0, skipped: 0 };

    // Not configured: leave the rows pending and say so once, rather than
    // marking 50 rows failed for a missing environment variable.
    if (!key || !from) {
      console.warn(
        `email: ${rows.length} queued but RESEND_API_KEY / EMAIL_FROM are not set on this deployment`,
      );
      return { sent: 0, skipped: rows.length };
    }

    let sent = 0;
    for (const row of rows) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [row.to],
            subject: row.subject,
            text: row.body,
          }),
        });

        if (res.ok) {
          await ctx.runMutation(internal.email.markSent, { id: row._id });
          sent += 1;
        } else {
          const text = (await res.text()).slice(0, 400);
          // 4xx is our fault and will not fix itself; 5xx and 429 are worth retrying.
          const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
          await ctx.runMutation(internal.email.markFailed, {
            id: row._id,
            error: `${res.status} ${text}`,
            permanent,
          });
        }
      } catch (e) {
        await ctx.runMutation(internal.email.markFailed, {
          id: row._id,
          error: e instanceof Error ? e.message : String(e),
          permanent: false,
        });
      }
    }
    return { sent, skipped: rows.length - sent };
  },
});

// ---------------------------------------------------------------------------
// Templates
//
// Plain text, short, and every one names the specific thing that happened and
// what to do next. No HTML: an HR notification read on a phone at a factory gate
// does not need a layout, and plain text never lands in a spam folder for its
// markup.
// ---------------------------------------------------------------------------

export const templates = {
  leaveRequested: (p: {
    adminName: string;
    employeeName: string;
    typeName: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
    orgName: string;
  }) => ({
    subject: `Leave request: ${p.employeeName} — ${p.days} day${p.days === 1 ? "" : "s"}`,
    body: [
      `Hello ${p.adminName},`,
      ``,
      `${p.employeeName} has requested ${p.typeName} leave.`,
      ``,
      `Dates:  ${p.startDate}${p.endDate !== p.startDate ? ` to ${p.endDate}` : ""}`,
      `Days:   ${p.days}`,
      `Reason: ${p.reason}`,
      ``,
      `Approve or reject it on the Leave page of your ${p.orgName} dashboard.`,
    ].join("\n"),
  }),

  leaveReviewed: (p: {
    employeeName: string;
    typeName: string;
    startDate: string;
    endDate: string;
    days: number;
    approved: boolean;
    note?: string;
    remainingDays: number;
    orgName: string;
  }) => ({
    subject: `Your leave request was ${p.approved ? "approved" : "rejected"}`,
    body: [
      `Hello ${p.employeeName},`,
      ``,
      `Your ${p.typeName} leave for ${p.startDate}${
        p.endDate !== p.startDate ? ` to ${p.endDate}` : ""
      } (${p.days} day${p.days === 1 ? "" : "s"}) was ${
        p.approved ? "approved" : "rejected"
      }.`,
      ...(p.note ? [``, `Note from your admin: ${p.note}`] : []),
      ``,
      p.approved
        ? `You have ${p.remainingDays} day${p.remainingDays === 1 ? "" : "s"} of ${p.typeName} leave left.`
        : `Your balance is unchanged at ${p.remainingDays} day${p.remainingDays === 1 ? "" : "s"}.`,
      ``,
      `— ${p.orgName}`,
    ].join("\n"),
  }),

  payslipReady: (p: { employeeName: string; period: string; orgName: string }) => ({
    subject: `Your payslip for ${p.period} is ready`,
    body: [
      `Hello ${p.employeeName},`,
      ``,
      `Your payslip for ${p.period} has been finalised and is available in the`,
      `AttendanceHR app under Pay.`,
      ``,
      `— ${p.orgName}`,
    ].join("\n"),
  }),

  missedClockOut: (p: { employeeName: string; workDate: string; orgName: string }) => ({
    subject: `You did not clock out on ${p.workDate}`,
    body: [
      `Hello ${p.employeeName},`,
      ``,
      `Our records show you clocked in on ${p.workDate} but never clocked out, so`,
      `that day has no hours against it.`,
      ``,
      `Open the app and request a correction so your admin can fix the record.`,
      ``,
      `— ${p.orgName}`,
    ].join("\n"),
  }),
};
