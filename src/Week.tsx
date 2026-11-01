import { useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";

// The weekly timesheet, for the employee side of the submit/approve loop.
//
// Hours are shown, never entered. The only thing an employee does here is agree
// that the week is right — which is what a timesheet actually is.

type Props = { orgId: Id<"organizations"> };

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Week({ orgId }: Props) {
  const [offset, setOffset] = useState(0); // whole weeks back from this one
  const weekOf = isoWeekOffset(offset);
  const week = useQuery(api.timesheets.myWeek, { orgId, weekOf });
  const submit = useMutation(api.timesheets.submit);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (week === undefined) {
    return (
      <View style={{ paddingVertical: 24 }}>
        <ActivityIndicator />
      </View>
    );
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await submit({ orgId, weekOf: week!.weekStart });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  const statusLabel: Record<string, string> = {
    draft: "Not submitted",
    submitted: "Waiting for approval",
    approved: "Approved",
    rejected: "Sent back to you",
  };

  return (
    <View style={s.card}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={s.rowTitle}>Week of {week.weekStart}</Text>
        <View style={{ flexDirection: "row", gap: 14 }}>
          <TouchableOpacity onPress={() => setOffset(offset + 1)}>
            <Text style={{ color: c.link, fontSize: 14 }}>← Earlier</Text>
          </TouchableOpacity>
          {offset > 0 && (
            <TouchableOpacity onPress={() => setOffset(offset - 1)}>
              <Text style={{ color: c.link, fontSize: 14 }}>Later →</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={s.big}>{fmt(week.totalMs)}</Text>
      <Text style={s.fine}>
        {statusLabel[week.status]}
        {week.reviewNote ? ` · ${week.reviewNote}` : ""}
      </Text>

      <View style={{ marginTop: 14, gap: 4 }}>
        {week.days.map((d, i) => (
          <View
            key={d.date}
            style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
          >
            <Text style={{ fontSize: 14, color: c.muted }}>
              {DOW[i]} {d.date.slice(8)}
              {d.isHoliday ? " · holiday" : d.onLeave ? " · on leave" : ""}
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontVariant: ["tabular-nums"],
                // Honest zeros: a day with no hours prints 0h 00m, not a blank.
                color: d.totalMs === 0 ? c.fine : c.text,
              }}
            >
              {d.openSession ? "still in" : fmt(d.totalMs)}
              {d.isLate ? " · late" : ""}
            </Text>
          </View>
        ))}
      </View>

      {error && <Text style={s.error}>{error}</Text>}

      {week.canSubmit ? (
        <TouchableOpacity style={s.button} onPress={send} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={c.onDark} />
          ) : (
            <Text style={s.buttonText}>Submit this week</Text>
          )}
        </TouchableOpacity>
      ) : (
        <Text style={s.fine}>
          {week.status === "submitted" || week.status === "approved"
            ? "Already submitted."
            : "Clock out of your open session before submitting."}
        </Text>
      )}
    </View>
  );
}

/** Monday of the week `n` weeks before this one, as "YYYY-MM-DD". */
function isoWeekOffset(n: number): string {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const dow = new Date(utc).getUTCDay();
  const monday = utc - ((dow + 6) % 7) * 86_400_000;
  return new Date(monday - n * 7 * 86_400_000).toISOString().slice(0, 10);
}

function fmt(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
