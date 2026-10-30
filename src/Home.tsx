import { useEffect } from "react";
import { Text, TouchableOpacity, View, ActivityIndicator } from "react-native";
import { useAuth, useUser } from "@clerk/expo";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { s } from "./ui";

// Post-sign-in routing. Four states worth distinguishing, because "it doesn't work"
// from a pilot customer is usually one of the middle two:
//   loading | not claimed yet | admin (wrong app) | employee -> clock screen
export default function Home() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const memberships = useQuery(api.members.me);
  const claim = useMutation(api.members.claim);

  // First sign-in: bind this Clerk user to the member row the admin pre-created.
  // Runs once the query has resolved to an empty list. members.claim is idempotent.
  useEffect(() => {
    if (memberships?.length === 0) claim().catch(() => {});
  }, [memberships, claim]);

  // useQuery -> undefined while loading; members.me -> null when not signed in.
  if (memberships == null) {
    return (
      <View style={s.screen}>
        <ActivityIndicator />
      </View>
    );
  }

  if (memberships.length === 0) {
    return (
      <View style={s.screen}>
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

  // ponytail: one membership per person for now. Multi-org (a consultant at two
  // client companies) needs an org picker — add it when a customer actually asks.
  const m = memberships[0];

  if (m.role === "admin") {
    return (
      <View style={s.screen}>
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
    <View style={s.screen}>
      <Text style={s.h1}>Hi {m.fullName}</Text>
      <Text style={s.muted}>
        {m.orgName} · {m.timezone}
      </Text>
      <Text style={s.label}>
        Signed in and bound to your membership. The clock in/out button lands in phase M2
        and the GPS check in M3.
      </Text>
      <TouchableOpacity style={s.button} onPress={() => signOut()}>
        <Text style={s.buttonText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}
