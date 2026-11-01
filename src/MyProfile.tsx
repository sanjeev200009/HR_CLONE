import { useState } from "react";
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";

// Profile self-service.
//
// An employee may change what they present and how to reach them. Job title,
// department, manager and join date are NOT here: they are employment facts, and
// a join date that an employee can edit is leave entitlement an employee can
// manufacture. The server enforces that split (convex/directory.ts); this screen
// just does not offer the fields.

type Props = {
  orgId: Id<"organizations">;
  initial: { fullName: string; phone: string | null; about: string | null; emergencyContact: string | null };
  onDone: () => void;
};

export default function MyProfile({ orgId, initial, onDone }: Props) {
  const update = useMutation(api.directory.updateMyProfile);

  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [about, setAbout] = useState(initial.about ?? "");
  const [emergency, setEmergency] = useState(initial.emergencyContact ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await update({
        orgId,
        fullName,
        phone: phone || undefined,
        about: about || undefined,
        emergencyContact: emergency || undefined,
      });
      setSaved(true);
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setError(raw.replace(/^[\s\S]*Uncaught Error:\s*/, "").split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={s.screen}>
      <TouchableOpacity onPress={onDone}>
        <Text style={{ color: c.link, fontSize: 15, marginBottom: 12 }}>← Team</Text>
      </TouchableOpacity>

      <Text style={s.h1}>My profile</Text>
      <Text style={s.muted}>Your name, how to reach you, and who to call.</Text>

      <Text style={s.label}>Name</Text>
      <TextInput style={s.input} value={fullName} onChangeText={setFullName} />

      <Text style={s.label}>Phone</Text>
      <TextInput
        style={s.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="0771234567"
      />

      <Text style={s.label}>Emergency contact</Text>
      <TextInput
        style={s.input}
        value={emergency}
        onChangeText={setEmergency}
        placeholder="Name and number"
      />
      <Text style={s.fine}>
        Only you, your manager and your HR admin can see your phone and emergency
        contact. It is never in the team directory.
      </Text>

      <Text style={s.label}>About (optional)</Text>
      <TextInput
        style={[s.input, { height: 90, textAlignVertical: "top" }]}
        value={about}
        onChangeText={setAbout}
        multiline
        maxLength={500}
        placeholder="What you do here."
      />

      {error && <Text style={s.error}>{error}</Text>}
      {saved && <Text style={s.ok}>Saved.</Text>}

      <TouchableOpacity style={s.button} onPress={save} disabled={busy}>
        {busy ? (
          <ActivityIndicator color={c.onDark} />
        ) : (
          <Text style={s.buttonText}>Save profile</Text>
        )}
      </TouchableOpacity>

      <Text style={s.fine}>
        Your job title, department, manager and start date are set by your HR admin.
      </Text>
    </View>
  );
}
