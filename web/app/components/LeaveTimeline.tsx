"use client";

// The leave-timeline signature element, from the dealt sheet.
//
// Implemented in React rather than via the skill's imperative Charts.timeline():
// that helper is a vanilla IIFE expecting window.Charts, and wiring it into
// React-managed DOM needs a script tag, a load race and a cleanup path for a
// view I can render directly. The MARKS follow the sheet's spec exactly, which
// is the part that matters:
//
//   names in a 160-220px column, 32px pitch for one-line names
//   days across, weekends one tone step darker, faint 1px day lines
//   today a 1px line in the one data hue, its date in ink in the header
//   bars 20-24px tall at radius 4, the label inside the bar
//   EVERY KIND ITS OWN MARK, so sickness reads apart from a holiday at a glance:
//     paid leave   a pale fill of the hue
//     unpaid leave a darker grey step
//     pending      a dashed outline
//   full colour only for what needs a decision (a pending request)
//   a public holiday is a small dot under its date
//   the legend lists only kinds on screen, each swatch its own mark scaled down

type Row = {
  memberId: string;
  fullName: string;
  subline?: string | null;
  bookings: {
    id: string;
    startDate: string;
    endDate: string;
    label: string;
    kind: "paid" | "unpaid" | "pending";
  }[];
};

const NAME_COL = 180; // inside the sheet's 160-220px
const PITCH = 32; // one-line names
const BAR = 22; // inside the sheet's 20-24px
const DAY_MIN = 28;

const KINDS = {
  paid: { label: "Paid leave", fill: "var(--accent-track)", ink: "var(--accent-ink)", dashed: false, border: "transparent" },
  unpaid: { label: "Unpaid leave", fill: "var(--raised)", ink: "var(--text)", dashed: false, border: "var(--control)" },
  pending: { label: "Awaiting approval", fill: "transparent", ink: "var(--accent-ink)", dashed: true, border: "var(--accent)" },
} as const;

export default function LeaveTimeline({
  rows,
  from,
  to,
  today,
  weekendDays,
  holidays,
}: {
  rows: Row[];
  from: string;
  to: string;
  today: string;
  weekendDays: number[];
  holidays: { date: string; name: string }[];
}) {
  const days = datesBetween(from, to);
  const holidayByDate = new Map(holidays.map((h) => [h.date, h.name]));
  const weekend = new Set(weekendDays);

  // Only the kinds actually on screen get a legend entry.
  const present = new Set(rows.flatMap((r) => r.bookings.map((b) => b.kind)));

  if (rows.length === 0) {
    return (
      <div className="card px-4 py-8 text-[14px] text-[var(--muted)]">
        Nobody has approved or pending leave in this window.
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-4">
        {(["paid", "unpaid", "pending"] as const)
          .filter((k) => present.has(k))
          .map((k) => (
            <span key={k} className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
              {/* the swatch IS the mark, scaled down */}
              <span
                aria-hidden="true"
                style={{
                  width: 18,
                  height: 10,
                  borderRadius: 3,
                  background: KINDS[k].fill,
                  border: `1px ${KINDS[k].dashed ? "dashed" : "solid"} ${KINDS[k].border}`,
                  display: "inline-block",
                }}
              />
              {KINDS[k].label}
            </span>
          ))}
        {holidays.length > 0 && (
          <span className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
            <span
              aria-hidden="true"
              style={{ width: 5, height: 5, borderRadius: 999, background: "var(--muted)", display: "inline-block" }}
            />
            Public holiday
          </span>
        )}
      </div>

      <div className="card overflow-x-auto">
        <div style={{ minWidth: NAME_COL + days.length * DAY_MIN }}>
          {/* Header: the dates. Today's is in ink; the rest are grey. */}
          <div className="flex border-b border-[var(--rule)]">
            <div style={{ width: NAME_COL, flexShrink: 0 }} className="px-4 py-2 text-[12px] text-[var(--muted)]">
              {rows.length} {rows.length === 1 ? "person" : "people"}
            </div>
            {days.map((d) => {
              const isToday = d === today;
              const isWeekend = weekend.has(dayOfWeek(d));
              return (
                <div
                  key={d}
                  className="flex-1 py-2 text-center"
                  style={{
                    minWidth: DAY_MIN,
                    background: isWeekend ? "var(--raised)" : undefined,
                    borderLeft: isToday ? "1px solid var(--accent)" : "1px solid var(--rule)",
                  }}
                  title={holidayByDate.get(d) ?? undefined}
                >
                  <div
                    className="text-[11px] tnum"
                    style={{ color: isToday ? "var(--text)" : "var(--muted)", fontWeight: isToday ? 600 : 400 }}
                  >
                    {d.slice(8)}
                  </div>
                  {holidayByDate.has(d) && (
                    <span
                      aria-hidden="true"
                      style={{
                        display: "inline-block",
                        width: 4,
                        height: 4,
                        borderRadius: 999,
                        background: "var(--muted)",
                        marginTop: 2,
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {rows.map((r) => (
            <div key={r.memberId} className="flex border-b border-[var(--rule)] last:border-0">
              <div
                style={{ width: NAME_COL, flexShrink: 0, height: r.subline ? 42 : PITCH }}
                className="flex flex-col justify-center px-4"
              >
                <span className="truncate text-[13px]">{r.fullName}</span>
                {r.subline && (
                  <span className="truncate text-[11px] text-[var(--muted)]">{r.subline}</span>
                )}
              </div>

              <div className="relative flex flex-1">
                {days.map((d) => (
                  <div
                    key={d}
                    className="flex-1"
                    style={{
                      minWidth: DAY_MIN,
                      background: weekend.has(dayOfWeek(d)) ? "var(--raised)" : undefined,
                      borderLeft:
                        d === today ? "1px solid var(--accent)" : "1px solid var(--rule)",
                    }}
                  />
                ))}

                {/* Bars are positioned as a percentage of the window, so they
                    stay aligned with the day columns at any width. */}
                {r.bookings.map((b) => {
                  const startIdx = Math.max(0, days.indexOf(clamp(b.startDate, from, to)));
                  const endIdx = Math.max(startIdx, days.indexOf(clamp(b.endDate, from, to)));
                  const span = endIdx - startIdx + 1;
                  const k = KINDS[b.kind];
                  // A bar under ~56px cannot hold a word, so it shows nothing and
                  // the label lives in the tooltip. Never printed over the days
                  // before it.
                  const wide = span >= 2;
                  return (
                    <div
                      key={b.id}
                      title={`${b.label} · ${b.startDate}${b.endDate !== b.startDate ? ` to ${b.endDate}` : ""}`}
                      className="absolute flex items-center overflow-hidden px-2"
                      style={{
                        left: `${(startIdx / days.length) * 100}%`,
                        width: `${(span / days.length) * 100}%`,
                        top: ((r.subline ? 42 : PITCH) - BAR) / 2,
                        height: BAR,
                        borderRadius: 4,
                        background: k.fill,
                        border: `1px ${k.dashed ? "dashed" : "solid"} ${k.border}`,
                        color: k.ink,
                      }}
                    >
                      {wide && (
                        <span className="truncate text-[11px] font-medium">{b.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function datesBetween(from: string, to: string): string[] {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  const out: string[] = [];
  // Capped so a wide range cannot render thousands of columns.
  for (let t = a; t <= b && out.length < 120; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function dayOfWeek(date: string): number {
  return new Date(Date.parse(`${date}T00:00:00Z`)).getUTCDay();
}

const clamp = (d: string, lo: string, hi: string) => (d < lo ? lo : d > hi ? hi : d);
