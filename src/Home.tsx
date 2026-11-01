import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { s, c } from "./ui";
import { usePush } from "./usePush";
import Clock from "./Clock";
import History from "./History";
import Leave from "./Leave";
import Team from "./Team";
import Pay from "./Pay";

// Post-sign-in routing. Four states worth distinguishing, because "it doesn't work"
// from a pilot customer is usually one of the middle two:
//   loading | not claimed yet | admin (wrong app) | employee -> clock screen
type Tab = "clock" | "history" | "leave" | "pay" | "team";

const LABELS: Record<Tab, string> = {
  clock: "Clock",
  history: "Hours",
  leave: "Leave",
  pay: "Pay",
  team: "Team",
};

export default function Home() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const memberships = useQuery(api.members.me);
  const claim = useMutation(api.members.claim);
  const [tab, setTab] = useState<Tab>("clock");

  // First sign-in: bind this Clerk user to the member row the admin pre-created.
  // Runs once the query has resolved to an empty list. members.claim is idempotent.
  useEffect(() => {
    if (memberships?.length === 0) claim().catch(() => {});
  }, [memberships, claim]);

  // ponytail: one membership per person for now. Multi-org (a consultant at two
  // client companies) needs an org picker — add it when a customer actually asks.
  const m = memberships?.[0] ?? null;
  usePush(m && m.role === "employee" ? m.orgId : null);

  // useQuery -> undefined while loading; members.me -> null when not signed in.
  if (memberships == null) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!m) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <Text style={s.h1}>Not set up yet</Text>
        <Text style={s.muted}>
          {user?.primaryEmailAddress?.emailAddress} isn't registered with any company on
          AttendanceHR. Ask your HR admin to add this exact email address, then reopen the
          app.
        </Text>
        <TouchableOpacity style={s.button} onPress={() => signOut()}>
          <Text style={s.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (m.role === "admin") {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <Text style={s.h1}>Hi {m.fullName}</Text>
        <Text style={s.muted}>
          You're an admin of {m.orgName}. This app is for employee clock in and out — use
          the web dashboard to manage your team.
        </Text>
        <TouchableOpacity style={s.button} onPress={() => signOut()}>
          <Text style={s.buttonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flex: 1 }}>
        {tab === "clock" && (
          <Clock orgId={m.orgId} orgName={m.orgName} fullName={m.fullName} />
        )}
        {tab === "history" && <History orgId={m.orgId} timezone={m.timezone} />}
        {tab === "leave" && <Leave orgId={m.orgId} timezone={m.timezone} />}
        {tab === "pay" && <Pay orgId={m.orgId} />}
        {tab === "team" && <Team orgId={m.orgId} me={{ fullName: m.fullName }} />}
      </View>

      {/* Four tabs now. Still a state switch rather than expo-router: there is
          no deep linking, no nested stack and no URL to honour on mobile. */}
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee" }}>
        {(["clock", "history", "leave", "pay", "team"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={{ flex: 1, paddingVertical: 14, alignItems: "center" }}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: tab === t ? "700" : "400",
                color: tab === t ? c.text : c.muted,
              }}
            >
              {LABELS[t]}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={{ paddingVertical: 14, paddingHorizontal: 14, alignItems: "center" }}
          onPress={() => signOut()}
        >
          <Text style={{ fontSize: 14, color: c.muted }}>Exit</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
