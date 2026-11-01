import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";
import { readFix, deviceLabel, fixProblemMessage, FixProblem } from "./location";

// THE screen. An employee opens the app to answer one question — am I clocked in —
// and press one button. Everything else here serves that.
//
// Laid out like the reference: a warm greeting, the live time as the hero figure,
// then the state and the day's total as two tiles, then the single ink action.

type Props = { orgId: Id<"organizations">; orgName: string; fullName: string };

const STATUS: Record<string, { text: string; tone: "ok" | "warn" }> = {
  verified: { text: "At your workplace", tone: "ok" },
  out_of_range: { text: "Outside your workplace", tone: "warn" },
  low_accuracy: { text: "Location too imprecise to verify", tone: "warn" },
  no_location: { text: "No location recorded", tone: "warn" },
  suspect_mocked: { text: "Location reported as simulated", tone: "warn" },
};

export default function Clock({ orgId, orgName, fullName }: Props) {
  const today = useQuery(api.attendance.today, { orgId });
  const clockIn = useMutation(api.attendance.clockIn);
  const clockOut = useMutation(api.attendance.clockOut);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // One tick per second, purely so the clock moves. The authoritative instant is
  // always the server's; this only drives the display.
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Note the device clock the moment a server timestamp lands. The difference is
  // this phone's skew, and every displayed time is corrected by it.
  const [localAtFetch, setLocalAtFetch] = useState<number | null>(null);
  const serverNow = today?.serverNow;
  useEffect(() => {
    if (serverNow !== undefined) setLocalAtFetch(Date.now());
  }, [serverNow]);

  if (today === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator color={c.lilacInk} />
      </View>
    );
  }

  const skew = localAtFetch === null ? 0 : today.serverNow - localAtFetch;
  const now = tick + skew;
  const liveMs = today.isClockedIn && today.since ? now - today.since : 0;
  const totalMs = today.totalMs + liveMs;
  const status = today.lastStatus ? STATUS[today.lastStatus] : null;

  async function press() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { fix, problem } = await readFix();
      if (problem) setNotice(fixProblemMessage[problem as Exclude<FixProblem, null>]);
      if (today!.isClockedIn) await clockOut({ orgId, fix });
      else await clockIn({ orgId, fix, device: deviceLabel() });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 8 }}>
        <Text style={s.muted}>
          {orgName} · {localDate(now, today.timezone)}
        </Text>
        <Text style={[s.h1, { marginTop: 6 }]}>Hello {fullName.split(" ")[0]}</Text>

        {/* The live clock is the hero figure, as the greeting is in the reference. */}
        <Text style={[s.clock, { marginTop: 18 }]}>{localTime(now, today.timezone)}</Text>

        <View style={[s.pill, today.isClockedIn ? s.pillIn : s.pillOut, { marginTop: 10 }]}>
          <Text style={s.pillText}>
            {today.isClockedIn
              ? `Clocked in since ${localTime(today.since!, today.timezone)}`
              : today.sessions > 0
                ? "Clocked out"
                : `Not clocked in · expected ${today.expectedStart}`}
          </Text>
        </View>

        {/* Two tiles: the day's total in lavender, the workplace check in butter.
            Colour carries state, not decoration. */}
        <View style={{ flexDirection: "row", gap: 12, marginTop: 18 }}>
          <View style={[s.tile, { backgroundColor: c.lilacSoft }]}>
            <View style={[s.iconChip, { backgroundColor: c.lilac }]}>
              <Text style={s.iconChipText}>⏱</Text>
            </View>
            <View>
              <Text style={[s.big, { marginTop: 0 }]}>{formatDuration(totalMs)}</Text>
              <Text style={{ fontSize: 13, color: c.lilacInk, marginTop: 2 }}>
                today{today.sessions > 1 ? ` · ${today.sessions} sessions` : ""}
              </Text>
            </View>
          </View>

          <View
            style={[
              s.tile,
              { backgroundColor: status?.tone === "ok" ? c.inBg : c.butterSoft },
            ]}
          >
            <View
              style={[
                s.iconChip,
                { backgroundColor: status?.tone === "ok" ? "#BFE3CE" : c.butter },
              ]}
            >
              <Text style={s.iconChipText}>📍</Text>
            </View>
            <View>
              <Text
                style={{
                  fontSize: 14,
                  fontWeight: "600",
                  color: status?.tone === "ok" ? c.in : c.butterInk,
                }}
              >
                {status ? status.text : "No check yet"}
              </Text>
              <Text style={{ fontSize: 12, color: c.muted, marginTop: 3 }}>
                {today.workplace
                  ? `${today.workplace.name} · ${today.workplace.radiusM}m`
                  : "No workplace assigned"}
              </Text>
            </View>
          </View>
        </View>

        {today.isLate && <Text style={s.warn}>Marked late today</Text>}
        {!today.workplace && (
          <Text style={s.warn}>
            Ask your admin to assign you a workplace, or attendance cannot be verified.
          </Text>
        )}
        {notice && <Text style={s.warn}>{notice}</Text>}
        {error && <Text style={s.error}>{error}</Text>}
      </ScrollView>

      <View style={{ paddingHorizontal: 22, paddingBottom: 12 }}>
        <TouchableOpacity
          style={[s.bigButton, today.isClockedIn ? s.buttonOut : s.buttonIn, busy && { opacity: 0.6 }]}
          onPress={press}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={today.isClockedIn ? "Clock out" : "Clock in"}
        >
          {busy ? (
            <ActivityIndicator color={c.onDark} size="large" />
          ) : (
            <Text style={s.bigButtonText}>
              {today.isClockedIn ? "Clock Out" : "Clock In"}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function localTime(at: number, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

function localDate(at: number, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(at));
}

function formatDuration(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
