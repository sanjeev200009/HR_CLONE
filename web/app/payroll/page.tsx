"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, BUTTON_QUIET, Field, TitleRow, KpiStrip, Kpi, Pill, Empty, SectionHead, clean } from "../components/ui";
import { formatCents, toCents } from "../lib/money";

// Payroll.
//
// Its one question: "What does this month cost, and is it right?" The answer is
// the run's totals; the evidence beside it is the per-employee table with the
// deductions shown, because a net figure nobody can decompose is a net figure
// nobody signs off.

export default function Page() {
  return (
    <Shell>
      <Payroll />
    </Shell>
  );
}

type Tab = "run" | "salaries" | "rates";

function Payroll() {
  const [tab, setTab] = useState<Tab>("run");
  return (
    <>
      <TitleRow title="Payroll" sub="Hours and unpaid leave come from attendance. Nothing here is retyped." />
      <div className="mt-5 flex gap-1 border-b border-[var(--rule)]">
        {(
          [
            ["run", "Pay runs"],
            ["salaries", "Salaries"],
            ["rates", "Rates & tax"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="relative px-3 pb-2 text-[14px]"
            style={{ color: tab === k ? "var(--text)" : "var(--muted)", fontWeight: tab === k ? 500 : 400 }}
          >
            {label}
            {tab === k && (
              <span className="absolute inset-x-0 -bottom-px h-[2px]" style={{ background: "var(--text)" }} />
            )}
          </button>
        ))}
      </div>
      <div className="mt-6">
        {tab === "run" && <Runs />}
        {tab === "salaries" && <Salaries />}
        {tab === "rates" && <Rates />}
      </div>
    </>
  );
}

function Runs() {
  const { orgId } = useOrg();
  const runs = useQuery(api.payroll.runs, { orgId });
  const build = useMutation(api.payroll.buildRun);
  const finalise = useMutation(api.payroll.finalise);

  const [period, setPeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [open, setOpen] = useState<Id<"payRuns"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slips = useQuery(api.payroll.runPayslips, open ? { orgId, payRunId: open } : "skip");
  const current = runs?.find((r) => r._id === open) ?? null;

  async function doBuild() {
    setError(null);
    setBusy(true);
    try {
      const r = await build({ orgId, period });
      setOpen(r.runId);
      if (r.skipped > 0) {
        setError(
          `${r.skipped} employee${r.skipped === 1 ? "" : "s"} skipped, no salary on file. Set one on the Salaries tab.`,
        );
      }
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <div className="w-[180px]">
          <Field label="Period">
            <input className={INPUT} type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </Field>
        </div>
        <button className={BUTTON} onClick={doBuild} disabled={busy}>
          {busy ? "Calculating…" : "Calculate this month"}
        </button>
        <p className="text-[12px] text-[var(--muted)]">
          Recalculating a draft replaces it. A finalised run is never changed.
        </p>
      </div>

      {error && (
        <p className="mt-3 text-[14px]" style={{ color: "var(--warning)" }}>
          {error}
        </p>
      )}

      <SectionHead>Runs</SectionHead>
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              <th className="num">People</th>
              <th className="num">Gross</th>
              <th className="num">Net paid</th>
              <th className="num">Employer cost</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(runs ?? []).map((r) => (
              <tr key={r._id}>
                <td className="font-medium">{r.period}</td>
                <td>
                  <Pill kind={r.status === "finalised" ? "positive" : "neutral"}>{r.status}</Pill>
                </td>
                <td className="num">{r.totals.headcount}</td>
                <td className="num">{formatCents(r.totals.grossCents)}</td>
                <td className="num">{formatCents(r.totals.netCents)}</td>
                <td className="num">{formatCents(r.totals.employerCostCents)}</td>
                <td className="text-right">
                  <button className="text-[13px] underline" style={{ color: "var(--accent-ink)" }} onClick={() => setOpen(r._id)}>
                    {open === r._id ? "Hide" : "Open"}
                  </button>
                </td>
              </tr>
            ))}
            {runs?.length === 0 && (
              <tr>
                <td colSpan={7}>
                  <Empty>No pay runs yet. Pick a month above and calculate it.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {current && slips && (
        <>
          <KpiStrip>
            <Kpi label="People paid" value={current.totals.headcount} caption={current.period} />
            <Kpi label="Gross" value={formatCents(current.totals.grossCents)} caption="before deductions" />
            <Kpi label="Employee EPF" value={formatCents(current.totals.epfEmployeeCents)} caption="deducted from pay" />
            <Kpi label="PAYE" value={formatCents(current.totals.payeCents)} caption={slips.some((s) => !s.payeCalculated) ? "no bands configured" : "deducted from pay"} tone={slips.some((s) => !s.payeCalculated) ? "warning" : undefined} />
            <Kpi label="Net paid" value={formatCents(current.totals.netCents)} caption="to employees" />
            <Kpi label="Employer cost" value={formatCents(current.totals.employerCostCents)} caption="gross + EPF 12% + ETF 3%" />
          </KpiStrip>

          {slips.some((s) => !s.payeCalculated) && (
            <p className="mt-3 text-[14px]" style={{ color: "var(--warning)" }}>
              PAYE was not calculated: no tax bands are configured. Add them on the Rates
              &amp; tax tab, or these payslips carry no income tax.
            </p>
          )}

          <SectionHead
            action={
              current.status === "draft" ? (
                <button
                  className={BUTTON}
                  onClick={() => finalise({ orgId, payRunId: current._id }).catch((e) => setError(clean(e)))}
                >
                  Finalise {current.period}
                </button>
              ) : (
                <span className="text-[12px] text-[var(--muted)]">
                  Finalised. Employees can see these payslips
                </span>
              )
            }
          >
            Payslips · {current.period}
          </SectionHead>

          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th className="num">Basic</th>
                  <th className="num">Allowances</th>
                  <th className="num">Unpaid leave</th>
                  <th className="num">Overtime</th>
                  <th className="num">Gross</th>
                  <th className="num">EPF 8%</th>
                  <th className="num">PAYE</th>
                  <th className="num">Net</th>
                </tr>
              </thead>
              <tbody>
                {slips.map((p) => (
                  <tr key={p._id}>
                    <td className="font-medium">{p.fullName}</td>
                    <td className="num">{formatCents(p.basicCents)}</td>
                    <td className="num">{p.allowancesCents ? formatCents(p.allowancesCents) : "-"}</td>
                    <td className="num">
                      {p.unpaidLeaveDays > 0 ? (
                        <span style={{ color: "var(--negative)" }}>
                          −{formatCents(p.unpaidLeaveDeductionCents)}
                          <span className="block text-[12px] text-[var(--muted)]">
                            {p.unpaidLeaveDays}d
                          </span>
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="num">
                      {p.otHours > 0 ? (
                        <>
                          {formatCents(p.otPayCents)}
                          <span className="block text-[12px] text-[var(--muted)]">{p.otHours}h</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="num font-medium">{formatCents(p.grossCents)}</td>
                    <td className="num">−{formatCents(p.epfEmployeeCents)}</td>
                    <td className="num">{p.payeCalculated ? `−${formatCents(p.payeCents)}` : "-"}</td>
                    <td className="num font-medium">{formatCents(p.netCents)}</td>
                  </tr>
                ))}
                {slips.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <Empty>
                        No payslips in this run, nobody has a salary on file yet.
                      </Empty>
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

function Salaries() {
  const { orgId } = useOrg();
  const rows = useQuery(api.payroll.salaries, { orgId });
  const setSalary = useMutation(api.payroll.setSalary);

  const [editing, setEditing] = useState<Id<"members"> | null>(null);
  const [basic, setBasic] = useState("");
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);

  async function save(memberId: Id<"members">) {
    setError(null);
    try {
      await setSalary({
        orgId,
        memberId,
        basicCents: toCents(basic),
        allowances: [],
        effectiveFrom: from,
      });
      setEditing(null);
      setBasic("");
    } catch (e) {
      setError(clean(e));
    }
  }

  return (
    <>
      {error && <p className="mb-3 text-[14px]" style={{ color: "var(--negative)" }}>{error}</p>}
      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Role</th>
              <th className="num">Basic (monthly)</th>
              <th className="num">Effective from</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.memberId}>
                <td>
                  <div className="font-medium">{r.fullName}</div>
                  <div className="text-[12px] text-[var(--muted)]">{r.email}</div>
                </td>
                <td>{r.jobTitle ?? "-"}</td>
                <td className="num">
                  {r.basicCents === null ? (
                    <Pill kind="warning">not set</Pill>
                  ) : (
                    formatCents(r.basicCents)
                  )}
                </td>
                <td className="num">{r.effectiveFrom ?? "-"}</td>
                <td className="text-right">
                  {editing === r.memberId ? (
                    <div className="flex items-end justify-end gap-2">
                      <input
                        className={INPUT}
                        style={{ width: 140 }}
                        value={basic}
                        onChange={(e) => setBasic(e.target.value)}
                        placeholder="100000.00"
                      />
                      <input
                        className={INPUT}
                        style={{ width: 150 }}
                        type="date"
                        value={from}
                        onChange={(e) => setFrom(e.target.value)}
                      />
                      <button className={BUTTON} onClick={() => save(r.memberId)}>Save</button>
                      <button className={BUTTON_QUIET} onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      className="text-[13px] underline"
                      style={{ color: "var(--accent-ink)" }}
                      onClick={() => {
                        setEditing(r.memberId);
                        setBasic(r.basicCents !== null ? (r.basicCents / 100).toFixed(2) : "");
                      }}
                    >
                      {r.basicCents === null ? "Set salary" : "Change"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <Empty>No employees yet.</Empty>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] text-[var(--muted)]">
        A salary change is a new record, never an edit, so a payslip already issued
        stays explainable against the salary that produced it.
      </p>
    </>
  );
}

function Rates() {
  const { orgId } = useOrg();
  const cfg = useQuery(api.payroll.config, { orgId });
  const saveConfig = useMutation(api.payroll.saveConfig);

  const [f, setF] = useState<null | {
    epfEmployeePct: string;
    epfEmployerPct: string;
    etfEmployerPct: string;
    otMultiplier: string;
    workingDaysPerMonth: string;
    hoursPerDay: string;
    bands: { upTo: string; percent: string }[];
  }>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!cfg || f !== null) return;
    setF({
      epfEmployeePct: String(cfg.epfEmployeePct),
      epfEmployerPct: String(cfg.epfEmployerPct),
      etfEmployerPct: String(cfg.etfEmployerPct),
      otMultiplier: String(cfg.otMultiplier),
      workingDaysPerMonth: String(cfg.workingDaysPerMonth),
      hoursPerDay: String(cfg.hoursPerDay),
      bands: cfg.payeBands.map((b) => ({
        upTo: (b.upToCents / 100).toFixed(2),
        percent: String(b.percent),
      })),
    });
  }, [cfg, f]);

  if (!f) return <p className="text-[var(--muted)]">Loading…</p>;

  async function submit() {
    setError(null);
    setSaved(false);
    try {
      await saveConfig({
        orgId,
        currency: "LKR",
        epfEmployeePct: Number(f!.epfEmployeePct),
        epfEmployerPct: Number(f!.epfEmployerPct),
        etfEmployerPct: Number(f!.etfEmployerPct),
        otMultiplier: Number(f!.otMultiplier),
        workingDaysPerMonth: Number(f!.workingDaysPerMonth),
        hoursPerDay: Number(f!.hoursPerDay),
        payeBands: f!.bands
          .filter((b) => b.upTo && b.percent)
          .map((b) => ({ upToCents: toCents(b.upTo), percent: Number(b.percent) })),
      });
      setSaved(true);
    } catch (e) {
      setError(clean(e));
    }
  }

  return (
    <div className="max-w-[900px]">
      <div className="card p-4">
        <h2 className="text-[16px] font-medium">Statutory contributions</h2>
        <p className="mt-1 text-[14px] text-[var(--muted)]">
          Seeded with the usual Sri Lankan rates. Confirm them against the current
          regulations, this product does not know what the law says today.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
          <Field label="EPF employee %"><input className={INPUT} value={f.epfEmployeePct} onChange={(e) => setF({ ...f, epfEmployeePct: e.target.value })} /></Field>
          <Field label="EPF employer %"><input className={INPUT} value={f.epfEmployerPct} onChange={(e) => setF({ ...f, epfEmployerPct: e.target.value })} /></Field>
          <Field label="ETF employer %"><input className={INPUT} value={f.etfEmployerPct} onChange={(e) => setF({ ...f, etfEmployerPct: e.target.value })} /></Field>
          <Field label="Overtime multiplier"><input className={INPUT} value={f.otMultiplier} onChange={(e) => setF({ ...f, otMultiplier: e.target.value })} /></Field>
          <Field label="Working days a month" hint="turns a monthly salary into a daily rate"><input className={INPUT} value={f.workingDaysPerMonth} onChange={(e) => setF({ ...f, workingDaysPerMonth: e.target.value })} /></Field>
          <Field label="Hours a day" hint="hours beyond this are overtime"><input className={INPUT} value={f.hoursPerDay} onChange={(e) => setF({ ...f, hoursPerDay: e.target.value })} /></Field>
        </div>
        <p className="mt-3 text-[12px] text-[var(--muted)]">
          EPF applies to basic pay plus allowances you mark as EPF-liable. Transport and
          overtime are not EPF-liable by default.
        </p>
      </div>

      <div className="card mt-6 p-4">
        <h2 className="text-[16px] font-medium">PAYE bands</h2>
        <p className="mt-1 text-[14px] text-[var(--muted)]">
          Each band taxes only the income inside it. With no bands, no income tax is
          deducted and every payslip says so, this product will not invent a tax rate.
        </p>

        {f.bands.length === 0 && (
          <p className="mt-3 text-[14px]" style={{ color: "var(--warning)" }}>
            No bands configured. PAYE is currently zero on every payslip.
          </p>
        )}

        <div className="mt-4 space-y-3">
          {f.bands.map((b, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="w-[200px]">
                <Field label={i === 0 ? "Monthly income up to" : ""}>
                  <input className={INPUT} value={b.upTo} onChange={(e) => {
                    const bands = [...f.bands];
                    bands[i] = { ...b, upTo: e.target.value };
                    setF({ ...f, bands });
                  }} />
                </Field>
              </div>
              <div className="w-[120px]">
                <Field label={i === 0 ? "Taxed at %" : ""}>
                  <input className={INPUT} value={b.percent} onChange={(e) => {
                    const bands = [...f.bands];
                    bands[i] = { ...b, percent: e.target.value };
                    setF({ ...f, bands });
                  }} />
                </Field>
              </div>
              <button className={BUTTON_QUIET} onClick={() => setF({ ...f, bands: f.bands.filter((_, j) => j !== i) })}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <button
          className={`${BUTTON_QUIET} mt-3`}
          onClick={() => setF({ ...f, bands: [...f.bands, { upTo: "", percent: "" }] })}
        >
          Add a band
        </button>
      </div>

      <div className="mt-6 flex items-center gap-4">
        <button className={BUTTON} onClick={submit}>Save rates</button>
        {saved && <span className="text-[14px]" style={{ color: "var(--positive)" }}>Saved.</span>}
        {error && <span className="text-[14px]" style={{ color: "var(--negative)" }}>{error}</span>}
      </div>
    </div>
  );
}
