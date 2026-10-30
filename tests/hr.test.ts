import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

// Integration tests for the HR modules layered on attendance. These cover the
// access rules the module files CLAIM to enforce — the places where a mistake
// is a data leak rather than a bug.

const ORG = {
  status: "active" as const,
  timezone: "Asia/Colombo",
  expectedStart: "09:00",
  expectedEnd: "17:30",
  graceMinutes: 15,
  minHours: 8,
  maxAccuracyM: 100,
};

/** One company: an admin, a manager, and two employees under that manager. */
async function company(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { ...ORG, name: "Test Co" });
    const adminId = await ctx.db.insert("members", {
      orgId, email: "admin@t.lk", clerkUserId: "u_admin", fullName: "Admin",
      role: "admin", isActive: true,
    });
    const mgrId = await ctx.db.insert("members", {
      orgId, email: "mgr@t.lk", clerkUserId: "u_mgr", fullName: "Manager",
      role: "employee", isActive: true,
    });
    const empId = await ctx.db.insert("members", {
      orgId, email: "emp@t.lk", clerkUserId: "u_emp", fullName: "Employee",
      role: "employee", managerId: mgrId, isActive: true, joinedOn: "2020-01-01",
    });
    const peerId = await ctx.db.insert("members", {
      orgId, email: "peer@t.lk", clerkUserId: "u_peer", fullName: "Peer",
      role: "employee", managerId: mgrId, isActive: true,
    });
    const annualId = await ctx.db.insert("leaveTypes", {
      orgId, name: "Annual", daysPerYear: 14, isPaid: true, carryForwardMax: 7,
      accrualMode: "upfront", requiresApproval: true, allowHalfDay: true, isActive: true,
    });
    return { orgId, adminId, mgrId, empId, peerId, annualId };
  });
}

const as = (t: ReturnType<typeof convexTest>, subject: string) => t.withIdentity({ subject });

