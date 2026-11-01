import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";

// Leave: balances, a request form, and your own history.
//
// The balance card is the point. "How many days do I have left" is the question
// employees open an HR app to answer, and it should be the first thing on screen.

type Props = { orgId: Id<"organizations">; timezone: string };

export default function Leave({ orgId, timezone }: Props) {
  const balances = useQuery(api.leave.myBalances, { orgId });
  const requests = useQuery(api.leave.myRequests, { orgId });
  const request = useMutation(api.leave.request);
  const cancel = useMutation(api.leave.cancel);

  const [typeId, setTypeId] = useState<Id<"leaveTypes"> | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  if (balances === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  const selected = typeId ?? balances[0]?.leaveTypeId ?? null;

  async function submit() {
    if (busy || !selected) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await request({
        orgId,
        leaveTypeId: selected,
        startDate: start.trim(),
        // Blank end date means a single day, which is what most requests are.
        endDate: (end.trim() || start.trim()),
        reason,
      });
      setStart("");
      setEnd("");
      setReason("");
      setOk("Request sent to your admin.");
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 24 }}
      data={requests ?? []}
      keyExtractor={(r) => r._id}
      ListHeaderComponent={
        <>
          <Text style={s.h1}>Leave</Text>

          {balances.length === 0 && (
            <Text style={s.warn}>
              Your company has not set up any leave types yet.
            </Text>
          )}

          {balances.map((b, i) => {
            const pool = b.entitledDays + b.carriedDays;
            const usedPct = pool > 0 ? Math.min(100, (b.usedDays / pool) * 100) : 0;
            const tint = i % 2 === 0
              ? { bg: c.lilacSoft, bar: c.lilac, ink: c.lilacInk }
              : { bg: c.butterSoft, bar: c.butter, ink: c.butterInk };
            return (
              <View key={b.leaveTypeId} style={[s.card, { backgroundColor: tint.bg }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={s.rowTitle}>{b.typeName}</Text>
                  <View style={[s.pill, { backgroundColor: tint.bar }]}>
                    <Text style={[s.pillText, { color: tint.ink }]}>
                      {b.isPaid ? "Paid" : "Unpaid"}
                    </Text>
                  </View>
                </View>

                <Text style={[s.big, { marginTop: 10 }]}>
                  {b.availableDays}
                  <Text style={{ fontSize: 15, fontWeight: "400", color: c.muted }}>
                    {"  "}of {pool} days left
                  </Text>
                </Text>

                {/* The ratio is the answer; the numbers behind it are the evidence. */}
                <View
                  style={{
                    height: 8,
                    borderRadius: 999,
                    backgroundColor: "rgba(255,255,255,0.75)",
                    overflow: "hidden",
                    marginTop: 12,
                  }}
                >
                  <View style={{ width: `${usedPct}%`, height: "100%", backgroundColor: tint.bar }} />
                </View>

                <Text style={s.fine}>
                  {b.usedDays} taken · {b.entitledDays} entitled
                  {b.carriedDays > 0 ? ` + ${b.carriedDays} carried` : ""}
                  {b.pendingDays > 0 ? ` · ${b.pendingDays} awaiting approval` : ""}
                </Text>
              </View>
            );
          })}

          {balances.length > 0 && (
            <>
              <Text style={s.h2}>Request leave</Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {balances.map((b) => (
                  <TouchableOpacity
                    key={b.leaveTypeId}
                    onPress={() => setTypeId(b.leaveTypeId)}
                    style={[s.chip, selected === b.leaveTypeId && s.chipOn]}
                  >
                    <Text style={selected === b.leaveTypeId ? s.chipTextOn : s.chipText}>
                      {b.typeName}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={s.label}>First day (YYYY-MM-DD)</Text>
              <TextInput
                style={s.input}
                value={start}
                onChangeText={setStart}
                placeholder="2026-03-09"
                autoCapitalize="none"
              />
              <Text style={s.label}>Last day (leave blank for one day)</Text>
              <TextInput
                style={s.input}
                value={end}
                onChangeText={setEnd}
                placeholder="2026-03-13"
                autoCapitalize="none"
              />
              <Text style={s.label}>Reason</Text>
              <TextInput
                style={s.input}
                value={reason}
                onChangeText={setReason}
                placeholder="Family matter"
              />

              <Text style={s.fine}>
                Weekends and public holidays in the range are not deducted.
              </Text>

              {error && <Text style={s.error}>{error}</Text>}
              {ok && <Text style={s.ok}>{ok}</Text>}

              <TouchableOpacity style={s.button} onPress={submit} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color={c.onDark} />
                ) : (
                  <Text style={s.buttonText}>Send request</Text>
                )}
              </TouchableOpacity>
            </>
          )}

          <Text style={s.h2}>My requests</Text>
        </>
      }
      ListEmptyComponent={<Text style={s.muted}>No leave requested yet.</Text>}
      renderItem={({ item }) => (
        <View style={s.row}>
          <Text style={s.rowTitle}>
            {item.typeName} · {item.days} day{item.days === 1 ? "" : "s"}
          </Text>
          <Text style={s.rowSub}>
            {item.startDate}
            {item.endDate !== item.startDate ? ` → ${item.endDate}` : ""} · {item.status}
          </Text>
          {item.reviewNote && <Text style={s.fine}>Note: {item.reviewNote}</Text>}
          {item.status === "pending" && (
            <TouchableOpacity
              onPress={() =>
                cancel({ orgId, requestId: item._id }).catch((e) =>
                  setError(
                    (e instanceof Error ? e.message : String(e))
                      .replace(/^[\s\S]*Uncaught Error:\s*/, "")
                      .split("\n")[0],
                  ),
                )
              }
            >
              <Text style={{ color: c.link, marginTop: 8, fontSize: 14 }}>
                Withdraw request
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    />
  );
}
