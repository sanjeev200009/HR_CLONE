"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { ReactNode, createContext, useContext } from "react";

// Everything an admin page needs: which org am I an admin of, and the nav.
//
// The org is resolved ONCE here from members.me and passed down, rather than each
// page reading an org id from the URL. A page that takes orgId from the URL invites
// someone to try another company's id — which Convex would reject, but not offering
// the invitation is better than relying on the rejection.

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

const NAV = [
  { href: "/", label: "Today" },
  { href: "/attendance", label: "Attendance" },
  { href: "/timesheets", label: "Timesheets" },
  { href: "/leave", label: "Leave" },
  { href: "/directory", label: "Directory" },
  { href: "/employees", label: "Employees" },
  { href: "/workplaces", label: "Workplaces" },
  { href: "/corrections", label: "Corrections" },
];

export default function Shell({ children }: { children: ReactNode }) {
  const memberships = useQuery(api.members.me);
  const pathname = usePathname();

  if (memberships === undefined) {
    return <Centered>Loading…</Centered>;
  }

  const admin = memberships?.find((m) => m.role === "admin") ?? null;

  if (!admin) {
    // Two different situations, one screen, because the fix is the same: talk to
    // someone. An employee landing here is not an error to shout about.
    return (
      <Centered>
        <h1 className="text-xl font-semibold">No dashboard access</h1>
        <p className="mt-2 max-w-md text-neutral-600">
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
      <div className="min-h-screen">
        <header className="border-b border-neutral-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
            <span className="font-semibold">{admin.orgName}</span>
            <nav className="flex flex-1 gap-1 overflow-x-auto">
              {NAV.map((item) => {
                const active =
                  item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`whitespace-nowrap rounded px-3 py-1.5 text-sm ${
                      active
                        ? "bg-neutral-900 text-white"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <UserButton />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </div>
    </Ctx.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      {children}
    </div>
  );
}