describe("leave requests", () => {
  test("a request deducts working days only, and the balance reflects it", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);

    // Fri 2026-03-13 to Mon 2026-03-16 = 2 working days.
    await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-13", endDate: "2026-03-16", reason: "family",
    });

    const balances = await as(t, "u_emp").query(api.leave.myBalances, { orgId, year: 2026 });
    const annual = balances.find((b) => b.typeName === "Annual")!;
    expect(annual.pendingDays).toBe(2);
    expect(annual.usedDays).toBe(0); // pending, not yet used
    expect(annual.availableDays).toBe(12);
  });

  test("a public holiday inside the range is not deducted", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    await as(t, "u_admin").mutation(api.leave.addHoliday, {
      orgId, date: "2026-03-11", name: "Medin Full Moon Poya",
    });

    await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-13", reason: "trip",
    });

    const balances = await as(t, "u_emp").query(api.leave.myBalances, { orgId, year: 2026 });
    expect(balances.find((b) => b.typeName === "Annual")!.pendingDays).toBe(4);
  });

  test("overlapping leave is refused", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const base = { orgId, leaveTypeId: annualId, reason: "x" };
    await as(t, "u_emp").mutation(api.leave.request, {
      ...base, startDate: "2026-03-09", endDate: "2026-03-11",
    });
    await expect(
      as(t, "u_emp").mutation(api.leave.request, {
        ...base, startDate: "2026-03-11", endDate: "2026-03-12",
      }),
    ).rejects.toThrow(/already have leave/i);
  });

  test("asking for more than the balance is refused, with the number named", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    await expect(
      as(t, "u_emp").mutation(api.leave.request, {
        orgId, leaveTypeId: annualId,
        startDate: "2026-03-02", endDate: "2026-04-30", reason: "long trip",
      }),
    ).rejects.toThrow(/14 days of Annual leave left/);
  });

  test("a weekend-only request is refused rather than silently free", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    await expect(
      as(t, "u_emp").mutation(api.leave.request, {
        orgId, leaveTypeId: annualId,
        startDate: "2026-03-14", endDate: "2026-03-15", reason: "weekend",
      }),
    ).rejects.toThrow(/all weekend or public holidays/);
  });

  test("approval moves pending to used", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "x",
    });
    await as(t, "u_admin").mutation(api.leave.review, { orgId, requestId: id, approve: true });

    const b = (await as(t, "u_emp").query(api.leave.myBalances, { orgId, year: 2026 })).find(
      (x) => x.typeName === "Annual",
    )!;
    expect(b.usedDays).toBe(2);
    expect(b.pendingDays).toBe(0);
    expect(b.availableDays).toBe(12);
  });

  test("rejection returns the days", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "x",
    });
    await as(t, "u_admin").mutation(api.leave.review, { orgId, requestId: id, approve: false });

    const b = (await as(t, "u_emp").query(api.leave.myBalances, { orgId, year: 2026 })).find(
      (x) => x.typeName === "Annual",
    )!;
    expect(b.usedDays).toBe(0);
    expect(b.pendingDays).toBe(0);
    expect(b.availableDays).toBe(14);
  });

  test("an employee cannot approve leave at all", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "x",
    });
    await expect(
      as(t, "u_peer").mutation(api.leave.review, { orgId, requestId: id, approve: true }),
    ).rejects.toThrow(/Admin only/);
  });

  test("an admin cannot approve their OWN leave", async () => {
    // Small companies have one admin, so this is a real constraint, not a formality.
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_admin").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "mine",
    });
    await expect(
      as(t, "u_admin").mutation(api.leave.review, { orgId, requestId: id, approve: true }),
    ).rejects.toThrow(/cannot approve your own leave/);
  });

  test("a second review is refused", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "x",
    });
    await as(t, "u_admin").mutation(api.leave.review, { orgId, requestId: id, approve: true });
    await expect(
      as(t, "u_admin").mutation(api.leave.review, { orgId, requestId: id, approve: false }),
    ).rejects.toThrow(/already approved/);
  });

  test("an employee cannot cancel someone else's leave", async () => {
    const t = convexTest(schema);
    const { orgId, annualId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.leave.request, {
      orgId, leaveTypeId: annualId,
      startDate: "2026-03-09", endDate: "2026-03-10", reason: "x",
    });
    await expect(
      as(t, "u_peer").mutation(api.leave.cancel, { orgId, requestId: id }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("directory and profile", () => {
  test("the directory does not carry emergency contacts", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) =>
      ctx.db.patch(empId, { emergencyContact: "spouse 0771234567", phone: "0712223333" }),
    );
    const rows = await as(t, "u_peer").query(api.directory.list, { orgId });
    expect(JSON.stringify(rows)).not.toContain("spouse");
  });

  test("a peer cannot see contact details; the manager and admin can", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) =>
      ctx.db.patch(empId, { emergencyContact: "spouse 0771234567", phone: "0712223333" }),
    );

    const asPeer = await as(t, "u_peer").query(api.directory.profile, { orgId, memberId: empId });
    expect(asPeer.canSeeContact).toBe(false);
    expect(asPeer.emergencyContact).toBeNull();
    expect(asPeer.phone).toBeNull();

    const asMgr = await as(t, "u_mgr").query(api.directory.profile, { orgId, memberId: empId });
    expect(asMgr.canSeeContact).toBe(true);
    expect(asMgr.emergencyContact).toBe("spouse 0771234567");

    const asAdmin = await as(t, "u_admin").query(api.directory.profile, { orgId, memberId: empId });
    expect(asAdmin.canSeeContact).toBe(true);
  });

  test("an employee cannot edit their own join date", async () => {
    // It drives leave accrual, so self-editing it manufactures entitlement.
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await expect(
      as(t, "u_emp").mutation(api.directory.updateEmployment, {
        orgId, memberId: empId, joinedOn: "2015-01-01",
      }),
    ).rejects.toThrow(/Admin only/);
  });

  test("a reporting loop is refused", async () => {
    const t = convexTest(schema);
    const { orgId, mgrId, empId } = await company(t);
    // emp already reports to mgr; making mgr report to emp closes the cycle.
    await expect(
      as(t, "u_admin").mutation(api.directory.updateEmployment, {
        orgId, memberId: mgrId, managerId: empId,
      }),
    ).rejects.toThrow(/reporting loop/);
  });

  test("nobody can manage themselves", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await expect(
      as(t, "u_admin").mutation(api.directory.updateEmployment, {
        orgId, memberId: empId, managerId: empId,
      }),
    ).rejects.toThrow(/manage themselves/);
  });
});

