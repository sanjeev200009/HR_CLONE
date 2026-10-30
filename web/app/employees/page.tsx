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
      <h1 className="text-2xl font-semibold">Employees</h1>

      <form
        onSubmit={submit}
        className="mt-6 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-3"
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
            <option value="">— none —</option>
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
            <option value="">— none —</option>
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
            <p className="mb-2 text-xs text-amber-700">
              With no workplace assigned, this person&apos;s attendance cannot be verified
              against a location.
            </p>
          )}
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? "Adding…" : "Add employee"}
          </button>
          <span className="ml-3 text-xs text-neutral-500">
            They sign in on the mobile app with this exact email.
          </span>
        </div>
      </form>

      <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-left text-neutral-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Workplace</th>
              <th className="px-4 py-2.5 font-medium">Department</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(list ?? []).map((m) => (
              <tr key={m._id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{m.fullName}</div>
                  <div className="text-xs text-neutral-500">{m.email}</div>
                </td>
                <td className="px-4 py-3">{m.role}</td>
                <td className="px-4 py-3">
                  {m.workplace ?? <span className="text-amber-700">none</span>}
                </td>
                <td className="px-4 py-3">{m.department ?? "—"}</td>
                <td className="px-4 py-3">
                  {!m.isActive ? (
                    <span className="text-neutral-500">inactive</span>
                  ) : m.hasSignedIn ? (
                    <span className="text-green-800">active</span>
                  ) : (
                    // The single most common support question: "I added them,
                    // why aren't they on the board?"
                    <span className="text-amber-700">never signed in</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleActive(m._id, m.isActive)}
                    className="text-xs text-blue-700 hover:underline"
                  >
                    {m.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {list?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-neutral-500">
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
