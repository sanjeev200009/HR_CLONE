import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";

// Convex has no row-level security. The entire tenant boundary is the three guards
// in convex/lib/guard.ts, which means these tests ARE the isolation guarantee.
// If this file passes, one company cannot read another's attendance. If a future
// function skips a guard, the test for that shape should fail here first.

const ORG_DEFAULTS = {
  status: "active" as const,
  timezone: "Asia/Colombo",
  expectedStart: "09:00",
  expectedEnd: "17:30",
  graceMinutes: 15,
  minHours: 8,
  maxAccuracyM: 100,
};

/** Two unrelated companies, each with one admin and one employee. */
async function twoCompanies(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const orgA = await ctx.db.insert("organizations", { ...ORG_DEFAULTS, name: "Company A" });
    const orgB = await ctx.db.insert("organizations", { ...ORG_DEFAULTS, name: "Company B" });

    const wpA = await ctx.db.insert("workplaces", {
      orgId: orgA, name: "A Office", lat: 6.9271, lng: 79.8612, radiusM: 100, isActive: true,
    });

    const empA = await ctx.db.insert("members", {
      orgId: orgA, email: "emp-a@a.lk", clerkUserId: "user_empA", fullName: "Emp A",
      role: "employee", workplaceId: wpA, isActive: true,
    });
    const adminA = await ctx.db.insert("members", {
      orgId: orgA, email: "admin-a@a.lk", clerkUserId: "user_adminA", fullName: "Admin A",
      role: "admin", isActive: true,
    });
    const empB = await ctx.db.insert("members", {
      orgId: orgB, email: "emp-b@b.lk", clerkUserId: "user_empB", fullName: "Emp B",
      role: "employee", isActive: true,
    });
    return { orgA, orgB, wpA, empA, adminA, empB };
  });
}

const as = (t: ReturnType<typeof convexTest>, subject: string, email?: string) =>
  t.withIdentity({ subject, email, emailVerified: email !== undefined });

describe("tenant isolation", () => {
  test("an employee of A cannot read B's attendance board", async () => {
    const t = convexTest(schema);
    const { orgB } = await twoCompanies(t);
    await expect(
      as(t, "user_empA").query(api.attendance.today, { orgId: orgB }),
    ).rejects.toThrow(/Not a member/);
  });

  test("an admin of A cannot read B's employee list", async () => {
    const t = convexTest(schema);
    const { orgB } = await twoCompanies(t);
    await expect(
      as(t, "user_adminA").query(api.employees.list, { orgId: orgB }),
    ).rejects.toThrow(/Not a member/);
  });

  test("an admin of A cannot clock in on behalf of B", async () => {
    const t = convexTest(schema);
    const { orgB } = await twoCompanies(t);
    await expect(
      as(t, "user_adminA").mutation(api.attendance.clockIn, { orgId: orgB, fix: {} }),
    ).rejects.toThrow(/Not a member/);
  });

  test("an admin of A cannot repoint B's workplace by id", async () => {
    // The guard proves the CALLER's org; the row check proves the ROW's. This is
    // the attack the second check in workplaces.update exists for.
    const t = convexTest(schema);
    const { orgA, wpA } = await twoCompanies(t);
    const other = await t.run(async (ctx) => {
      const orgC = await ctx.db.insert("organizations", { ...ORG_DEFAULTS, name: "Company C" });
      return await ctx.db.insert("workplaces", {
        orgId: orgC, name: "C Office", lat: 1, lng: 1, radiusM: 100, isActive: true,
      });
    });
    await expect(
      as(t, "user_adminA").mutation(api.workplaces.update, {
        orgId: orgA, workplaceId: other, radiusM: 4000,
      }),
    ).rejects.toThrow(/not found/i);
    // And A's own workplace is still editable, so the check isn't just blocking everything.
    await as(t, "user_adminA").mutation(api.workplaces.update, {
      orgId: orgA, workplaceId: wpA, radiusM: 150,
    });
  });

  test("a signed-out caller gets nothing", async () => {
    const t = convexTest(schema);
    const { orgA } = await twoCompanies(t);
    await expect(t.query(api.attendance.today, { orgId: orgA })).rejects.toThrow(/Not signed in/);
  });

  test("a deactivated employee loses access immediately", async () => {
    const t = convexTest(schema);
    const { orgA, empA } = await twoCompanies(t);
    await t.run(async (ctx) => ctx.db.patch(empA, { isActive: false }));
    await expect(
      as(t, "user_empA").query(api.attendance.today, { orgId: orgA }),
    ).rejects.toThrow(/Not a member/);
  });

  test("a suspended org blocks its own members", async () => {
    // This is how subscription expiry actually bites (convex/crons.ts).
    const t = convexTest(schema);
    const { orgA } = await twoCompanies(t);
    await t.run(async (ctx) => ctx.db.patch(orgA, { status: "suspended" }));
    await expect(
      as(t, "user_empA").query(api.attendance.today, { orgId: orgA }),
    ).rejects.toThrow(/suspended/);
  });
});

