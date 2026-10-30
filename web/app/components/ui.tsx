import { ReactNode } from "react";

// Three primitives and an error cleaner. Tailwind does the rest; shadcn/ui would
// be a component library's worth of files for five forms.

export const INPUT =
  "w-full rounded border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900";
export const BUTTON =
  "rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
export const BUTTON_QUIET =
  "rounded border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:opacity-50";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-neutral-600">{label}</span>
      {children}
    </label>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium">{children}</th>;
}

/** Convex wraps thrown errors; show only the sentence we wrote. */
export function clean(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0];
}
