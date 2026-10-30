import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

// PRD §7: the system "must handle" duplicate clock-ins, clock-out without
// clock-in, permission denial, poor accuracy and mock locations. Each of those is
// a test here, because each is a real thing a phone will do on a Monday morning.

const ORG = {
  status: "active" as const,
  timezone: "Asia/Colombo",
  expectedStart: "09:00",
  expectedEnd: "17:30",
  graceMinutes: 15,
  minHours: 8,
  maxAccuracyM: 100,
};

// Colombo Fort, and a point ~1.2km away.
const OFFICE = { lat: 6.9271, lng: 79.8612 };
const FAR = { lat: 6.9380, lng: 79.8612 };

async function setup(t: ReturnType<typeof convexTest>, radiusM = 100) {
  return await t.run(async (ctx) => {
    const orgId = await ctx.db.insert("organizations", { ...ORG, name: "Test Co" });
    const workplaceId = await ctx.db.insert("workplaces", {
      orgId, name: "HQ", ...OFFICE, radiusM, isActive: true,
    });
    const memberId = await ctx.db.insert("members", {
      orgId, email: "e@test.lk", clerkUserId: "user_e", fullName: "Emp",
      role: "employee", workplaceId, isActive: true,
    });
    return { orgId, workplaceId, memberId };
  });
}

const signedIn = (t: ReturnType<typeof convexTest>) => t.withIdentity({ subject: "user_e" });

describe("clock in / out state machine", () => {
  test("a second clock-in is refused", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: OFFICE });
    await expect(
      signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: OFFICE }),
    ).rejects.toThrow(/already clocked in/i);
  });

  test("clocking out without clocking in is refused", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await expect(
      signedIn(t).mutation(api.attendance.clockOut, { orgId, fix: OFFICE }),
    ).rejects.toThrow(/not clocked in/i);
  });

  test("in, out, then in again is allowed — PRD §7 permits several sessions a day", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: OFFICE });
    await signedIn(t).mutation(api.attendance.clockOut, { orgId, fix: OFFICE });
    await signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: OFFICE });

    const today = await signedIn(t).query(api.attendance.today, { orgId });
    expect(today.sessions).toBe(2);
    expect(today.isClockedIn).toBe(true);
  });

  test("today reflects clocked-out state after the round trip", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: OFFICE });
    await signedIn(t).mutation(api.attendance.clockOut, { orgId, fix: OFFICE });
    const today = await signedIn(t).query(api.attendance.today, { orgId });
    expect(today.isClockedIn).toBe(false);
    expect(today.since).toBeNull();
  });
});

describe("the GPS verdict is decided by the server", () => {
  test("inside the radius verifies", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const r = await signedIn(t).mutation(api.attendance.clockIn, {
      orgId, fix: { ...OFFICE, accuracyM: 12 },
    });
    expect(r?.clockIn.status).toBe("verified");
    expect(r?.clockIn.distanceM).toBeLessThan(5);
  });

  test("outside the radius is out_of_range, and the distance is recorded", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const r = await signedIn(t).mutation(api.attendance.clockIn, {
      orgId, fix: { ...FAR, accuracyM: 12 },
    });
    expect(r?.clockIn.status).toBe("out_of_range");
    expect(r?.clockIn.distanceM).toBeGreaterThan(1000);
  });

  test("a fix too imprecise to mean anything is low_accuracy, not verified", async () => {
    // Coordinates dead-on the office, but accurate only to 2km. Trusting this
    // would let someone 'verify' from the next town.
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const r = await signedIn(t).mutation(api.attendance.clockIn, {
      orgId, fix: { ...OFFICE, accuracyM: 2000 },
    });
    expect(r?.clockIn.status).toBe("low_accuracy");
  });

  test("a mock location is never verified, even with perfect coordinates", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const r = await signedIn(t).mutation(api.attendance.clockIn, {
      orgId, fix: { ...OFFICE, accuracyM: 3, isMocked: true },
    });
    expect(r?.clockIn.status).toBe("suspect_mocked");
  });

  test("denied permission still records attendance, flagged as no_location", async () => {
    // The employee turned up. Refusing to record it would punish them for a
    // phone setting; recording it as verified would be a lie.
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const r = await signedIn(t).mutation(api.attendance.clockIn, { orgId, fix: {} });
    expect(r?.clockIn.status).toBe("no_location");
    expect(r?.clockIn.distanceM).toBeUndefined();
  });

  test("a client cannot assert its own status", async () => {
    // The mutation's arg validator has no `status` field, so a client that tries
    // to send one is rejected outright rather than believed.
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await expect(
      signedIn(t).mutation(api.attendance.clockIn, {
        orgId,
        fix: { ...FAR, status: "verified" } as never,
      }),
    ).rejects.toThrow();
  });
});

describe("workplace radius limits", () => {
  test("a radius wide enough to disable verification is refused", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await t.run(async (ctx) => {
      const admins = await ctx.db.query("members").collect();
      await ctx.db.patch(admins[0]._id, { role: "admin" });
    });
    await expect(
      signedIn(t).mutation(api.workplaces.create, {
        orgId, name: "Everywhere", ...OFFICE, radiusM: 50_000,
      }),
    ).rejects.toThrow(/between 20m and 5000m/);
  });

  test("a radius tighter than consumer GPS can achieve is refused", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await t.run(async (ctx) => {
      const admins = await ctx.db.query("members").collect();
      await ctx.db.patch(admins[0]._id, { role: "admin" });
    });
    await expect(
      signedIn(t).mutation(api.workplaces.create, {
        orgId, name: "Pinpoint", ...OFFICE, radiusM: 5,
      }),
    ).rejects.toThrow(/between 20m and 5000m/);
  });
});

describe("seat limits", () => {
  test("inviting past the plan limit is refused with the plan named", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await t.run(async (ctx) => {
      const planId = await ctx.db.insert("plans", {
        name: "Starter", monthlyPrice: 1000, annualPrice: 10000, employeeLimit: 2, isActive: true,
      });
      await ctx.db.patch(orgId, { planId });
      const members = await ctx.db.query("members").collect();
      await ctx.db.patch(members[0]._id, { role: "admin" });
    });

    // Seat 2 of 2.
    await signedIn(t).mutation(api.employees.invite, {
      orgId, email: "second@test.lk", fullName: "Second", role: "employee",
    });
    // Seat 3 must fail.
    await expect(
      signedIn(t).mutation(api.employees.invite, {
        orgId, email: "third@test.lk", fullName: "Third", role: "employee",
      }),
    ).rejects.toThrow(/Starter plan allows 2 employees/);
  });

  test("a duplicate email in the same org is refused", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      await ctx.db.patch(members[0]._id, { role: "admin" });
    });
    await expect(
      signedIn(t).mutation(api.employees.invite, {
        orgId, email: "E@TEST.LK", fullName: "Dupe", role: "employee",
      }),
    ).rejects.toThrow(/already in this organization/);
  });

  test("the last active admin cannot be demoted", async () => {
    const t = convexTest(schema);
    const { orgId } = await setup(t);
    const adminId = await t.run(async (ctx) => {
      const members = await ctx.db.query("members").collect();
      await ctx.db.patch(members[0]._id, { role: "admin" });
      return members[0]._id;
    });
    await expect(
      signedIn(t).mutation(api.employees.update, {
        orgId, memberId: adminId, role: "employee",
      }),
    ).rejects.toThrow(/last active admin/);
  });
});
