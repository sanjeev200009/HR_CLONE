"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, Field, clean } from "../components/ui";

export default function Page() {
  return (
    <Shell>
      <Employees />
    </Shell>
  );
}

function Employees() {
  const { orgId } = useOrg();
  const list = useQuery(api.employees.list, { orgId });
  const workplaces = useQuery(api.workplaces.list, { orgId });
  const departments = useQuery(api.employees.departments, { orgId });
  const invite = useMutation(api.employees.invite);
  const update = useMutation(api.employees.update);

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    phone: "",
    role: "employee" as "employee" | "admin",
    workplaceId: "",
    departmentId: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await invite({
        orgId,
        email: form.email,
        fullName: form.fullName,
        phone: form.phone || undefined,
        role: form.role,
        workplaceId: form.workplaceId ? (form.workplaceId as Id<"workplaces">) : undefined,
        departmentId: form.departmentId
          ? (form.departmentId as Id<"departments">)
          : undefined,
      });
      setForm({ ...form, email: "", fullName: "", phone: "" });
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(memberId: Id<"members">, isActive: boolean) {
    setError(null);
    try {
      await update({ orgId, memberId, isActive: !isActive });
    } catch (err) {
      setError(clean(err));
    }
  }

  return (
    <>
      <h1 className="text-[24px] font-semibold">Employees</h1>

      <form
        onSubmit={submit}
        className="mt-6 grid gap-3 rounded-lg border border-[var(--rule)] bg-white p-4 sm:grid-cols-3"
      >
        <Field label="Work email">
          <input
            required
            type="email"
            className={INPUT}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="name@company.lk"
          />
        </Field>
        <Field label="Full name">
          <input
            required
            className={INPUT}
            value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
          />
        </Field>
        <Field label="Phone (optional)">
          <input
            className={INPUT}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </Field>
        <Field label="Role">
          <select
            className={INPUT}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as "employee" | "admin" })}
          >
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Workplace">
          <select
            className={INPUT}
            value={form.workplaceId}
            onChange={(e) => setForm({ ...form, workplaceId: e.target.value })}
          >
            <option value="">- none -</option>
            {(workplaces ?? []).map((w) => (
              <option key={w._id} value={w._id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select
            className={INPUT}
            value={form.departmentId}
            onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
          >
            <option value="">- none -</option>
            {(departments ?? []).map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-3">
          {/* Without a workplace there is nothing to geofence against, so say so
              here rather than letting the employee discover it at the gate. */}
          {!form.workplaceId && (
            <p className="mb-2 text-xs text-[var(--warning)]">
              With no workplace assigned, this person&apos;s attendance cannot be verified
              against a location.
            </p>
          )}
          {error && <p className="mb-2 text-sm text-[var(--negative)]">{error}</p>}
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? "Adding…" : "Add employee"}
          </button>
          <span className="ml-3 text-xs text-[var(--muted)]">
            They sign in on the mobile app with this exact email.
          </span>
        </div>
      </form>

      <div className="card mt-6 overflow-x-auto">
        <table className="tbl">
          <thead className="">
            <tr>
              <th className="">Name</th>
              <th className="">Role</th>
              <th className="">Workplace</th>
              <th className="">Department</th>
              <th className="">Status</th>
              <th className=""></th>
            </tr>
          </thead>
          <tbody>
            {(list ?? []).map((m) => (
              <tr key={m._id} className="">
                <td className="">
                  <div className="font-medium">{m.fullName}</div>
                  <div className="text-xs text-[var(--muted)]">{m.email}</div>
                </td>
                <td className="">{m.role}</td>
                <td className="">
                  {m.workplace ?? <span className="text-[var(--warning)]">none</span>}
                </td>
                <td className="">{m.department ?? "-"}</td>
                <td className="">
                  {!m.isActive ? (
                    <span className="text-[var(--muted)]">inactive</span>
                  ) : m.hasSignedIn ? (
                    <span className="text-[var(--positive)]">active</span>
                  ) : (
                    // The single most common support question: "I added them,
                    // why aren't they on the board?"
                    <span className="text-[var(--warning)]">never signed in</span>
                  )}
                </td>
                <td className="text-right">
                  <button
                    onClick={() => toggleActive(m._id, m.isActive)}
                    className="text-xs text-[var(--accent-ink)] hover:underline"
                  >
                    {m.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {list?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-[var(--muted)]">
                  Nobody yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
