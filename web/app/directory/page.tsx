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
      <Directory />
    </Shell>
  );
}

function Directory() {
  const { orgId } = useOrg();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Id<"members"> | null>(null);
  const people = useQuery(api.directory.list, { orgId, search: search || undefined });
  const written = useQuery(api.feedback.mine, { orgId });
  const withdraw = useMutation(api.feedback.withdraw);
  // One query for every avatar on screen, not one per card.
  const avatarIds = (people ?? []).map((p) => p.avatarStorageId).filter(Boolean) as Id<"_storage">[];
  const avatars = useQuery(
    api.directory.avatarUrls,
    avatarIds.length > 0 ? { orgId, ids: avatarIds } : "skip",
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <h1 className="text-[24px] font-semibold">Directory</h1>
      <input
        className={`${INPUT} mt-4 max-w-sm`}
        placeholder="Search by name, title or department"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(people ?? []).map((p) => (
          <button
            key={p._id}
            onClick={() => setOpen(p._id)}
            className="card p-4 text-left hover:border-neutral-400"
          >
            <div className="font-medium">{p.fullName}</div>
            <div className="text-sm text-[var(--muted)]">{p.jobTitle ?? "-"}</div>
            <div className="mt-2 text-xs text-[var(--muted)]">
              {p.department ?? "No department"}
              {p.managerName ? ` · reports to ${p.managerName}` : ""}
            </div>
          </button>
        ))}
        {people?.length === 0 && <p className="text-[var(--muted)]">Nobody matches that.</p>}
      </div>

      {/* What you have written, so feedback is not a thing you send into a void. */}
      {(written ?? []).length > 0 && (
        <>
          <h2 className="mt-10 text-[16px] font-semibold">Feedback you have given</h2>
          {error && <p className="mt-2 text-[14px] text-[var(--negative)]">{error}</p>}
          <ul className="mt-3 space-y-3">
            {(written ?? []).map((w) => (
              <li key={w._id} className="card p-4 text-[14px]">
                <div className="flex items-start justify-between gap-4">
                  <p className="text-[12px] text-[var(--muted)]">
                    To {w.toName} · {w.visibility}
                    {w.isAnonymous ? " · anonymous to them" : ""}
                  </p>
                  {/* Only the author can withdraw their own; an admin cannot
                      quietly delete feedback about themselves. */}
                  <button
                    className="shrink-0 text-[12px] underline"
                    style={{ color: "var(--accent-ink)" }}
                    onClick={() =>
                      withdraw({ orgId, feedbackId: w._id }).catch((e) => setError(clean(e)))
                    }
                  >
                    Withdraw
                  </button>
                </div>
                <p className="mt-1">{w.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && <Profile memberId={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Profile({ memberId, onClose }: { memberId: Id<"members">; onClose: () => void }) {
  const { orgId } = useOrg();
  const p = useQuery(api.directory.profile, { orgId, memberId });
  const notes = useQuery(api.feedback.about, { orgId, memberId });
  const updateEmployment = useMutation(api.directory.updateEmployment);
  const give = useMutation(api.feedback.give);

  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState<"private" | "manager" | "team">("private");
  const [anon, setAnon] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [joinedOn, setJoinedOn] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!p) return null;

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <div className="w-full max-w-lg rounded-lg bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{p.fullName}</h2>
            <p className="text-sm text-[var(--muted)]">{p.jobTitle ?? "-"}</p>
          </div>
          <button onClick={onClose} className="text-sm text-[var(--muted)] hover:underline">
            Close
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <Row label="Email" value={p.email} />
          <Row label="Department" value={p.department ?? "-"} />
          <Row label="Manager" value={p.manager?.fullName ?? "-"} />
          <Row label="Joined" value={p.joinedOn ?? "-"} />
          {/* Contact details only arrive from the server for self, manager or
              admin. The client is not the one deciding this. */}
          {p.canSeeContact && <Row label="Phone" value={p.phone ?? "-"} />}
          {p.canSeeContact && <Row label="Emergency" value={p.emergencyContact ?? "-"} />}
        </dl>

        {p.about && <p className="mt-4 text-sm text-[var(--text)]">{p.about}</p>}

        {p.reports.length > 0 && (
          <p className="mt-4 text-sm text-[var(--muted)]">
            Manages: {p.reports.map((r) => r.fullName).join(", ")}
          </p>
        )}

        <div className="mt-6 border-t border-[var(--rule)] pt-4">
          <h3 className="text-sm font-semibold">Employment (admin)</h3>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="Job title">
              <input
                className={INPUT}
                value={jobTitle}
                placeholder={p.jobTitle ?? ""}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </Field>
            <Field label="Join date">
              <input
                type="date"
                className={INPUT}
                value={joinedOn || (p.joinedOn ?? "")}
                onChange={(e) => setJoinedOn(e.target.value)}
              />
            </Field>
          </div>
          <button
            className={`${BUTTON} mt-2`}
            onClick={async () => {
              setError(null);
              try {
                await updateEmployment({
                  orgId,
                  memberId,
                  jobTitle: jobTitle || undefined,
                  joinedOn: joinedOn || undefined,
                });
                setJobTitle("");
              } catch (e) {
                setError(clean(e));
              }
            }}
          >
            Save employment
          </button>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Join date drives leave accrual, which is why an employee cannot edit it.
          </p>
        </div>

        {!p.isSelf && (
          <div className="mt-6 border-t border-[var(--rule)] pt-4">
            <h3 className="text-sm font-semibold">Leave feedback</h3>
            <textarea
              className={`${INPUT} mt-2`}
              rows={3}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Be specific and useful."
            />
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <select
                className="rounded border border-[var(--control)] px-2 py-1 text-xs"
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as typeof visibility)}
              >
                <option value="private">Private: them and their manager</option>
                <option value="manager">Manager only, hidden from them</option>
                <option value="team">Team: anyone in the company</option>
              </select>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} />
                Anonymous
              </label>
              <button
                className={BUTTON}
                onClick={async () => {
                  setError(null);
                  try {
                    await give({
                      orgId,
                      toMemberId: memberId,
                      body,
                      visibility,
                      isAnonymous: anon,
                    });
                    setBody("");
                  } catch (e) {
                    setError(clean(e));
                  }
                }}
              >
                Send
              </button>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Anonymous hides your name from the recipient, not from an admin, so there
              is always someone accountable for what was written.
            </p>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-[var(--negative)]">{error}</p>}

        {(notes ?? []).length > 0 && (
          <div className="mt-6 border-t border-[var(--rule)] pt-4">
            <h3 className="text-sm font-semibold">Feedback</h3>
            <ul className="mt-2 space-y-3">
              {(notes ?? []).map((n) => (
                <li key={n._id} className="rounded border border-[var(--rule)] p-3 text-sm">
                  <p>{n.body}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {n.fromName ?? "Anonymous"} · {n.visibility}
                    {n.authorHiddenFromRecipient && n.fromName ? " · name hidden from them" : ""}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A person's face, or their initial on a stable tint of their own.
 *
 * The tint is derived from the name, so the same person keeps the same colour
 * everywhere. Per the style sheet these tints are identity, not data: they stay
 * pale and never appear in a chart legend.
 */
function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- Convex storage URLs are not a configured next/image domain
    return <img src={url} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  }
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold"
      style={{ background: `hsl(${h} 70% 93%)`, color: `hsl(${h} 45% 30%)` }}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--muted)]">{label}</dt>
      <dd className="text-[var(--text)]">{value}</dd>
    </div>
  );
}
