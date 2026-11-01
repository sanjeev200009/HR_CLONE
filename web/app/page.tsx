"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Shell, { useOrg } from "./components/Shell";
import { KpiStrip, Kpi, TitleRow, Pill, Empty, SectionHead } from "./components/ui";
import { time, duration } from "./lib/format";

// The overview.
//
// Its one question: "Is everyone who should be at work, at work?" That decides
// what is biggest (the board), what comes first (the finding), and what is left
// out (no charts — a few numbers say it, as four of the 23 studied screens found).
//
// Its one finding is computed, not decorative: the single sentence an admin needs
// before they look at anything else.

export default function Page() {
  return (
    <Shell>
      <Overview />
    </Shell>
  );
}

const STATE: Record<string, { label: string; kind: "positive" | "negative" | "warning" | "neutral" | "accent" }> = {
  in: { label: "In", kind: "positive" },
  out: { label: "Left", kind: "neutral" },
  on_leave: { label: "On leave", kind: "accent" },
  absent: { label: "Not in", kind: "warning" },
  missing_clock_out: { label: "No clock-out", kind: "negative" },
};

function Overview() {
  const { orgId, timezone, fullName } = useOrg();
  const board = useQuery(api.admin.todayBoard, { orgId });
  const pendingLeave = useQuery(api.leave.pending, { orgId, status: "pending" });
  const pendingSheets = useQuery(api.timesheets.list, { orgId, status: "submitted" });
  const pendingFixes = useQuery(api.corrections.list, { orgId, status: "pending" });
  const year = new Date().getUTCFullYear();
  const leaveYear = useQuery(api.leave.calendar, { orgId, from: `${year}-01-01`, to: `${year}-12-31` });

  if (board === undefined) return <p className="text-[var(--muted)]">Loading…</p>;

  const { counts } = board;
  const needsAttention = counts.missingClockOut + counts.flagged;

  // The finding: the one sentence that most needs saying about today's data.
  // Ordered by what would make an admin act soonest.
  const finding = (() => {
    if (board.holidayName) {
      return `${board.holidayName}. The office is closed, so ${counts.absent} not in is expected.`;
    }
    if (counts.missingClockOut > 0) {
      return `${counts.missingClockOut} ${counts.missingClockOut === 1 ? "person has" : "people have"} no clock-out, so those days have no hours against them.`;
    }
    if (counts.flagged > 0) {
      return `${counts.flagged} ${counts.flagged === 1 ? "clock-in was" : "clock-ins were"} not verified against a workplace.`;
    }
    if (board.pastExpectedEnd && counts.absent > 0) {
      return `${counts.absent} never clocked in today and the working day has ended.`;
    }
    if (counts.late > 0) {
      return `${counts.late} ${counts.late === 1 ? "arrival was" : "arrivals were"} after ${board.workDate === "" ? "the grace period" : "the grace period"}.`;
    }
    if (counts.employees === 0) return "No employees yet. Add your team on the Employees page.";
    return `All ${counts.in + counts.out} who clocked in today were at their workplace.`;
  })();

  const queue = [
    { label: "Leave requests", n: pendingLeave?.length ?? 0, href: "/leave" },
    { label: "Timesheets", n: pendingSheets?.length ?? 0, href: "/timesheets" },
    { label: "Attendance corrections", n: pendingFixes?.length ?? 0, href: "/corrections" },
  ];
  const waiting = queue.reduce((s, q) => s + q.n, 0);

  return (
    <>
      <TitleRow
        title={`Good day, ${fullName.split(" ")[0]}`}
        sub={finding}
        action={
          // The most frequent job, one click from the first screen.
          waiting > 0 ? (
            <Link href={queue.find((q) => q.n > 0)!.href} className="btn inline-flex items-center">
              Review {waiting} waiting
            </Link>
          ) : (
            <Link href="/attendance" className="btn-quiet inline-flex items-center">
              Attendance report
            </Link>
          )
        }
      />

      <p className="mt-4 text-[12px] text-[var(--muted)]">
        {board.workDate} · {timezone}
        {board.holidayName ? ` · ${board.holidayName}` : ""}
      </p>

      <KpiStrip>
        <Kpi label="On the payroll" value={counts.employees} caption="active employees" />
        <Kpi label="Clocked in now" value={counts.in} caption="right now" tone={counts.in > 0 ? "positive" : undefined} />
        <Kpi label="Clocked out" value={counts.out} caption="finished today" />
        <Kpi label="On leave" value={counts.onLeave} caption="approved today" />
        <Kpi
          label="Late"
          value={counts.late}
          caption="past the grace period"
          tone={counts.late > 0 ? "warning" : undefined}
        />
        <Kpi
          label={board.pastExpectedEnd ? "Absent" : "Not in yet"}
          value={counts.absent}
          caption={board.pastExpectedEnd ? "day has ended" : `due by ${board.workDate ? "start" : "start"}`}
          tone={counts.absent > 0 && board.pastExpectedEnd ? "negative" : undefined}
        />
      </KpiStrip>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_384px]">
        <div className="min-w-0">
          <SectionHead
            action={
              board.rows.length > 6 ? (
                <Link href="/attendance" className="text-[13px] underline" style={{ color: "var(--accent-ink)" }}>
                  View all {board.rows.length}
                </Link>
              ) : undefined
            }
          >
            Who is in
          </SectionHead>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>State</th>
                  <th className="num">Since</th>
                  <th className="num">Today</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {board.rows.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <Empty>
                        No employees yet. Add your team on the Employees page, then they
                        sign in on the mobile app with the same email.
                      </Empty>
                    </td>
                  </tr>
                )}
                {/* Capped at 6: the sheet caps an overview list and links to the
                    full one, which also keeps this row level with the rail. */}
                {board.rows.slice(0, 6).map((r) => (
                  <tr key={r.memberId}>
                    <td>
                      <div className="font-medium">{r.fullName}</div>
                      <div className="text-[12px] text-[var(--muted)]">{r.email}</div>
                    </td>
                    <td>
                      <Pill kind={STATE[r.state].kind}>
                        {r.state === "on_leave" && r.leaveType
                          ? r.leaveType
                          : STATE[r.state].label}
                      </Pill>
                    </td>
                    <td className="num">{r.since ? time(r.since, timezone) : "-"}</td>
                    <td className="num">{r.totalMs ? duration(r.totalMs) : "-"}</td>
                    <td className="text-[12px] text-[var(--muted)]">
                      {[
                        r.isLate ? "late" : null,
                        r.sessions > 1 ? `${r.sessions} sessions` : null,
                        r.flagged ? "location not verified" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SectionHead>Leave taken</SectionHead>
          <div className="card px-4 py-4">
            {leaveYear === undefined ? (
              <Empty>Loading…</Empty>
            ) : (
              (() => {
                // Days taken against what the team could take. Both sides come
                // from the rows on screen, never a separately-held figure.
                const taken = leaveYear.reduce((sum, l) => sum + l.days, 0);
                const capacity = counts.employees * 14;
                const used = capacity > 0 ? Math.min(100, (taken / capacity) * 100) : 0;
                return (
                  <>
                    <p className="text-[12px] text-[var(--muted)]">Company-wide, {year}</p>
                    <div className="mt-1 text-[24px] tnum">
                      {taken}{" "}
                      <span className="text-[14px] text-[var(--muted)]">
                        of about {capacity} days
                      </span>
                    </div>
                    <div className="track mt-2">
                      <span style={{ width: `${used}%` }} />
                    </div>
                    <p className="mt-2 text-[12px] text-[var(--muted)]">
                      {capacity === 0
                        ? "No employees yet."
                        : `${Math.round(used)}% of the usual annual allowance across ${counts.employees} ${counts.employees === 1 ? "person" : "people"}.`}
                    </p>
                  </>
                );
              })()
            )}
          </div>
        </div>

        {/* The rail starts level with the first card, not with the title. */}
        <div className="min-w-0">
          <SectionHead>Waiting for you</SectionHead>
          <div className="card divide-y divide-[var(--rule)]">
            {queue.map((q) => (
              <Link
                key={q.href}
                href={q.href}
                className="flex h-[45px] items-center justify-between px-4 text-[14px] hover:bg-[var(--raised)]"
              >
                <span>{q.label}</span>
                {q.n > 0 ? (
                  <Pill kind="accent">{q.n}</Pill>
                ) : (
                  <span className="text-[var(--muted)]">0</span>
                )}
              </Link>
            ))}
            {waiting === 0 && <Empty>Nothing waiting. Everything is reviewed.</Empty>}
          </div>

          <SectionHead>Needs attention</SectionHead>
          <div className="card px-4 py-4">
            {needsAttention === 0 ? (
              <Empty>No unverified locations or missing clock-outs today.</Empty>
            ) : (
              <>
                <div className="text-[24px] tnum" style={{ color: "var(--negative)" }}>
                  {needsAttention}
                </div>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {counts.missingClockOut} missing clock-out
                  {counts.missingClockOut === 1 ? "" : "s"} · {counts.flagged} unverified
                  location{counts.flagged === 1 ? "" : "s"}
                </p>
                <Link
                  href="/attendance"
                  className="btn-quiet mt-4 inline-flex items-center"
                >
                  Open attendance
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
