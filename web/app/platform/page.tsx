"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { UserButton } from "@clerk/nextjs";
import { INPUT, BUTTON, BUTTON_QUIET, Field, Th, clean } from "../components/ui";

// SaaS owner console. Separate from Shell on purpose: Shell resolves an org
// membership, and the platform owner is deliberately NOT a member of any customer
// org (convex/platform.ts). Being the owner grants orgs, plans and counts —
// never attendance, never coordinates.

export default function Page() {
  const usage = useQuery(api.platform.usage);
  const orgs = useQuery(api.platform.orgs);
  const plans = useQuery(api.platform.plans);

  // The query throws "Platform admin only" for everyone else; useQuery surfaces
  // that as a thrown render error, so an explicit undefined check isn't enough.
  if (usage === undefined || orgs === undefined || plans === undefined) {
    return <Centered>Loading…</Centered>;
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <span className="font-semibold">AttendanceHR · platform</span>
          <UserButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-8">
        <section>
          <h1 className="text-2xl font-semibold">Platform</h1>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Companies" value={usage.orgs} />
            <Stat label="Active" value={usage.activeOrgs} />
            <Stat label="Suspended" value={usage.suspendedOrgs} />
            <Stat label="Employees" value={usage.activeMembers} />
            <Stat label="Seats total" value={usage.members} />
            <Stat label="Never signed in" value={usage.neverSignedIn} />
          </div>
        </section>

        <NewOrg plans={plans} />
        <Orgs orgs={orgs} plans={plans} />
        <Plans plans={plans} />
      </main>
    </div>
  );
}

function NewOrg({ plans }: { plans: { _id: Id<"plans">; name: string }[] }) {
  const createOrg = useMutation(api.platform.createOrg);
  const [f, setF] = useState({
    name: "",
    companyEmail: "",
    timezone: "Asia/Colombo",
    planId: "",
    adminEmail: "",
    adminName: "",
    trialDays: "14",
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const days = Number(f.trialDays);
      await createOrg({
        name: f.name,
        companyEmail: f.companyEmail || undefined,
        timezone: f.timezone,
        planId: f.planId ? (f.planId as Id<"plans">) : undefined,
        billingPeriod: "trial",
        expiresAt: days > 0 ? Date.now() + days * 86_400_000 : undefined,
        adminEmail: f.adminEmail,
        adminName: f.adminName,
      });
      setOk(`${f.name} created. ${f.adminEmail} can sign in now.`);
      setF({ ...f, name: "", companyEmail: "", adminEmail: "", adminName: "" });
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Onboard a company</h2>
      <form
        onSubmit={submit}
        className="mt-3 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-3"
      >
        <Field label="Company name">
          <input required className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Company email (optional)">
          <input className={INPUT} value={f.companyEmail} onChange={(e) => setF({ ...f, companyEmail: e.target.value })} />
        </Field>
        <Field label="Timezone (IANA)">
          <input required className={INPUT} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
        </Field>
        <Field label="Their admin's name">
          <input required className={INPUT} value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} />
        </Field>
        <Field label="Their admin's email">
          <input required type="email" className={INPUT} value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} />
        </Field>
        <Field label="Plan">
          <select className={INPUT} value={f.planId} onChange={(e) => setF({ ...f, planId: e.target.value })}>
            <option value="">— none —</option>
            {plans.map((p) => (
              <option key={p._id} value={p._id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Trial days (0 = no expiry)">
          <input type="number" min={0} className={INPUT} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: e.target.value })} />
        </Field>
        <div className="sm:col-span-3">
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          {ok && <p className="mb-2 text-sm text-green-800">{ok}</p>}
          <button className={BUTTON} disabled={busy}>{busy ? "Creating…" : "Create company"}</button>
          <span className="ml-3 text-xs text-neutral-500">
            Their admin claims the account by signing in with that email.
          </span>
        </div>
      </form>
    </section>
  );
}

