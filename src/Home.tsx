import { useEffect, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { s, c } from "./ui";
import { usePush } from "./usePush";
import Clock from "./Clock";
import History from "./History";

// Post-sign-in routing. Four states worth distinguishing, because "it doesn't work"
// from a pilot customer is usually one of the middle two:
//   loading | not claimed yet | admin (wrong app) | employee -> clock screen
export default function Home() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const memberships = useQuery(api.members.me);
  const claim = useMutation(api.members.claim);
  const [tab, setTab] = useState<"clock" | "history">("clock");

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
        {tab === "clock" ? (
          <Clock orgId={m.orgId} orgName={m.orgName} fullName={m.fullName} />
        ) : (
          <History orgId={m.orgId} timezone={m.timezone} />
        )}
      </View>

      {/* Two screens does not justify a router. Revisit at the third. */}
      <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee" }}>
        {(["clock", "history"] as const).map((t) => (
          <TouchableOpacity
            key={t}
            style={{ flex: 1, paddingVertical: 14, alignItems: "center" }}
            onPress={() => setTab(t)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: tab === t ? "700" : "400",
                color: tab === t ? c.text : c.muted,
              }}
            >
              {t === "clock" ? "Clock" : "History"}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={{ paddingVertical: 14, paddingHorizontal: 18, alignItems: "center" }}
          onPress={() => signOut()}
        >
          <Text style={{ fontSize: 15, color: c.muted }}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
