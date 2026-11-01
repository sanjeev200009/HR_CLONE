"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, BUTTON_QUIET, Field, Th, clean } from "../components/ui";
import { todayIso } from "../lib/format";
import LeaveTimeline from "../components/LeaveTimeline";
import { downloadCsv, slug } from "../lib/csv";

export default function Page() {
  return (
    <Shell>
      <Leave />
    </Shell>
  );
}

type Tab = "requests" | "calendar" | "types" | "holidays";

function Leave() {
  const [tab, setTab] = useState<Tab>("requests");
  return (
    <>
      <h1 className="text-[24px] font-semibold">Leave</h1>
      <div className="mt-4 flex gap-1 overflow-x-auto">
        {(
          [
            ["requests", "Requests"],
            ["calendar", "Who's off"],
            ["types", "Leave types"],
            ["holidays", "Public holidays"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${
              tab === k ? "bg-[var(--accent-soft)] text-[var(--accent-ink)]" : "text-[var(--muted)] hover:bg-[var(--raised)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "requests" && <Requests />}
        {tab === "calendar" && <Calendar />}
        {tab === "types" && <Types />}
        {tab === "holidays" && <Holidays />}
      </div>
    </>
  );
}

function Requests() {
  const { orgId, orgName } = useOrg();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "cancelled">("pending");
  const rows = useQuery(api.leave.pending, { orgId, status });
  const review = useMutation(api.leave.review);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});

  async function act(requestId: Id<"leaveRequests">, approve: boolean) {
    setError(null);
    try {
      await review({ orgId, requestId, approve, note: note[requestId] });
    } catch (e) {
      setError(clean(e));
    }
  }

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const header = [
      "Employee", "Email", "Leave type", "From", "To", "Days", "Half day",
      "Status", "Reason", "Reviewed at", "Review note",
    ];
    const body = rows.map((r) => [
      r.fullName,
      r.email,
      r.typeName,
      r.startDate,
      r.endDate,
      r.days,
      r.halfDay ?? "",
      r.status,
      r.reason,
      r.reviewedAt ? new Date(r.reviewedAt).toISOString().slice(0, 10) : "",
      r.reviewNote ?? "",
    ]);
    downloadCsv([header, ...body], `leave-${slug(orgName)}-${status}.csv`);
  }

  return (
    <>
      <div className="mb-3 flex items-center gap-1">
        {(["pending", "approved", "rejected", "cancelled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded px-2.5 py-1 text-xs capitalize ${
              status === s ? "bg-[var(--accent-soft)] text-[var(--accent-ink)] font-medium" : "text-[var(--muted)] hover:bg-[var(--raised)]"
            }`}
          >
            {s}
          </button>
        ))}
        <button
          className={`${BUTTON_QUIET} ml-auto`}
          disabled={!rows || rows.length === 0}
          onClick={exportCsv}
        >
          Export CSV
        </button>
      </div>
      {error && <p className="mb-3 text-sm text-[var(--negative)]">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead className="">
            <tr><Th>Employee</Th><Th>Type</Th><Th>Dates</Th><Th>Days</Th><Th>Reason</Th><Th> </Th></tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r._id} className="align-top">
                <td className="">
                  <div className="font-medium">{r.fullName}</div>
                  <div className="text-xs text-[var(--muted)]">{r.email}</div>
                </td>
                <td className="">{r.typeName}</td>
                <td className="num">
                  {r.startDate}
                  {r.endDate !== r.startDate ? ` → ${r.endDate}` : ""}
                  {r.halfDay && <div className="text-xs text-[var(--muted)]">{r.halfDay} half day</div>}
                </td>
                <td className="num">{r.days}</td>
                <td className="text-[var(--text)]">
                  {r.reason}
                  {r.reviewNote && (
                    <div className="mt-1 text-xs text-[var(--muted)]">Note: {r.reviewNote}</div>
                  )}
                </td>
                <td className="">
                  {r.status === "pending" ? (
                    <div className="flex flex-col items-end gap-2">
                      <input
                        className="w-40 rounded border border-[var(--control)] px-2 py-1 text-xs"
                        placeholder="note (optional)"
                        value={note[r._id] ?? ""}
                        onChange={(e) => setNote({ ...note, [r._id]: e.target.value })}
                      />
                      <div className="flex gap-2">
                        <button className={BUTTON} onClick={() => act(r._id, true)}>Approve</button>
                        <button className={BUTTON_QUIET} onClick={() => act(r._id, false)}>Reject</button>
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">{r.status}</span>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-[var(--muted)]">
                {status === "pending" ? "Nothing waiting for you." : `No ${status} requests.`}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Calendar() {
  const { orgId, timezone } = useOrg();
  const [from, setFrom] = useState(() => todayIso(timezone));
  const [to, setTo] = useState(() => addDays(todayIso(timezone), 27));
  const rows = useQuery(api.leave.calendar, { orgId, from, to });
  const settings = useQuery(api.settings.get, { orgId });
  const holidays = useQuery(api.leave.holidays, { orgId });
  const types = useQuery(api.leave.types, { orgId });
  const pending = useQuery(api.leave.pending, { orgId, status: "pending" });

  const today = todayIso(timezone);
  const paidByType = new Map((types ?? []).map((t) => [t.name, t.isPaid]));

  // One row per person, their bookings grouped. Approved leave and pending
  // requests share the timeline, because the question an admin has is "who is
  // away, and what is still undecided".
  const byPerson = new Map<
    string,
    { memberId: string; fullName: string; bookings: { id: string; startDate: string; endDate: string; label: string; kind: "paid" | "unpaid" | "pending" }[] }
  >();

  for (const r of rows ?? []) {
    const e = byPerson.get(r.fullName) ?? { memberId: r.fullName, fullName: r.fullName, bookings: [] };
    e.bookings.push({
      id: r._id,
      startDate: r.startDate,
      endDate: r.endDate,
      label: r.typeName,
      kind: paidByType.get(r.typeName) === false ? "unpaid" : "paid",
    });
    byPerson.set(r.fullName, e);
  }
  for (const p of pending ?? []) {
    if (p.endDate < from || p.startDate > to) continue;
    const e = byPerson.get(p.fullName) ?? { memberId: p.fullName, fullName: p.fullName, bookings: [] };
    e.bookings.push({
      id: p._id,
      startDate: p.startDate,
      endDate: p.endDate,
      label: p.typeName,
      kind: "pending",
    });
    byPerson.set(p.fullName, e);
  }

  const timelineRows = [...byPerson.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  const awayToday = timelineRows.filter((r) =>
    r.bookings.some((b) => b.kind !== "pending" && b.startDate <= today && b.endDate >= today),
  ).length;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold">Who is off</h2>
          {/* The finding, beside the thing it is about. */}
          <p className="mt-1 text-[14px] text-[var(--muted)]">
            {awayToday === 0
              ? "Nobody is off today."
              : `${awayToday} ${awayToday === 1 ? "person is" : "people are"} off today.`}
            {(pending ?? []).length > 0
              ? ` ${(pending ?? []).length} request${(pending ?? []).length === 1 ? "" : "s"} still undecided.`
              : ""}
          </p>
        </div>
        <div className="flex gap-3">
          <Field label="From"><input type="date" className={INPUT} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className={INPUT} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
      </div>

      <LeaveTimeline
        rows={timelineRows}
        from={from}
        to={to}
        today={today}
        weekendDays={settings?.weekendDays ?? [0, 6]}
        holidays={(holidays ?? []).filter((h) => h.date >= from && h.date <= to)}
      />
    </>
  );
}

function Types() {
  const { orgId } = useOrg();
  const types = useQuery(api.leave.types, { orgId });
  const upsert = useMutation(api.leave.upsertType);
  const [f, setF] = useState({
    name: "", daysPerYear: "14", carryForwardMax: "7",
    accrualMode: "upfront" as "upfront" | "monthly",
    isPaid: true, requiresApproval: true, allowHalfDay: true,
  });
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead className="">
            <tr><Th>Name</Th><Th>Days/year</Th><Th>Accrual</Th><Th>Carry forward</Th><Th>Paid</Th><Th>Half days</Th><Th>Active</Th></tr>
          </thead>
          <tbody>
            {(types ?? []).map((t) => (
              <tr key={t._id} className="">
                <td className="font-medium">{t.name}</td>
                <td className="num">{t.daysPerYear}</td>
                <td className="">{t.accrualMode}</td>
                <td className="num">{t.carryForwardMax || "none"}</td>
                <td className="">{t.isPaid ? "yes" : "no"}</td>
                <td className="">{t.allowHalfDay ? "yes" : "no"}</td>
                <td className="">
                  <button
                    className="text-xs text-[var(--accent-ink)] hover:underline"
                    onClick={() =>
                      upsert({
                        orgId,
                        leaveTypeId: t._id,
                        name: t.name,
                        daysPerYear: t.daysPerYear,
                        isPaid: t.isPaid,
                        carryForwardMax: t.carryForwardMax,
                        accrualMode: t.accrualMode,
                        requiresApproval: t.requiresApproval,
                        allowHalfDay: t.allowHalfDay,
                        isActive: !t.isActive,
                      }).catch((e) => setError(clean(e)))
                    }
                  >
                    {t.isActive ? "yes" : "no"}
                  </button>
                </td>
              </tr>
            ))}
            {types?.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-[var(--muted)]">
                No leave types yet, nobody can request leave until you add one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <form
        className="mt-4 grid gap-3 rounded-lg border border-[var(--rule)] bg-white p-4 sm:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await upsert({
              orgId, name: f.name,
              daysPerYear: Number(f.daysPerYear),
              carryForwardMax: Number(f.carryForwardMax),
              accrualMode: f.accrualMode,
              isPaid: f.isPaid, requiresApproval: f.requiresApproval,
              allowHalfDay: f.allowHalfDay, isActive: true,
            });
            setF({ ...f, name: "" });
          } catch (err) { setError(clean(err)); }
        }}
      >
        <Field label="Name"><input required className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Annual" /></Field>
        <Field label="Days per year"><input required type="number" min={0} max={365} className={INPUT} value={f.daysPerYear} onChange={(e) => setF({ ...f, daysPerYear: e.target.value })} /></Field>
        <Field label="Carry forward max"><input required type="number" min={0} className={INPUT} value={f.carryForwardMax} onChange={(e) => setF({ ...f, carryForwardMax: e.target.value })} /></Field>
        <Field label="Accrual">
          <select className={INPUT} value={f.accrualMode} onChange={(e) => setF({ ...f, accrualMode: e.target.value as "upfront" | "monthly" })}>
            <option value="upfront">All at year start</option>
            <option value="monthly">Monthly</option>
          </select>
        </Field>
        <div className="sm:col-span-4 flex flex-wrap items-center gap-4 text-sm">
          <Check label="Paid" checked={f.isPaid} onChange={(v) => setF({ ...f, isPaid: v })} />
          <Check label="Needs approval" checked={f.requiresApproval} onChange={(v) => setF({ ...f, requiresApproval: v })} />
          <Check label="Allow half days" checked={f.allowHalfDay} onChange={(v) => setF({ ...f, allowHalfDay: v })} />
        </div>
        <div className="sm:col-span-4">
          <p className="mb-2 text-xs text-[var(--muted)]">
            Monthly accrual stops a November joiner receiving a full year on their
            first day. Carry-forward of 0 means use it or lose it.
          </p>
          {error && <p className="mb-2 text-sm text-[var(--negative)]">{error}</p>}
          <button className={BUTTON}>Add leave type</button>
        </div>
      </form>
    </>
  );
}

function Holidays() {
  const { orgId, timezone } = useOrg();
  const year = Number(todayIso(timezone).slice(0, 4));
  const rows = useQuery(api.leave.holidays, { orgId, year });
  const add = useMutation(api.leave.addHoliday);
  const remove = useMutation(api.leave.removeHoliday);
  const [f, setF] = useState({ date: "", name: "" });
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <p className="mb-3 text-sm text-[var(--muted)]">
        A public holiday inside a leave request is not deducted from the employee&apos;s
        balance. Sri Lanka has Poya days every month, so this list matters.
      </p>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead className=""><tr><Th>Date</Th><Th>Name</Th><Th> </Th></tr></thead>
          <tbody>
            {(rows ?? []).map((h) => (
              <tr key={h._id} className="">
                <td className="num">{h.date}</td>
                <td className="">{h.name}</td>
                <td className="text-right">
                  <button className="text-xs text-[var(--accent-ink)] hover:underline"
                    onClick={() => remove({ orgId, holidayId: h._id }).catch((e) => setError(clean(e)))}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr><td colSpan={3} className="px-4 py-8 text-[var(--muted)]">No holidays set for {year}.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <form
        className="mt-4 grid gap-3 rounded-lg border border-[var(--rule)] bg-white p-4 sm:grid-cols-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await add({ orgId, date: f.date, name: f.name });
            setF({ date: "", name: "" });
          } catch (err) { setError(clean(err)); }
        }}
      >
        <Field label="Date"><input required type="date" className={INPUT} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Name"><input required className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Vesak Full Moon Poya" /></Field>
        <div className="flex items-end">
          <button className={BUTTON}>Add holiday</button>
        </div>
        {error && <p className="text-sm text-[var(--negative)] sm:col-span-3">{error}</p>}
      </form>
    </>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
