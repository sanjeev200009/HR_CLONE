import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";
import { readFix, deviceLabel, fixProblemMessage, FixProblem } from "./location";

// THE screen. An employee opens the app to answer one question — am I clocked in —
// and press one button. Everything else in this app is in service of this view.

type Props = { orgId: Id<"organizations">; orgName: string; fullName: string };

const statusText: Record<string, string> = {
  verified: "At your workplace",
  out_of_range: "Outside your workplace",
  low_accuracy: "Location too imprecise to verify",
  no_location: "No location recorded",
  suspect_mocked: "Location reported as simulated",
};

export default function Clock({ orgId, orgName, fullName }: Props) {
  const today = useQuery(api.attendance.today, { orgId });
  const clockIn = useMutation(api.attendance.clockIn);
  const clockOut = useMutation(api.attendance.clockOut);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // One tick per second, purely so the elapsed counter moves. The authoritative
  // instant is always the server's; this only drives the display.
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Note the device clock the moment a server timestamp lands. The difference is
  // this phone's skew, and every displayed time is corrected by it — so a employee
  // whose clock is an hour off still sees the right elapsed total.
  const [localAtFetch, setLocalAtFetch] = useState<number | null>(null);
  const serverNow = today?.serverNow;
  useEffect(() => {
    if (serverNow !== undefined) setLocalAtFetch(Date.now());
  }, [serverNow]);

  if (today === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  // The device clock may be wrong or deliberately wrong, so elapsed time is
  // measured as an offset from the server's "now" rather than read from the phone.
  const skew = localAtFetch === null ? 0 : today.serverNow - localAtFetch;
  const now = tick + skew;
  const liveMs = today.isClockedIn && today.since ? now - today.since : 0;
  const totalMs = today.totalMs + liveMs;

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
      // Convex prefixes thrown errors; show only the sentence we wrote.
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  const status = today.lastStatus;

  return (
    <View style={s.screen}>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={s.muted}>
          {orgName} · {localDate(now, today.timezone)}
        </Text>
        <Text style={s.h1}>{fullName}</Text>

        <Text style={s.clock}>{localTime(now, today.timezone)}</Text>

        <View style={[s.pill, today.isClockedIn ? s.pillIn : s.pillOut]}>
          <Text style={s.pillText}>
            {today.isClockedIn ? "Clocked in" : today.sessions > 0 ? "Clocked out" : "Not clocked in"}
          </Text>
        </View>

        <Text style={s.big}>{formatDuration(totalMs)}</Text>
        <Text style={s.muted}>
          {today.isClockedIn && today.since
            ? `Since ${localTime(today.since, today.timezone)}`
            : `Today · expected ${today.expectedStart}–${today.expectedEnd}`}
          {today.sessions > 1 ? ` · ${today.sessions} sessions` : ""}
        </Text>

        {today.isLate && <Text style={s.warn}>Marked late</Text>}

        {status && (
          <Text style={status === "verified" ? s.ok : s.warn}>
            {statusText[status] ?? status}
          </Text>
        )}

        {today.workplace && (
          <Text style={s.fine}>
            {today.workplace.name} · {today.workplace.radiusM}m radius
          </Text>
        )}
        {!today.workplace && (
          <Text style={s.warn}>
            No workplace assigned yet — ask your admin, or attendance cannot be verified.
          </Text>
        )}

        {notice && <Text style={s.warn}>{notice}</Text>}
        {error && <Text style={s.error}>{error}</Text>}
      </View>

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
          <Text style={s.bigButtonText}>{today.isClockedIn ? "Clock Out" : "Clock In"}</Text>
        )}
      </TouchableOpacity>
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
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(at));
}

function formatDuration(ms: number) {
  const total = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
