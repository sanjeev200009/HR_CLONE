"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { BUTTON, BUTTON_QUIET, Th, clean } from "../components/ui";
import { time } from "../lib/format";

export default function Page() {
  return (
    <Shell>
      <Corrections />
    </Shell>
  );
}

type Status = "pending" | "approved" | "rejected";

function Corrections() {
  const { orgId, timezone } = useOrg();
  const [status, setStatus] = useState<Status>("pending");
  const rows = useQuery(api.corrections.list, { orgId, status });
  const review = useMutation(api.corrections.review);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(correctionId: Id<"corrections">, approve: boolean) {
    setError(null);
    setBusy(correctionId);
    try {
      await review({ orgId, correctionId, approve });
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Corrections</h1>
      <p className="mt-1 text-sm text-neutral-600">
        An employee asks, you decide. Approving changes the stored time and writes the
        before and after into the audit log.
      </p>

      <div className="mt-4 flex gap-1">
        {(["pending", "approved", "rejected"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded px-3 py-1.5 text-sm capitalize ${
              status === s ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <Th>Employee</Th>
              <Th>Day</Th>
              <Th>Currently</Th>
              <Th>Requested</Th>
              <Th>Reason</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => {
              const change = r.requestedChange as { clockInAt?: number; clockOutAt?: number };
              return (
                <tr key={r._id} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-3 font-medium">{r.fullName}</td>
                  <td className="px-4 py-3 tabular-nums">{r.workDate ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {r.currentClockInAt ? time(r.currentClockInAt, timezone) : "—"} –{" "}
                    {r.currentClockOutAt ? (
                      time(r.currentClockOutAt, timezone)
                    ) : (
                      <span className="text-red-700">missing</span>
                    )}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {change.clockInAt !== undefined && (
                      <div>in → {time(change.clockInAt, timezone)}</div>
                    )}
                    {change.clockOutAt !== undefined && (
                      <div>out → {time(change.clockOutAt, timezone)}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">{r.reason}</td>
                  <td className="px-4 py-3 text-right">
                    {r.status === "pending" ? (
                      <div className="flex justify-end gap-2">
                        <button
                          className={BUTTON}
                          disabled={busy === r._id}
                          onClick={() => act(r._id, true)}
                        >
                          Approve
                        </button>
                        <button
                          className={BUTTON_QUIET}
                          disabled={busy === r._id}
                          onClick={() => act(r._id, false)}
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-neutral-500">
                        {r.status}
                        {r.reviewedAt ? ` · ${time(r.reviewedAt, timezone)}` : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-neutral-500">
                  {status === "pending" ? "Nothing waiting for you." : `No ${status} corrections.`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