function Orgs({
  orgs,
  plans,
}: {
  orgs: NonNullable<ReturnType<typeof useQuery<typeof api.platform.orgs>>>;
  plans: { _id: Id<"plans">; name: string }[];
}) {
  const setStatus = useMutation(api.platform.setOrgStatus);
  const setPlan = useMutation(api.platform.setOrgPlan);
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-lg font-semibold">Companies</h2>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <Th>Company</Th><Th>Plan</Th><Th>Seats</Th><Th>Expires</Th><Th>Status</Th><Th> </Th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o._id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-neutral-500">{o.timezone}</div>
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded border border-neutral-300 px-2 py-1 text-xs"
                    value={plans.find((p) => p.name === o.planName)?._id ?? ""}
                    onChange={(e) =>
                      e.target.value &&
                      setPlan({
                        orgId: o._id,
                        planId: e.target.value as Id<"plans">,
                        billingPeriod: o.billingPeriod ?? "monthly",
                        expiresAt: o.expiresAt ?? undefined,
                      }).catch((err) => setError(clean(err)))
                    }
                  >
                    <option value="">— none —</option>
                    {plans.map((p) => (
                      <option key={p._id} value={p._id}>{p.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  {o.employees}
                  {o.employeeLimit !== null ? ` / ${o.employeeLimit}` : ""}
                  {o.overLimit && <span className="ml-1 text-xs text-red-700">over</span>}
                </td>
                <td className="px-4 py-3 tabular-nums text-xs">
                  {o.expiresAt ? new Date(o.expiresAt).toISOString().slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-3">
                  {o.status === "active" ? (
                    <span className="text-green-800">active</span>
                  ) : (
                    <span className="text-red-700">suspended</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() =>
                      setStatus({
                        orgId: o._id,
                        status: o.status === "active" ? "suspended" : "active",
                      }).catch((err) => setError(clean(err)))
                    }
                  >
                    {o.status === "active" ? "Suspend" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {orgs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-neutral-500">No companies yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        Suspending blocks sign-in for that company and keeps all their data, so
        reactivating restores it untouched. Nothing here can read their attendance.
      </p>
    </section>
  );
}

function Plans({ plans }: { plans: NonNullable<ReturnType<typeof useQuery<typeof api.platform.plans>>> }) {
  const upsert = useMutation(api.platform.upsertPlan);
  const [f, setF] = useState({ name: "", monthlyPrice: "", annualPrice: "", employeeLimit: "" });
  const [error, setError] = useState<string | null>(null);

  return (
    <section>
      <h2 className="text-lg font-semibold">Plans</h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr><Th>Name</Th><Th>Monthly</Th><Th>Annual</Th><Th>Seat limit</Th><Th>Active</Th></tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p._id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 tabular-nums">LKR {p.monthlyPrice.toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums">LKR {p.annualPrice.toLocaleString()}</td>
                <td className="px-4 py-3 tabular-nums">{p.employeeLimit}</td>
                <td className="px-4 py-3">
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() =>
                      upsert({ planId: p._id, ...p, isActive: !p.isActive }).catch((e) =>
                        setError(clean(e)),
                      )
                    }
                  >
                    {p.isActive ? "yes" : "no"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="mt-3 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          try {
            await upsert({
              name: f.name,
              monthlyPrice: Number(f.monthlyPrice),
              annualPrice: Number(f.annualPrice),
              employeeLimit: Number(f.employeeLimit),
              isActive: true,
            });
            setF({ name: "", monthlyPrice: "", annualPrice: "", employeeLimit: "" });
          } catch (err) {
            setError(clean(err));
          }
        }}
      >
        <Field label="Name"><input required className={INPUT} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Monthly (LKR)"><input required type="number" min={0} className={INPUT} value={f.monthlyPrice} onChange={(e) => setF({ ...f, monthlyPrice: e.target.value })} /></Field>
        <Field label="Annual (LKR)"><input required type="number" min={0} className={INPUT} value={f.annualPrice} onChange={(e) => setF({ ...f, annualPrice: e.target.value })} /></Field>
        <Field label="Seat limit"><input required type="number" min={1} className={INPUT} value={f.employeeLimit} onChange={(e) => setF({ ...f, employeeLimit: e.target.value })} /></Field>
        <div className="flex items-end"><button className={BUTTON_QUIET}>Add plan</button></div>
        {error && <p className="text-sm text-red-700 sm:col-span-5">{error}</p>}
      </form>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-4 ring-1 ring-neutral-200">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center text-neutral-500">{children}</div>;
}