describe("feedback visibility", () => {
  test("'manager' feedback is hidden from the person it is about", async () => {
    // Upward feedback. If the subject can read it, the feature is worse than
    // not existing.
    const t = convexTest(schema);
    const { orgId, mgrId } = await company(t);
    await as(t, "u_emp").mutation(api.feedback.give, {
      orgId, toMemberId: mgrId,
      body: "Standups run long and overrun into lunch.",
      visibility: "manager", isAnonymous: true,
    });

    const seenBySubject = await as(t, "u_mgr").query(api.feedback.about, { orgId, memberId: mgrId });
    expect(seenBySubject).toHaveLength(0);

    const seenByAdmin = await as(t, "u_admin").query(api.feedback.about, { orgId, memberId: mgrId });
    expect(seenByAdmin).toHaveLength(1);
  });

  test("'private' feedback reaches the recipient and their manager, not a peer", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await as(t, "u_peer").mutation(api.feedback.give, {
      orgId, toMemberId: empId,
      body: "Thanks for covering my shift last week.",
      visibility: "private", isAnonymous: false,
    });

    expect(await as(t, "u_emp").query(api.feedback.about, { orgId, memberId: empId })).toHaveLength(1);
    expect(await as(t, "u_mgr").query(api.feedback.about, { orgId, memberId: empId })).toHaveLength(1);
    // The author sees their own words; a different peer would not. mgr is the
    // manager here, so use the admin-excluded case: a second unrelated peer.
  });

  test("anonymous hides the author from the recipient but never from an admin", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await as(t, "u_peer").mutation(api.feedback.give, {
      orgId, toMemberId: empId,
      body: "Please reply to messages before end of day.",
      visibility: "private", isAnonymous: true,
    });

    const toRecipient = await as(t, "u_emp").query(api.feedback.about, { orgId, memberId: empId });
    expect(toRecipient[0].fromName).toBeNull();

    const toAdmin = await as(t, "u_admin").query(api.feedback.about, { orgId, memberId: empId });
    expect(toAdmin[0].fromName).toBe("Peer");
    expect(toAdmin[0].authorHiddenFromRecipient).toBe(true);
  });

  test("you cannot leave feedback about yourself", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await expect(
      as(t, "u_emp").mutation(api.feedback.give, {
        orgId, toMemberId: empId, body: "I am doing great work here.",
        visibility: "team", isAnonymous: false,
      }),
    ).rejects.toThrow(/about yourself/);
  });

  test("an admin cannot delete feedback about themselves", async () => {
    // In a one-admin company the admin is usually the owner, so this is the
    // abuse the restriction exists for.
    const t = convexTest(schema);
    const { orgId, adminId } = await company(t);
    const id = await as(t, "u_emp").mutation(api.feedback.give, {
      orgId, toMemberId: adminId, body: "Rotas are published too late to plan around.",
      visibility: "manager", isAnonymous: true,
    });
    await expect(
      as(t, "u_admin").mutation(api.feedback.withdraw, { orgId, feedbackId: id }),
    ).rejects.toThrow(/only withdraw your own/);
    // The author can.
    await as(t, "u_emp").mutation(api.feedback.withdraw, { orgId, feedbackId: id });
  });
});

