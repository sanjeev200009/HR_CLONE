import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember } from "./lib/guard";

// Coworker feedback.
//
// The riskiest feature in the product. Three decisions make it safe enough to
// ship, and all three are enforced server-side:
//
//   1. Visibility is resolved in the query, never by the client. A client that
//      ignores a flag must still receive nothing it should not see.
//   2. "Anonymous" hides the author from the RECIPIENT, not from the audit log.
//      Truly untraceable text about a named colleague is a harassment vector, so
//      the author is always recorded and always visible to an admin.
//   3. You cannot write feedback about yourself, and you cannot write it about
//      somebody in another company.

export const give = mutation({
  args: {
    orgId: v.id("organizations"),
    toMemberId: v.id("members"),
    body: v.string(),
    visibility: v.union(v.literal("private"), v.literal("manager"), v.literal("team")),
    isAnonymous: v.boolean(),
  },
  handler: async (ctx, { orgId, toMemberId, body, visibility, isAnonymous }) => {
    const from = await requireMember(ctx, orgId);

    const to = await ctx.db.get(toMemberId);
    if (!to || to.orgId !== orgId || !to.isActive) throw new Error("Person not found");
    if (to._id === from._id) throw new Error("You cannot leave feedback about yourself");

    const text = body.trim();
    if (text.length < 10) throw new Error("Say a little more than that");
    if (text.length > 2000) throw new Error("Keep feedback under 2000 characters");

    const id = await ctx.db.insert("feedback", {
      orgId,
      fromMemberId: from._id,
      toMemberId,
      body: text,
      visibility,
      isAnonymous,
    });

    // Always logged with the real author. See decision 2 above.
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: from.clerkUserId,
      action: "feedback.given",
      entityType: "feedback",
      entityId: id,
      metadata: { toMemberId, visibility, isAnonymous },
    });
    return id;
  },
});

/**
 * Feedback visible to the caller about one person.
 *
 * Who sees what:
 *   private  -> the recipient, their manager, admins
 *   manager  -> the recipient's manager and admins only (upward feedback, so the
 *               recipient must NOT see it — that is the entire point)
 *   team     -> anyone in the org
 * The author always sees their own.
 */
export const about = query({
  args: { orgId: v.id("organizations"), memberId: v.id("members") },
  handler: async (ctx, { orgId, memberId }) => {
    const viewer = await requireMember(ctx, orgId);

    const subject = await ctx.db.get(memberId);
    if (!subject || subject.orgId !== orgId) throw new Error("Person not found");

    const isAdmin = viewer.role === "admin";
    const isRecipient = subject._id === viewer._id;
    const isTheirManager = subject.managerId === viewer._id;

    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_to", (q) => q.eq("toMemberId", memberId))
      .order("desc")
      .take(200);

    const visible = rows.filter((f) => {
      if (f.fromMemberId === viewer._id) return true; // your own words
      if (isAdmin) return true;
      switch (f.visibility) {
        case "team":
          return true;
        case "private":
          return isRecipient || isTheirManager;
        case "manager":
          // Deliberately NOT isRecipient.
          return isTheirManager;
      }
    });

    const names = new Map(
      (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((m) => [m._id, m.fullName]),
    );

    return visible.map((f) => {
      // An admin always sees the author, even on anonymous feedback, so there is
      // someone accountable for what was written.
      const revealAuthor = !f.isAnonymous || isAdmin || f.fromMemberId === viewer._id;
      return {
        _id: f._id,
        body: f.body,
        visibility: f.visibility,
        isAnonymous: f.isAnonymous,
        createdAt: f._creationTime,
        fromName: revealAuthor ? names.get(f.fromMemberId) ?? "(removed)" : null,
        // Flag it so an admin reading a revealed name knows it is hidden from
        // the recipient, and does not quote it back to them.
        authorHiddenFromRecipient: f.isAnonymous,
      };
    });
  },
});

/** Feedback the caller has written, so they can see what they have said. */
export const mine = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const viewer = await requireMember(ctx, orgId);
    const rows = await ctx.db
      .query("feedback")
      .withIndex("by_from", (q) => q.eq("fromMemberId", viewer._id))
      .order("desc")
      .take(100);

    const names = new Map(
      (
        await ctx.db
          .query("members")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((m) => [m._id, m.fullName]),
    );
    return rows.map((f) => ({
      _id: f._id,
      body: f.body,
      visibility: f.visibility,
      isAnonymous: f.isAnonymous,
      createdAt: f._creationTime,
      toName: names.get(f.toMemberId) ?? "(removed)",
    }));
  },
});

/**
 * Withdraw your own feedback.
 *
 * Only the author, and only their own. An admin cannot quietly delete feedback
 * about themselves — which, in a product where the admin is often the owner, is
 * the abuse this restriction exists to prevent.
 */
export const withdraw = mutation({
  args: { orgId: v.id("organizations"), feedbackId: v.id("feedback") },
  handler: async (ctx, { orgId, feedbackId }) => {
    const viewer = await requireMember(ctx, orgId);
    const f = await ctx.db.get(feedbackId);
    if (!f || f.orgId !== orgId) throw new Error("Feedback not found");
    if (f.fromMemberId !== viewer._id) throw new Error("You can only withdraw your own feedback");

    await ctx.db.delete(feedbackId);
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: viewer.clerkUserId,
      action: "feedback.withdrawn",
      entityType: "feedback",
      entityId: feedbackId,
      metadata: { toMemberId: f.toMemberId },
    });
  },
});
