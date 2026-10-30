"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Shell, { useOrg } from "../components/Shell";
import { INPUT, BUTTON, Field, Th, clean } from "../components/ui";

export default function Page() {
  return (
    <Shell>
      <Workplaces />
    </Shell>
  );
}

function Workplaces() {
  const { orgId } = useOrg();
  const list = useQuery(api.workplaces.list, { orgId });
  const create = useMutation(api.workplaces.create);
  const update = useMutation(api.workplaces.update);

  const [form, setForm] = useState({ name: "", address: "", lat: "", lng: "", radiusM: "100" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create({
        orgId,
        name: form.name,
        address: form.address || undefined,
        lat: Number(form.lat),
        lng: Number(form.lng),
        radiusM: Number(form.radiusM),
      });
      setForm({ name: "", address: "", lat: "", lng: "", radiusM: "100" });
    } catch (err) {
      setError(clean(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Workplaces</h1>
      <p className="mt-1 text-sm text-neutral-600">
        A workplace is a point and a radius. Employees assigned to it are verified
        against it when they clock in.
      </p>

      <form
        onSubmit={submit}
        className="mt-6 grid gap-3 rounded-lg border border-neutral-200 bg-white p-4 sm:grid-cols-3"
      >
        <Field label="Name">
          <input
            required
            className={INPUT}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Main Office"
          />
        </Field>
        <Field label="Address (optional)">
          <input
            className={INPUT}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </Field>
        <Field label="Allowed radius (metres)">
          <input
            required
            type="number"
            min={20}
            max={5000}
            className={INPUT}
            value={form.radiusM}
            onChange={(e) => setForm({ ...form, radiusM: e.target.value })}
          />
        </Field>
        <Field label="Latitude">
          <input
            required
            className={INPUT}
            value={form.lat}
            onChange={(e) => setForm({ ...form, lat: e.target.value })}
            placeholder="6.9271"
          />
        </Field>
        <Field label="Longitude">
          <input
            required
            className={INPUT}
            value={form.lng}
            onChange={(e) => setForm({ ...form, lng: e.target.value })}
            placeholder="79.8612"
          />
        </Field>

        <div className="sm:col-span-3">
          {/* No map in the MVP (docs/PLAN.md) — a paid map isn't needed to store a
              point. This is how a non-technical admin gets the numbers. */}
          <p className="mb-2 text-xs text-neutral-500">
            To find the coordinates: open Google Maps, right-click your office, and click
            the latitude/longitude pair at the top of the menu to copy it. Paste the first
            number into Latitude and the second into Longitude.
          </p>
          <p className="mb-2 text-xs text-neutral-500">
            Keep the radius realistic. Phone GPS is usually accurate to 10–20 metres
            outdoors and much worse inside a building, so anything under ~50m will reject
            people who really are at work.
          </p>
          {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
          <button type="submit" disabled={busy} className={BUTTON}>
            {busy ? "Saving…" : "Add workplace"}
          </button>
        </div>
      </form>

      <div className="mt-8 overflow-x-auto rounded-lg border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 text-neutral-500">
            <tr>
              <Th>Name</Th>
              <Th>Coordinates</Th>
              <Th>Radius</Th>
              <Th>Status</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(list ?? []).map((w) => (
              <tr key={w._id} className="border-b border-neutral-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium">{w.name}</div>
                  <div className="text-xs text-neutral-500">{w.address ?? "—"}</div>
                </td>
                <td className="px-4 py-3 tabular-nums">
                  <a
                    className="text-blue-700 hover:underline"
                    href={`https://www.google.com/maps?q=${w.lat},${w.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {w.lat.toFixed(5)}, {w.lng.toFixed(5)}
                  </a>
                </td>
                <td className="px-4 py-3 tabular-nums">{w.radiusM} m</td>
                <td className="px-4 py-3">
                  {w.isActive ? (
                    <span className="text-green-800">active</span>
                  ) : (
                    <span className="text-neutral-500">inactive</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() =>
                      update({ orgId, workplaceId: w._id, isActive: !w.isActive }).catch((e) =>
                        setError(clean(e)),
                      )
                    }
                  >
                    {w.isActive ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
            {list?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-neutral-500">
                  No workplaces yet. Until one exists, nobody&apos;s attendance can be
                  location-verified.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
