"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { BUTTON, BUTTON_QUIET, Th, clean } from "../components/ui";
import { duration } from "../lib/format";

export default function Page() {
  return (
    <Shell>
      <Timesheets />
    </Shell>
  );
}

type Status = "submitted" | "approved" | "rejected" | "draft";

function Timesheets() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<Status>("submitted");
  const rows = useQuery(api.timesheets.list, { orgId, status });
  const review = useMutation(api.timesheets.review);
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function act(timesheetId: Id<"timesheets">, approve: boolean) {
    setError(null);
    try {
      await review({ orgId, timesheetId, approve, note: note[timesheetId] });
    } catch (e) {
      setError(clean(e));
    }
  }

  return (
    <>
      <h1 className="text-[24px] font-semibold">Timesheets</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Hours are derived from clock in/out, never typed. A timesheet records only the
        weekly sign-off.
      </p>

      <div className="mt-4 flex gap-1">
        {(["submitted", "approved", "rejected", "draft"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1.5 text-sm capitalize ${
              status === s ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--raised)]"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[var(--negative)]">{error}</p>}

      <div className="card mt-6 overflow-x-auto">
        <table className="tbl">
          <thead className="">
            <tr>
              <Th>Employee</Th>
              <Th>Week</Th>
              <Th>Submitted total</Th>
              <Th>Current total</Th>
              <Th>Note</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((t) => (
              <tr key={t._id} className="align-top">
                <td className="">
                  <div className="font-medium">{t.fullName}</div>
                  <div className="text-xs text-[var(--muted)]">{t.email}</div>
                </td>
                <td className="num">{t.weekStart}</td>
                <td className="num">{duration(t.totalMs)}</td>
                <td className="num">
                  {duration(t.liveTotalMs)}
                  {/* A correction approved after submission moves the number. The
                      approver must see that, not silently approve different hours. */}
                  {t.changedSinceSubmission && (
                    <div className="text-xs text-[var(--warning)]">changed since submission</div>
                  )}
                </td>
                <td className="text-[var(--text)]">
                  {t.note ?? "-"}
                  {t.reviewNote && (
                    <div className="mt-1 text-xs text-[var(--muted)]">Review: {t.reviewNote}</div>
                  )}
                </td>
                <td className="">
                  {t.status === "submitted" ? (
                    <div className="flex flex-col items-end gap-2">
                      <input
                        className="w-44 rounded border border-[var(--control)] px-2 py-1 text-xs"
                        placeholder="reason (needed to reject)"
                        value={note[t._id] ?? ""}
                        onChange={(e) => setNote({ ...note, [t._id]: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button className={BUTTON} onClick={() => act(t._id, true)}>
                          Approve
                        </button>
                        <button className={BUTTON_QUIET} onClick={() => act(t._id, false)}>
                          Reject
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">{t.status}</span>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-[var(--muted)]">
                  {status === "submitted" ? "Nothing waiting for you." : `No ${status} timesheets.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
