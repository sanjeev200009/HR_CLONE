"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, BUTTON_QUIET, Field, Th, clean } from "../components/ui";
import { time, duration, todayIso, monthStartIso } from "../lib/format";
import { downloadCsv as writeCsv, slug } from "../lib/csv";

export default function Page() {
  return (
    <Shell>
      <Attendance />
    </Shell>
  );
}

function Attendance() {
  const { orgId, orgName, timezone } = useOrg();
  const employees = useQuery(api.employees.list, { orgId });

  const [from, setFrom] = useState(() => monthStartIso(timezone));
  const [to, setTo] = useState(() => todayIso(timezone));
  const [memberId, setMemberId] = useState("");

  const rows = useQuery(api.admin.attendanceRange, {
    orgId,
    from,
    to,
    memberId: memberId ? (memberId as Id<"members">) : undefined,
  });

  const totalMs = (rows ?? []).reduce((sum, r) => sum + r.workedMs, 0);

  return (
    <>
      <h1 className="text-[24px] font-semibold">Attendance</h1>

      <div className="mt-6 grid gap-3 rounded-lg border border-[var(--rule)] bg-white p-4 sm:grid-cols-4">
        <Field label="From">
          <input type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Employee">
          <select className={INPUT} value={memberId} onChange={(e) => setMemberId(e.target.value)}>
            <option value="">Everyone</option>
            {(employees ?? []).map((m) => (
              <option key={m._id} value={m._id}>
                {m.fullName}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end gap-2">
          <button
            className={BUTTON}
            disabled={!rows || rows.length === 0}
            onClick={() => rows && downloadCsv(rows, timezone, orgName, from, to)}
          >
            Export CSV
          </button>
          <button
            className={BUTTON_QUIET}
            onClick={() => {
              setFrom(monthStartIso(timezone));
              setTo(todayIso(timezone));
              setMemberId("");
            }}
          >
            This month
          </button>
        </div>
      </div>

      {rows === undefined ? (
        <p className="mt-6 text-[var(--muted)]">Loading…</p>
      ) : (
        <>
          <p className="mt-6 text-sm text-[var(--muted)]">
            {rows.length} record{rows.length === 1 ? "" : "s"} · {duration(totalMs)} total ·
            times shown in {timezone}
          </p>

          <div className="card mt-6 overflow-x-auto">
            <table className="tbl">
              <thead className="">
                <tr>
                  <Th>Date</Th>
                  <Th>Employee</Th>
                  <Th>In</Th>
                  <Th>Out</Th>
                  <Th>Worked</Th>
                  <Th>Verification</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r._id} className="">
                    <td className="num">{r.workDate}</td>
                    <td className="">{r.fullName}</td>
                    <td className="num">
                      {time(r.clockInAt, timezone)}
                      {r.isLate && <span className="ml-1 text-xs text-[var(--warning)]">late</span>}
                    </td>
                    <td className="num">
                      {r.clockOutAt ? (
                        time(r.clockOutAt, timezone)
                      ) : (
                        <span className="text-[var(--negative)]">missing</span>
                      )}
                    </td>
                    <td className="num">{duration(r.workedMs)}</td>
                    <td className="text-xs">
                      <Verification
                        status={r.clockInStatus}
                        distanceM={r.clockInDistanceM}
                        label="in"
                      />
                      {r.clockOutStatus && (
                        <Verification
                          status={r.clockOutStatus}
                          distanceM={r.clockOutDistanceM}
                          label="out"
                        />
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-[var(--muted)]">
                      Nothing in this range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function Verification({
  status,
  distanceM,
  label,
}: {
  status: string;
  distanceM: number | null;
  label: string;
}) {
  if (status === "verified") {
    return (
      <div className="text-[var(--positive)]">
        {label}: at workplace{distanceM !== null ? ` (${distanceM}m)` : ""}
      </div>
    );
  }
  const words: Record<string, string> = {
    out_of_range: distanceM !== null ? `${distanceM}m away` : "outside workplace",
    low_accuracy: "location too imprecise",
    no_location: "no location",
    suspect_mocked: "location reported as simulated",
  };
  return <div className="text-[var(--warning)]">{label}: {words[status] ?? status}</div>;
}

/** Build the attendance report rows and hand them to the shared CSV writer. */
function downloadCsv(
  rows: NonNullable<ReturnType<typeof useQuery<typeof api.admin.attendanceRange>>>,
  timezone: string,
  orgName: string,
  from: string,
  to: string,
) {
  const header = [
    "Date", "Employee", "Email", "Clock in", "Clock out", "Worked hours",
    "Late", "Missed clock-out", "In verification", "In distance (m)",
    "Out verification", "Out distance (m)", "In lat", "In lng", "Out lat", "Out lng", "Device",
  ];

  const body = rows.map((r) => [
    r.workDate,
    r.fullName,
    r.email,
    time(r.clockInAt, timezone),
    r.clockOutAt ? time(r.clockOutAt, timezone) : "",
    (r.workedMs / 3_600_000).toFixed(2),
    r.isLate ? "yes" : "no",
    r.missedClockOut ? "yes" : "no",
    r.clockInStatus,
    r.clockInDistanceM ?? "",
    r.clockOutStatus ?? "",
    r.clockOutDistanceM ?? "",
    r.clockInLat ?? "",
    r.clockInLng ?? "",
    r.clockOutLat ?? "",
    r.clockOutLng ?? "",
    r.device ?? "",
  ]);

  writeCsv([header, ...body], `attendance-${slug(orgName)}-${from}-to-${to}.csv`);
}
