import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireMember, requireOrgAdmin } from "./lib/guard";

// Company directory and profile self-service.
//
// The directory is readable by every member of the org — that is the point of a
// directory. What it deliberately does NOT expose is anything an employee has not
// chosen to share or that is nobody else's business: no home address, no salary,
// no emergency contact, and no attendance. Those are visible to the person
// themselves and to admins, and the split is enforced here, not in the UI.

/** Everyone in the org, for the directory list. Member-level read. */
export const list = query({
  args: { orgId: v.id("organizations"), search: v.optional(v.string()) },
  handler: async (ctx, { orgId, search }) => {
    await requireMember(ctx, orgId);

    const members = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((m) => m.isActive);

    const deps = new Map(
      (
        await ctx.db
          .query("departments")
          .withIndex("by_org", (q) => q.eq("orgId", orgId))
          .collect()
      ).map((d) => [d._id, d.name]),
    );
    const names = new Map(members.map((m) => [m._id, m.fullName]));

    const needle = search?.trim().toLowerCase();
    return members
      .map((m) => ({
        _id: m._id,
        fullName: m.fullName,
        email: m.email,
        phone: m.phone ?? null,
        jobTitle: m.jobTitle ?? null,
        department: m.departmentId ? deps.get(m.departmentId) ?? null : null,
        managerName: m.managerId ? names.get(m.managerId) ?? null : null,
        avatarStorageId: m.avatarStorageId ?? null,
        // emergencyContact is absent on purpose — see the file header.
      }))
      .filter(
        (m) =>
          !needle ||
          m.fullName.toLowerCase().includes(needle) ||
          m.email.toLowerCase().includes(needle) ||
          (m.jobTitle ?? "").toLowerCase().includes(needle) ||
          (m.department ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  },
});

/**
 * One coworker's profile.
 *
 * Returns more when you are looking at yourself, or when you are an admin or
 * their manager. `canSeeContact` is computed here so the client never has to
 * decide, and so a client that ignores the flag still gets nothing extra.
 */
export const profile = query({
  args: { orgId: v.id("organizations"), memberId: v.id("members") },
  handler: async (ctx, { orgId, memberId }) => {
    const viewer = await requireMember(ctx, orgId);

    const m = await ctx.db.get(memberId);
    if (!m || m.orgId !== orgId || !m.isActive) throw new Error("Person not found");

    const isSelf = m._id === viewer._id;
    const isAdmin = viewer.role === "admin";
    const isTheirManager = m.managerId === viewer._id;
    const privileged = isSelf || isAdmin || isTheirManager;

    const manager = m.managerId ? await ctx.db.get(m.managerId) : null;
    const dept = m.departmentId ? await ctx.db.get(m.departmentId) : null;
    const reports = (
      await ctx.db
        .query("members")
        .withIndex("by_org", (q) => q.eq("orgId", orgId))
        .collect()
    ).filter((r) => r.isActive && r.managerId === m._id);

    return {
      _id: m._id,
      fullName: m.fullName,
      email: m.email,
      jobTitle: m.jobTitle ?? null,
      about: m.about ?? null,
      department: dept?.name ?? null,
      manager: manager ? { _id: manager._id, fullName: manager.fullName } : null,
      reports: reports.map((r) => ({ _id: r._id, fullName: r.fullName })),
      joinedOn: m.joinedOn ?? null,
      avatarStorageId: m.avatarStorageId ?? null,
      isSelf,
      canSeeContact: privileged,
      phone: privileged ? m.phone ?? null : null,
      emergencyContact: privileged ? m.emergencyContact ?? null : null,
    };
  },
});

/**
 * Edit your own profile.
 *
 * An employee may change what they present and how to reach them. They may NOT
 * change their job title, department, manager, role or join date — those are
 * employment facts, and letting someone edit their own join date would let them
 * manufacture leave entitlement.
 */
export const updateMyProfile = mutation({
  args: {
    orgId: v.id("organizations"),
    fullName: v.optional(v.string()),
    phone: v.optional(v.string()),
    about: v.optional(v.string()),
    emergencyContact: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { orgId, ...patch }) => {
    const member = await requireMember(ctx, orgId);

    if (patch.fullName !== undefined && !patch.fullName.trim()) {
      throw new Error("Your name cannot be empty");
    }
    if ((patch.about ?? "").length > 500) {
      throw new Error("Keep the About text under 500 characters");
    }

    await ctx.db.patch(member._id, {
      ...patch,
      fullName: patch.fullName?.trim() ?? member.fullName,
    });
  },
});

/** Employment facts. Admin only, for the reasons in updateMyProfile. */
export const updateEmployment = mutation({
  args: {
    orgId: v.id("organizations"),
    memberId: v.id("members"),
    jobTitle: v.optional(v.string()),
    managerId: v.optional(v.id("members")),
    joinedOn: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, memberId, ...patch }) => {
    const admin = await requireOrgAdmin(ctx, orgId);

    const target = await ctx.db.get(memberId);
    if (!target || target.orgId !== orgId) throw new Error("Employee not found");

    if (patch.joinedOn !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(patch.joinedOn)) {
      throw new Error("Join date must be YYYY-MM-DD");
    }

    if (patch.managerId !== undefined) {
      const mgr = await ctx.db.get(patch.managerId);
      if (!mgr || mgr.orgId !== orgId) throw new Error("Manager not found");
      if (patch.managerId === memberId) throw new Error("Someone cannot manage themselves");
      // Walk up the chain. A cycle would make any manager-based approval or
      // org-chart render loop forever.
      let cursor = mgr.managerId;
      for (let i = 0; i < 50 && cursor; i++) {
        if (cursor === memberId) throw new Error("That would create a reporting loop");
        cursor = (await ctx.db.get(cursor))?.managerId;
      }
    }

    await ctx.db.patch(memberId, patch);
    await ctx.db.insert("auditLogs", {
      orgId,
      actorClerkUserId: admin.clerkUserId,
      action: "member.employmentUpdate",
      entityType: "members",
      entityId: memberId,
      metadata: patch,
    });
  },
});

/** Upload URL for a profile photo. Short-lived and issued per request. */
export const avatarUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Resolve stored avatars to URLs in one round trip for a whole list. */
export const avatarUrls = query({
  args: { orgId: v.id("organizations"), ids: v.array(v.id("_storage")) },
  handler: async (ctx, { orgId, ids }) => {
    await requireMember(ctx, orgId);
    // Capped: a client asking for 10k URLs would be a cheap way to hammer storage.
    const out: Record<string, string | null> = {};
    for (const id of ids.slice(0, 200)) out[id] = await ctx.storage.getUrl(id);
    return out;
  },
});
