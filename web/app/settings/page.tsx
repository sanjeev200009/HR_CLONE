"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, Field, TitleRow, clean } from "../components/ui";

// Settings in two columns (the dealt style's §5 settings pattern): a ~450px
// label column beside a ~700px panel on a #fafafa fill, sections split by a
// full-width rule with 32px above and below.
//
// Where a panel runs much taller than its label, the label column carries the
// section's help rather than 250px of nothing — which is why each description
// below says what the setting actually changes.

export default function Page() {
  return (
    <Shell>
      <Settings />
    </Shell>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Settings() {
  const { orgId } = useOrg();
  const current = useQuery(api.settings.get, { orgId });
  const save = useMutation(api.settings.save);

  const [f, setF] = useState<null | {
    name: string;
    companyEmail: string;
    companyAddress: string;
    timezone: string;
    expectedStart: string;
    expectedEnd: string;
    graceMinutes: string;
    minHours: string;
    maxAccuracyM: string;
    weekendDays: number[];
    leaveYearStartMonth: string;
  }>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (current && f === null) {
      setF({
        name: current.name,
        companyEmail: current.companyEmail ?? "",
        companyAddress: current.companyAddress ?? "",
        timezone: current.timezone,
        expectedStart: current.expectedStart,
        expectedEnd: current.expectedEnd,
        graceMinutes: String(current.graceMinutes),
        minHours: String(current.minHours),
        maxAccuracyM: String(current.maxAccuracyM),
        weekendDays: current.weekendDays,
        leaveYearStartMonth: String(current.leaveYearStartMonth),
      });
    }
  }, [current, f]);

  if (!f) return <p className="text-[var(--muted)]">Loading…</p>;

  async function submit() {
    // Captured so TypeScript keeps the narrowing inside the async closure.
    const v = f;
    if (!v) return;
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await save({
        orgId,
        name: v.name,
        companyEmail: v.companyEmail || undefined,
        companyAddress: v.companyAddress || undefined,
        timezone: v.timezone,
        expectedStart: v.expectedStart,
        expectedEnd: v.expectedEnd,
        graceMinutes: Number(v.graceMinutes),
        minHours: Number(v.minHours),
        maxAccuracyM: Number(v.maxAccuracyM),
        weekendDays: v.weekendDays,
        leaveYearStartMonth: Number(v.leaveYearStartMonth),
      });
      setSaved(true);
    } catch (e) {
      setError(clean(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1152px]">
      <TitleRow
        title="Settings"
        sub="These rules decide who is marked late, how long a week is, and how leave is counted."
      />

      <Section
        title="Company"
        description="The name shown to your team in the app and on their payslips."
      >
        <Field label="Company name">
          <input className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Company email">
          <input className={INPUT} value={f.companyEmail} onChange={(e) => setF({ ...f, companyEmail: e.target.value })} />
        </Field>
        <Field label="Address">
          <input className={INPUT} value={f.companyAddress} onChange={(e) => setF({ ...f, companyAddress: e.target.value })} />
        </Field>
      </Section>

      <Section
        title="The working day"
        description="Arrivals after the start time plus the grace period are marked late. A public holiday or a weekend is never late, whatever time someone clocks in."
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Day starts">
            <input className={INPUT} value={f.expectedStart} onChange={(e) => setF({ ...f, expectedStart: e.target.value })} placeholder="09:00" />
          </Field>
          <Field label="Day ends">
            <input className={INPUT} value={f.expectedEnd} onChange={(e) => setF({ ...f, expectedEnd: e.target.value })} placeholder="17:30" />
          </Field>
          <Field label="Grace period (minutes)" hint="0–240">
            <input className={INPUT} type="number" min={0} max={240} value={f.graceMinutes} onChange={(e) => setF({ ...f, graceMinutes: e.target.value })} />
          </Field>
          <Field label="Minimum hours a day">
            <input className={INPUT} type="number" min={0} max={24} value={f.minHours} onChange={(e) => setF({ ...f, minHours: e.target.value })} />
          </Field>
        </div>
      </Section>

      <Section
        title="The working week"
        description="Weekends are not deducted from leave: Friday to Monday off costs 2 days, not 4. Change this if your week is not Saturday and Sunday."
      >
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const on = f.weekendDays.includes(i);
            return (
              <button
                key={d}
                type="button"
                onClick={() =>
                  setF({
                    ...f,
                    weekendDays: on
                      ? f.weekendDays.filter((x) => x !== i)
                      : [...f.weekendDays, i].sort(),
                  })
                }
                className="rounded-[6px] border px-3 py-1.5 text-[13px]"
                style={
                  on
                    ? { background: "var(--accent-soft)", color: "var(--accent-ink)", borderColor: "var(--accent-track)", fontWeight: 500 }
                    : { borderColor: "var(--control)", color: "var(--muted)" }
                }
              >
                {d}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] text-[var(--muted)]">
          Selected days are the weekend. The whole week cannot be the weekend.
        </p>
      </Section>

      <Section
        title="Leave year"
        description="Balances reset at the start of this month. Pick April if your company runs an April–March year, or leave balances will reset three months early."
      >
        <Field label="Leave year starts in">
          <select className={INPUT} value={f.leaveYearStartMonth} onChange={(e) => setF({ ...f, leaveYearStartMonth: e.target.value })}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section
        title="Location checks"
        description="A GPS fix less precise than this is recorded but not treated as verified. Phone GPS is 10–20m outdoors at best and much worse indoors, so a tight limit rejects people who really are at work."
      >
        <Field label="Reject fixes less accurate than (metres)" hint="20–2000">
          <input className={INPUT} type="number" min={20} max={2000} value={f.maxAccuracyM} onChange={(e) => setF({ ...f, maxAccuracyM: e.target.value })} />
        </Field>
      </Section>

      <Section
        title="Timezone"
        description="Every work date, late mark and report is computed in this timezone, not in your browser's. Changing it changes how past days are grouped."
      >
        <Field label="IANA timezone">
          <input className={INPUT} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} placeholder="Asia/Colombo" />
        </Field>
      </Section>

      <div className="mt-8 flex items-center gap-4 border-t border-[var(--rule)] pt-6">
        <button className={BUTTON} onClick={submit} disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {saved && <span className="text-[14px]" style={{ color: "var(--positive)" }}>Saved.</span>}
        {error && <span className="text-[14px]" style={{ color: "var(--negative)" }}>{error}</span>}
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-t border-[var(--rule)] py-8 first-of-type:border-t-0">
      <div className="grid gap-6 lg:grid-cols-[450px_1fr]">
        <div>
          <h2 className="text-[16px] font-medium">{title}</h2>
          <p className="mt-1 max-w-[380px] text-[14px] text-[var(--muted)]">{description}</p>
        </div>
        <div className="rounded-[16px] bg-[#fafafa] p-4">{children}</div>
      </div>
    </div>
  );
}
