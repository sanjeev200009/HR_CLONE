import { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";
import MyProfile from "./MyProfile";

// Company directory. Read-only on mobile on purpose: giving feedback is a
// considered act, and a phone list is where you look someone up, not where you
// write an appraisal. The web dashboard has the full feedback flow.

type Props = { orgId: Id<"organizations">; me: { fullName: string }; onSignOut: () => void };

export default function Team({ orgId, me, onSignOut }: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Id<"members"> | null>(null);
  const [editing, setEditing] = useState(false);
  const people = useQuery(api.directory.list, { orgId, search: search || undefined });

  if (editing) {
    return (
      <MyProfile
        orgId={orgId}
        initial={{ fullName: me.fullName, phone: null, about: null, emergencyContact: null }}
        onDone={() => setEditing(false)}
      />
    );
  }
  if (open) return <Person orgId={orgId} memberId={open} onBack={() => setOpen(null)} />;

  return (
    <View style={s.screen}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <Text style={s.h1}>Team</Text>
        <View style={{ flexDirection: "row", gap: 16, paddingBottom: 6 }}>
          <TouchableOpacity onPress={() => setEditing(true)}>
            <Text style={{ color: c.link, fontSize: 15, fontWeight: "500" }}>My profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onSignOut}>
            <Text style={{ color: c.muted, fontSize: 15 }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TextInput
        style={s.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, title or department"
        autoCapitalize="none"
      />

      {people === undefined ? (
        <ActivityIndicator style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          style={{ marginTop: 8 }}
          data={people}
          keyExtractor={(p) => p._id}
          ListEmptyComponent={<Text style={s.muted}>Nobody matches that.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={s.row} onPress={() => setOpen(item._id)}>
              <Text style={s.rowTitle}>{item.fullName}</Text>
              <Text style={s.rowSub}>
                {item.jobTitle ?? "—"}
                {item.department ? ` · ${item.department}` : ""}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function Person({
  orgId,
  memberId,
  onBack,
}: {
  orgId: Id<"organizations">;
  memberId: Id<"members">;
  onBack: () => void;
}) {
  const p = useQuery(api.directory.profile, { orgId, memberId });

  if (p === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      <TouchableOpacity onPress={onBack}>
        <Text style={{ color: c.link, fontSize: 15, marginBottom: 12 }}>← Team</Text>
      </TouchableOpacity>

      <Text style={s.h1}>{p.fullName}</Text>
      <Text style={s.muted}>{p.jobTitle ?? "—"}</Text>

      <Text style={s.label}>Email</Text>
      <Text style={s.rowTitle}>{p.email}</Text>

      {/* phone and emergencyContact only arrive for self, manager or admin —
          the server decides, so there is no flag here to get wrong. */}
      {p.canSeeContact && (
        <>
          <Text style={s.label}>Phone</Text>
          <Text style={s.rowTitle}>{p.phone ?? "—"}</Text>
          <Text style={s.label}>Emergency contact</Text>
          <Text style={s.rowTitle}>{p.emergencyContact ?? "—"}</Text>
        </>
      )}

      <Text style={s.label}>Department</Text>
      <Text style={s.rowTitle}>{p.department ?? "—"}</Text>

      <Text style={s.label}>Manager</Text>
      <Text style={s.rowTitle}>{p.manager?.fullName ?? "—"}</Text>

      {p.reports.length > 0 && (
        <>
          <Text style={s.label}>Manages</Text>
          <Text style={s.rowTitle}>{p.reports.map((r) => r.fullName).join(", ")}</Text>
        </>
      )}

      {p.about && (
        <>
          <Text style={s.label}>About</Text>
          <Text style={s.rowSub}>{p.about}</Text>
        </>
      )}
    </View>
  );
}
