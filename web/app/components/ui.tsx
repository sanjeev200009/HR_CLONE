import { ReactNode } from "react";

// Primitives mapped to the dealt style's tokens (app/globals.css). Classes, not
// inline Tailwind palettes, so the whole dashboard restyles from one file.

export const INPUT = "input";
export const BUTTON = "btn";
export const BUTTON_QUIET = "btn-quiet";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[14px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

export function Th({ children, num }: { children: ReactNode; num?: boolean }) {
  return <th className={num ? "num text-right" : undefined}>{children}</th>;
}

/** A page's title row: 24px noun, a grey line under it, the one action right. */
export function TitleRow({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[24px] font-semibold leading-tight">{title}</h1>
        {sub && <p className="mt-1 text-[14px] text-[var(--muted)]">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * The KPI strip: ONE container split by 1px dividers, not a row of cards.
 *
 * From the study: no screen puts an icon in a coloured circle on a KPI, and none
 * draws a sparkline on one. KPIs are type.
 */
export function KpiStrip({ children }: { children: ReactNode }) {
  return (
    <div className="card mt-6 grid grid-cols-2 divide-[var(--rule)] md:grid-cols-3 lg:grid-cols-6 lg:divide-x">
      {children}
    </div>
  );
}

export function Kpi({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: ReactNode;
  caption?: string;
  tone?: "positive" | "negative" | "warning";
}) {
  // Colour on a figure says good or bad, never merely up or down.
  const ink =
    tone === "negative"
      ? "var(--negative)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "positive"
          ? "var(--positive)"
          : "var(--text)";
  return (
    <div className="px-5 py-4">
      <div className="text-[14px] text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-[24px] tnum" style={{ color: ink }}>
        {value}
      </div>
      {caption && <div className="mt-1 text-[12px] text-[var(--muted)]">{caption}</div>}
    </div>
  );
}

/** A section heading that sits OUTSIDE its card, per the sheet's rail rule. */
export function SectionHead({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-8 flex items-end justify-between">
      <h2 className="text-[16px] font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Pill({ kind, children }: { kind: "positive" | "negative" | "warning" | "neutral" | "accent"; children: ReactNode }) {
  return <span className={`pill pill-${kind}`}>{children}</span>;
}

/** Empty, zero and loading states keep their frame — they never collapse. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-[14px] text-[var(--muted)]">{children}</div>;
}

/** Convex wraps thrown errors; show only the sentence we wrote. */
export function clean(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0];
}
