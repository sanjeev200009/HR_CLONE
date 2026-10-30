import { useState } from "react";
import { ActivityIndicator, FlatList, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";

// Attendance history, plus the one write an employee is allowed to make about a
// past day: asking an admin to correct it.

type Props = { orgId: Id<"organizations">; timezone: string };

export default function History({ orgId, timezone }: Props) {
  const rows = useQuery(api.attendance.myHistory, { orgId });
  const pending = useQuery(api.corrections.mine, { orgId });
  const request = useMutation(api.corrections.request);

  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [outTime, setOutTime] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (rows === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const pendingFor = new Set(
    (pending ?? []).filter((p) => p.status === "pending").map((p) => p.attendanceId),
  );

  async function submit(row: NonNullable<typeof rows>[number]) {
    setError(null);
    try {
      // "HH:MM" on that row's own work date, read in the org's timezone. Sent as an
      // absolute instant so the server never has to guess a zone.
      const at = instantFor(row.workDate, outTime, timezone);
      await request({
        orgId,
        attendanceId: row._id,
        requestedChange: { clockOutAt: at },
        reason,
      });
      setEditing(null);
      setReason("");
      setOutTime("");
      setDone(row.workDate);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]);
    }
  }

  return (
    <View style={s.screen}>
      <Text style={s.h1}>My attendance</Text>
      <Text style={s.muted}>Last {rows.length} days</Text>

      <FlatList
        data={rows}
        keyExtractor={(r) => r._id}
        ListEmptyComponent={<Text style={s.muted}>Nothing recorded yet.</Text>}
        renderItem={({ item }) => {
          const isEditing = editing === item._id;
          return (
            <View style={s.row}>
              <Text style={s.rowTitle}>
                {item.workDate} · {fmt(item.workedMs)}
              </Text>
              <Text style={s.rowSub}>
                {time(item.clockInAt, timezone)} –{" "}
                {item.clockOutAt ? time(item.clockOutAt, timezone) : "—"}
                {item.isLate ? " · late" : ""}
                {item.clockInStatus !== "verified" ? ` · ${item.clockInStatus}` : ""}
              </Text>

              {item.missedClockOut && !pendingFor.has(item._id) && (
                <>
                  <Text style={s.warn}>No clock-out recorded for this day.</Text>
                  {!isEditing ? (
                    <TouchableOpacity onPress={() => { setEditing(item._id); setError(null); }}>
                      <Text style={{ color: c.link, marginTop: 8 }}>Request a correction</Text>
                    </TouchableOpacity>
                  ) : (
                    <View>
                      <Text style={s.label}>What time did you leave? (HH:MM)</Text>
                      <TextInput
                        style={s.input}
                        value={outTime}
                        onChangeText={setOutTime}
                        placeholder="17:30"
                        keyboardType="numbers-and-punctuation"
                      />
                      <Text style={s.label}>Reason</Text>
                      <TextInput
                        style={s.input}
                        value={reason}
                        onChangeText={setReason}
                        placeholder="Phone battery died"
                      />
                      {error && <Text style={s.error}>{error}</Text>}
                      <TouchableOpacity style={s.button} onPress={() => submit(item)}>
                        <Text style={s.buttonText}>Send to admin</Text>
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => setEditing(null)}>
                        <Text style={s.link}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </>
              )}

              {pendingFor.has(item._id) && (
                <Text style={s.fine}>Correction requested — waiting for your admin.</Text>
              )}
              {done === item.workDate && <Text style={s.ok}>Correction sent.</Text>}
            </View>
          );
        }}
      />
    </View>
  );
}

/**
 * Turn "17:30" on a given org-local date into an absolute instant.
 *
 * Done by probing: format a candidate UTC instant back into the target timezone and
 * correct by the difference. Two passes settle it even across a DST boundary, and it
 * avoids shipping a timezone library into the bundle for one input field.
 */
function instantFor(workDate: string, hhmm: string, timezone: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new Error("Enter the time as HH:MM, for example 17:30");
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error("That is not a real time");

  let guess = Date.parse(`${workDate}T${pad(h)}:${pad(min)}:00Z`);
  if (Number.isNaN(guess)) throw new Error("Could not read that date");

  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(guess));
    const gotH = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const gotM = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const driftMin = (h * 60 + min) - (gotH * 60 + gotM);
    if (driftMin === 0) break;
    guess += driftMin * 60_000;
  }
  return guess;
}

const pad = (n: number) => String(n).padStart(2, "0");

function time(at: number, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

function fmt(ms: number) {
  const total = Math.floor(ms / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