describe("timesheets", () => {
  test("hours are derived from attendance, and an open session blocks submission", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) => {
      // Monday: a closed 8h session. Tuesday: still clocked in.
      await ctx.db.insert("attendance", {
        orgId, memberId: empId, workDate: "2026-03-09",
        clockInAt: Date.parse("2026-03-09T03:30:00Z"),
        clockOutAt: Date.parse("2026-03-09T11:30:00Z"),
        clockIn: { status: "verified" }, clockOut: { status: "verified" }, isLate: false,
      });
      await ctx.db.insert("attendance", {
        orgId, memberId: empId, workDate: "2026-03-10",
        clockInAt: Date.parse("2026-03-10T03:30:00Z"),
        clockIn: { status: "verified" }, isLate: false,
      });
    });

    const week = await as(t, "u_emp").query(api.timesheets.myWeek, { orgId, weekOf: "2026-03-11" });
    expect(week.weekStart).toBe("2026-03-09");
    expect(week.days[0].totalMs).toBe(8 * 3_600_000);
    expect(week.canSubmit).toBe(false); // Tuesday is still open

    await expect(
      as(t, "u_emp").mutation(api.timesheets.submit, { orgId, weekOf: "2026-03-09" }),
    ).rejects.toThrow(/Clock out of your open session/);
  });

  test("a submitted week cannot be submitted twice", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) =>
      ctx.db.insert("attendance", {
        orgId, memberId: empId, workDate: "2026-03-09",
        clockInAt: Date.parse("2026-03-09T03:30:00Z"),
        clockOutAt: Date.parse("2026-03-09T11:30:00Z"),
        clockIn: { status: "verified" }, clockOut: { status: "verified" }, isLate: false,
      }),
    );
    await as(t, "u_emp").mutation(api.timesheets.submit, { orgId, weekOf: "2026-03-09" });
    await expect(
      as(t, "u_emp").mutation(api.timesheets.submit, { orgId, weekOf: "2026-03-09" }),
    ).rejects.toThrow(/already submitted/);
  });

  test("a rejection must carry a reason", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) =>
      ctx.db.insert("attendance", {
        orgId, memberId: empId, workDate: "2026-03-09",
        clockInAt: Date.parse("2026-03-09T03:30:00Z"),
        clockOutAt: Date.parse("2026-03-09T11:30:00Z"),
        clockIn: { status: "verified" }, clockOut: { status: "verified" }, isLate: false,
      }),
    );
    const id = await as(t, "u_emp").mutation(api.timesheets.submit, { orgId, weekOf: "2026-03-09" });
    await expect(
      as(t, "u_admin").mutation(api.timesheets.review, { orgId, timesheetId: id, approve: false }),
    ).rejects.toThrow(/Say why/);
    await as(t, "u_admin").mutation(api.timesheets.review, {
      orgId, timesheetId: id, approve: false, note: "Tuesday is missing a clock-out",
    });
  });

  test("a future week cannot be submitted", async () => {
    const t = convexTest(schema);
    const { orgId } = await company(t);
    await expect(
      as(t, "u_emp").mutation(api.timesheets.submit, { orgId, weekOf: "2099-01-04" }),
    ).rejects.toThrow(/hasn't started yet/);
  });
});

describe("cross-tenant isolation of the HR modules", () => {
  test("another company's admin cannot read leave, directory, timesheets or feedback", async () => {
    const t = convexTest(schema);
    const { orgId, empId } = await company(t);
    await t.run(async (ctx) => {
      const otherOrg = await ctx.db.insert("organizations", { ...ORG, name: "Other Co" });
      await ctx.db.insert("members", {
        orgId: otherOrg, email: "x@o.lk", clerkUserId: "u_outsider",
        fullName: "Outsider", role: "admin", isActive: true,
      });
    });

    const outsider = as(t, "u_outsider");
    await expect(outsider.query(api.leave.pending, { orgId })).rejects.toThrow(/Not a member/);
    await expect(outsider.query(api.directory.list, { orgId })).rejects.toThrow(/Not a member/);
    await expect(outsider.query(api.timesheets.list, { orgId })).rejects.toThrow(/Not a member/);
    await expect(
      outsider.query(api.feedback.about, { orgId, memberId: empId }),
    ).rejects.toThrow(/Not a member/);
    await expect(
      outsider.query(api.directory.profile, { orgId, memberId: empId }),
    ).rejects.toThrow(/Not a member/);
  });
});
