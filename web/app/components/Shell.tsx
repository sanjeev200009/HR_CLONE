"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { ReactNode, createContext, useContext, useEffect } from "react";

// The shell: a ruled T-frame (the dealt style's §4).
//
// A 230px sidebar and a 64px top bar share one ground, divided only by 1px
// rules. The sidebar holds the wordmark and the nav on a 40px pitch under
// sentence-case group labels; the active row is a pale tint of the one hue with
// its dark ink — never a left accent bar on top of the tint, which the study saw
// once in 23 screens. The top bar carries the company and the user, because two
// studied screens left ~1070px of it blank and were flagged for it.
//
// The org is resolved ONCE here from members.me and passed down, rather than
// each page reading an org id from the URL. A page that takes orgId from the URL
// invites someone to try another company's id — which Convex would reject, but
// not offering the invitation is better than relying on the rejection.

type OrgContext = {
  orgId: Id<"organizations">;
  orgName: string;
  timezone: string;
  fullName: string;
};

const Ctx = createContext<OrgContext | null>(null);

/** Throws if used outside an admin page — which is a bug, not a user state. */
export function useOrg(): OrgContext {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrg used outside Shell");
  return v;
}

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "Today",
    items: [
      { href: "/", label: "Who is in" },
      { href: "/attendance", label: "Attendance" },
      { href: "/timesheets", label: "Timesheets" },
    ],
  },
  {
    group: "People",
    items: [
      { href: "/leave", label: "Leave" },
      { href: "/directory", label: "Directory" },
      { href: "/employees", label: "Employees" },
    ],
  },
  {
    group: "Company",
    items: [
      { href: "/payroll", label: "Payroll" },
      { href: "/workplaces", label: "Workplaces" },
      { href: "/corrections", label: "Corrections" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export default function Shell({ children }: { children: ReactNode }) {
  const memberships = useQuery(api.members.me);
  const claim = useMutation(api.members.claim);
  const pathname = usePathname();

  // First sign-in: bind this Clerk user to the member row an admin pre-created
  // for their email. The mobile app does this in Home.tsx; without it here, an
  // admin signing in on the web was never bound and saw "no dashboard access"
  // forever. members.claim is idempotent and requires a verified email.
  useEffect(() => {
    if (memberships?.length === 0) claim().catch(() => {});
  }, [memberships, claim]);

  if (memberships === undefined) return <Centered>Loading…</Centered>;

  const admin = memberships?.find((m) => m.role === "admin") ?? null;

  if (!admin) {
    // Two different situations, one screen, because the fix is the same: talk to
    // someone. An employee landing here is not an error to shout about.
    return (
      <Centered>
        <h1 className="text-xl font-semibold">No dashboard access</h1>
        <p className="mt-2 max-w-md text-[var(--muted)]">
          This account isn&apos;t an admin of any company on AttendanceHR. If you&apos;re
          an employee, use the mobile app to clock in and out.
        </p>
        <div className="mt-6">
          <UserButton />
        </div>
      </Centered>
    );
  }

  return (
    <Ctx.Provider
      value={{
        orgId: admin.orgId,
        orgName: admin.orgName,
        timezone: admin.timezone,
        fullName: admin.fullName,
      }}
    >
      <div className="flex min-h-screen">
        <aside
          className="hidden shrink-0 border-r border-[var(--rule)] md:block"
          style={{ width: "var(--sidebar-width)" }}
        >
          <div className="flex h-16 items-center gap-2 px-6">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight">AttendanceHR</span>
          </div>

          <nav className="px-3 pb-8">
            {NAV.map((section) => (
              <div key={section.group} className="mb-5">
                <div className="px-3 pb-1 text-[12px] text-[var(--muted)]">
                  {section.group}
                </div>
                {section.items.map((item) => {
                  const active =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="flex h-10 items-center rounded-[6px] px-3 text-[14px]"
                      style={
                        active
                          ? {
                              background: "var(--accent-soft)",
                              color: "var(--accent-ink)",
                              fontWeight: 500,
                            }
                          : { color: "var(--muted)" }
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center border-b border-[var(--rule)] px-6">
            {/* Mobile: the wordmark moves here, since the sidebar is hidden. */}
            <span className="flex items-center gap-2 text-[15px] font-semibold md:hidden">
              <Mark />
              AttendanceHR
            </span>
            <div className="ml-auto flex items-center gap-4">
              <span className="text-[14px] text-[var(--muted)]">{admin.orgName}</span>
              <span className="h-16 w-px bg-[var(--rule)]" />
              <UserButton />
            </div>
          </header>

          {/* Mobile nav: the sidebar becomes a scrolling row of destinations. */}
          <nav className="flex gap-1 overflow-x-auto border-b border-[var(--rule)] px-4 py-2 md:hidden">
            {NAV.flatMap((s) => s.items).map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-[6px] px-3 py-1.5 text-[13px]"
                  style={
                    active
                      ? { background: "var(--accent-soft)", color: "var(--accent-ink)", fontWeight: 500 }
                      : { color: "var(--muted)" }
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <main className="min-w-0 flex-1 px-6 py-7 lg:px-[29px]">{children}</main>
        </div>
      </div>
    </Ctx.Provider>
  );
}

/**
 * The product's mark, drawn for this product.
 *
 * A clock face with the hand at nine — the moment a working day starts, which is
 * the one thing this product records. The sheet is explicit that a black square
 * with a letter in it is not a mark.
 */
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.25" fill="none" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M10 10V5.5M10 10H6.4" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      {children}
    </div>
  );
}