describe("role boundaries", () => {
  test("an employee cannot reach admin functions in their own org", async () => {
    const t = convexTest(schema);
    const { orgA } = await twoCompanies(t);
    await expect(
      as(t, "user_empA").query(api.employees.list, { orgId: orgA }),
    ).rejects.toThrow(/Admin only/);
    await expect(
      as(t, "user_empA").query(api.admin.todayBoard, { orgId: orgA }),
    ).rejects.toThrow(/Admin only/);
  });

  test("an employee cannot approve their own correction", async () => {
    const t = convexTest(schema);
    const { orgA, empA } = await twoCompanies(t);
    const correctionId = await t.run(async (ctx) => {
      const attendanceId = await ctx.db.insert("attendance", {
        orgId: orgA, memberId: empA, workDate: "2026-03-10",
        clockInAt: Date.parse("2026-03-10T03:30:00Z"),
        clockIn: { status: "verified" }, isLate: false,
      });
      return await ctx.db.insert("corrections", {
        orgId: orgA, memberId: empA, attendanceId,
        requestedChange: { clockOutAt: Date.parse("2026-03-10T12:00:00Z") },
        reason: "forgot", status: "pending",
      });
    });
    await expect(
      as(t, "user_empA").mutation(api.corrections.review, {
        orgId: orgA, correctionId, approve: true,
      }),
    ).rejects.toThrow(/Admin only/);
  });

  test("an employee cannot request a correction on a colleague's record", async () => {
    const t = convexTest(schema);
    const { orgA, adminA } = await twoCompanies(t);
    const someoneElses = await t.run(async (ctx) =>
      ctx.db.insert("attendance", {
        orgId: orgA, memberId: adminA, workDate: "2026-03-10",
        clockInAt: Date.now() - 3600_000, clockIn: { status: "verified" }, isLate: false,
      }),
    );
    await expect(
      as(t, "user_empA").mutation(api.corrections.request, {
        orgId: orgA, attendanceId: someoneElses,
        requestedChange: { clockOutAt: Date.now() }, reason: "mine actually",
      }),
    ).rejects.toThrow(/not found/i);
  });

  test("a platform admin can see orgs but never attendance", async () => {
    // PRD §4C: the platform owner must not have unrestricted access to employee
    // location. The guarantee is that requirePlatformAdmin grants nothing in the
    // attendance functions — being platform admin is not being a member.
    const t = convexTest(schema);
    const { orgA } = await twoCompanies(t);
    await t.run(async (ctx) => ctx.db.insert("platformAdmins", { clerkUserId: "user_owner" }));

    const orgs = await as(t, "user_owner").query(api.platform.orgs, {});
    expect(orgs).toHaveLength(2);
    expect(JSON.stringify(orgs)).not.toContain("Emp A"); // counts, not people

    await expect(
      as(t, "user_owner").query(api.attendance.today, { orgId: orgA }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      as(t, "user_owner").query(api.admin.todayBoard, { orgId: orgA }),
    ).rejects.toThrow(/Not a member/);
  });

  test("a normal admin cannot reach platform functions", async () => {
    const t = convexTest(schema);
    await twoCompanies(t);
    await expect(
      as(t, "user_adminA").query(api.platform.orgs, {}),
    ).rejects.toThrow(/Platform admin only/);
  });
});

describe("claimMembership", () => {
  // The single place an outside identity gains tenant access. Without the
  // emailVerified check, anyone could sign up as someone@customer.lk and claim
  // that company's membership.

  async function pendingInvite(t: ReturnType<typeof convexTest>) {
    return await t.run(async (ctx) => {
      const orgId = await ctx.db.insert("organizations", { ...ORG_DEFAULTS, name: "Invite Co" });
      const memberId = await ctx.db.insert("members", {
        orgId, email: "newhire@invite.lk", fullName: "New Hire",
        role: "employee", isActive: true, // clerkUserId deliberately absent
      });
      return { orgId, memberId };
    });
  }

  test("an UNVERIFIED email cannot claim a membership", async () => {
    const t = convexTest(schema);
    await pendingInvite(t);
    await expect(
      t
        .withIdentity({ subject: "user_attacker", email: "newhire@invite.lk", emailVerified: false })
        .mutation(api.members.claim, {}),
    ).rejects.toThrow(/Verify your email/);
  });

  test("a verified matching email claims it", async () => {
    const t = convexTest(schema);
    const { memberId } = await pendingInvite(t);
    const claimed = await as(t, "user_newhire", "newhire@invite.lk").mutation(api.members.claim, {});
    expect(claimed).toEqual([memberId]);

    const row = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(row?.clerkUserId).toBe("user_newhire");
  });

  test("a verified NON-matching email claims nothing", async () => {
    const t = convexTest(schema);
    await pendingInvite(t);
    const claimed = await as(t, "user_stranger", "stranger@elsewhere.lk").mutation(api.members.claim, {});
    expect(claimed).toEqual([]);
  });

  test("claiming is idempotent and cannot steal an already-claimed seat", async () => {
    const t = convexTest(schema);
    const { memberId } = await pendingInvite(t);
    await as(t, "user_newhire", "newhire@invite.lk").mutation(api.members.claim, {});

    // Someone else verifies the same address later (mailbox handed over, say).
    // The row is already bound, so it must not be repointed.
    const second = await as(t, "user_second", "newhire@invite.lk").mutation(api.members.claim, {});
    expect(second).toEqual([]);
    const row = await t.run(async (ctx) => ctx.db.get(memberId));
    expect(row?.clerkUserId).toBe("user_newhire");
  });

  test("an identity with no email is rejected", async () => {
    const t = convexTest(schema);
    await pendingInvite(t);
    await expect(
      t.withIdentity({ subject: "user_noemail", emailVerified: true }).mutation(api.members.claim, {}),
    ).rejects.toThrow(/No email/);
  });
});
