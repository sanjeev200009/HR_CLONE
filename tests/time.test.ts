import { describe, expect, test } from "vitest";
import {
  workDate,
  minutesIntoDay,
  parseHm,
  formatHm,
  isLate,
  workedMs,
  isMissedClockOut,
} from "../convex/lib/time";

// Pure time maths. These are the cases that decide whether somebody is marked late
// or has their day silently attributed to the wrong date.

const COLOMBO = "Asia/Colombo"; // UTC+5:30, no DST
const LONDON = "Europe/London"; // has DST — the reason Intl is used at all

describe("workDate", () => {
  test("uses the org timezone, not UTC", () => {
    // 2026-03-10T20:00Z is already 01:30 the NEXT day in Colombo (+5:30).
    const at = Date.parse("2026-03-10T20:00:00Z");
    expect(workDate(at, "UTC")).toBe("2026-03-10");
    expect(workDate(at, COLOMBO)).toBe("2026-03-11");
  });

  test("an early Colombo morning is still that calendar day", () => {
    // 03:00 Colombo = 21:30 UTC the previous day. Getting this backwards would
    // file a 06:00 shift under yesterday.
    const at = Date.parse("2026-03-09T21:30:00Z");
    expect(workDate(at, COLOMBO)).toBe("2026-03-10");
  });
});

describe("minutesIntoDay", () => {
  test("converts to org-local minutes since midnight", () => {
    // 03:30 UTC -> 09:00 Colombo -> 540
    expect(minutesIntoDay(Date.parse("2026-03-10T03:30:00Z"), COLOMBO)).toBe(540);
  });

  test("midnight is 0, not 1440", () => {
    // en-GB can render midnight as 24:00; a 1440 here would make every midnight
    // clock-in look impossibly late.
    expect(minutesIntoDay(Date.parse("2026-03-10T18:30:00Z"), COLOMBO)).toBe(0);
  });

  test("follows DST rather than a fixed offset", () => {
    const winter = Date.parse("2026-01-15T12:00:00Z"); // London = UTC
    const summer = Date.parse("2026-07-15T12:00:00Z"); // London = UTC+1
    expect(minutesIntoDay(winter, LONDON)).toBe(12 * 60);
    expect(minutesIntoDay(summer, LONDON)).toBe(13 * 60);
  });
});

describe("parseHm / formatHm", () => {
  test("round trips", () => {
    expect(parseHm("09:00")).toBe(540);
    expect(parseHm("17:30")).toBe(1050);
    expect(formatHm(1050)).toBe("17:30");
    expect(formatHm(540)).toBe("09:00");
  });

  test("rejects nonsense rather than coercing it", () => {
    // A silently-accepted "9am" would become 0 and mark the whole company late.
    expect(() => parseHm("9am")).toThrow();
    expect(() => parseHm("25:00")).toThrow();
    expect(() => parseHm("09:70")).toThrow();
    expect(() => parseHm("")).toThrow();
  });
});

describe("isLate", () => {
  const org = { timezone: COLOMBO, expectedStart: "09:00", graceMinutes: 15 };

  test("inside grace is not late", () => {
    expect(isLate(Date.parse("2026-03-10T03:44:00Z"), org)).toBe(false); // 09:14
  });

  test("exactly at the grace boundary is not late", () => {
    // Boundary belongs to the employee. 09:15 with 15 minutes grace is on time.
    expect(isLate(Date.parse("2026-03-10T03:45:00Z"), org)).toBe(false); // 09:15
  });

  test("one minute past grace is late", () => {
    expect(isLate(Date.parse("2026-03-10T03:46:00Z"), org)).toBe(true); // 09:16
  });
});

describe("workedMs", () => {
  test("counts an open session up to now", () => {
    const now = 10_000;
    expect(workedMs({ clockInAt: 4_000 }, now)).toBe(6_000);
  });

  test("uses clockOutAt once closed, ignoring now", () => {
    expect(workedMs({ clockInAt: 1_000, clockOutAt: 5_000 }, 9_999)).toBe(4_000);
  });

  test("never returns negative time", () => {
    // A corrected record could momentarily have clockIn after now.
    expect(workedMs({ clockInAt: 9_000 }, 1_000)).toBe(0);
  });
});

describe("isMissedClockOut", () => {
  test("a closed record is never a missed clock-out", () => {
    const at = Date.parse("2026-03-10T03:30:00Z");
    expect(isMissedClockOut({ clockInAt: at, clockOutAt: at + 3600_000 }, at + 7200_000, COLOMBO)).toBe(false);
  });

  test("an open session on the same work date is not flagged", () => {
    // 09:00 Colombo, still open at 18:00 Colombo — a long day, not a mistake.
    const at = Date.parse("2026-03-10T03:30:00Z");
    const later = Date.parse("2026-03-10T12:30:00Z");
    expect(isMissedClockOut({ clockInAt: at }, later, COLOMBO)).toBe(false);
  });

  test("an open session once the work date has moved on is flagged", () => {
    const at = Date.parse("2026-03-10T03:30:00Z"); // 09:00 on the 10th
    const nextDay = Date.parse("2026-03-11T03:30:00Z"); // 09:00 on the 11th
    expect(isMissedClockOut({ clockInAt: at }, nextDay, COLOMBO)).toBe(true);
  });

  test("a night shift running past midnight UTC is not flagged early", () => {
    // 22:00 Colombo on the 10th = 16:30Z. Two hours later is still the 10th in
    // Colombo even though UTC has rolled over. A UTC-based check would wrongly
    // flag every night-shift worker.
    const at = Date.parse("2026-03-10T16:30:00Z");
    const twoHoursLater = Date.parse("2026-03-10T18:29:00Z");
    expect(isMissedClockOut({ clockInAt: at }, twoHoursLater, COLOMBO)).toBe(false);
  });
});
