"use client";

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Shell, { useOrg } from "./components/Shell";
import { time, duration } from "./lib/format";

// The "who is in" board. Reactive, so it updates itself as people clock in — the
// reason this product is on Convex at all (docs/PLAN.md).

export default function Page() {
  return (
    <Shell>
      <Board />
    </Shell>
  );
}

const STATE_LABEL: Record<string, string> = {
  in: "In",
  out: "Left",
  absent: "Not in",
  missing_clock_out: "No clock-out",
};

const STATE_STYLE: Record<string, string> = {
  in: "bg-green-100 text-green-900",
  out: "bg-neutral-100 text-neutral-700",
  absent: "bg-amber-100 text-amber-900",
  missing_clock_out: "bg-red-100 text-red-900",
};

function Board() {
  const { orgId, timezone } = useOrg();
  const board = useQuery(api.admin.todayBoard, { orgId });

  if (board === undefined) return <p className="text-neutral-500">Loading…</p>;

  const { counts } = board;

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Today</h1>
        <p className="text-sm text-neutral-500">
          {board.workDate} · {timezone}
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Employees" value={counts.employees} />
        <Stat label="Clocked in" value={counts.in} tone={counts.in > 0 ? "good" : undefined} />
        <Stat label="Left" value={counts.out} />
        {/* Before the working day ends, "not in" may just mean "not yet". */}
        <Stat
          label={board.pastExpectedEnd ? "Absent" : "Not in yet"}
          value={counts.absent}
          tone={counts.absent > 0 && board.pastExpectedEnd ? "warn" : undefined}
        />
        <Stat label="Late" value={counts.late} tone={counts.late > 0 ? "warn" : undefined} />
        <Stat
          label="Needs attention"
          value={counts.missingClockOut + counts.flagged}
          tone={counts.missingClockOut + counts.flagged > 0 ? "bad" : undefined}
        />
      </div>

      <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <Th>Employee</Th>
              <Th>State</Th>
              <Th>Since</Th>
              <Th>Today</Th>
              <Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {board.rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-neutral-500">
                  No employees yet — add your team on the Employees page.
                </td>
              </tr>
            )}
            {board.rows.map((r) => (
              <tr key={r.memberId} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.fullName}</div>
                  <div className="text-xs text-neutral-500">{r.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLE[r.state]}`}
                  >
                    {STATE_LABEL[r.state]}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.since ? time(r.since, timezone) : "—"}
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {r.totalMs ? duration(r.totalMs) : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-neutral-600">
                  {[
                    r.isLate ? "late" : null,
                    r.sessions > 1 ? `${r.sessions} sessions` : null,
                    r.flagged ? "location not verified" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad";
}) {
  const ring =
    tone === "bad"
      ? "ring-red-200"
      : tone === "warn"
        ? "ring-amber-200"
        : tone === "good"
          ? "ring-green-200"
          : "ring-neutral-200";
  return (
    <div className={`rounded-lg bg-white p-4 ring-1 ${ring}`}>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}
