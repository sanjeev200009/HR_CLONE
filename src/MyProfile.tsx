import { useState } from "react";
import { ActivityIndicator, Image, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
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
  const uploadUrl = useMutation(api.directory.avatarUploadUrl);

  const [fullName, setFullName] = useState(initial.fullName);
  const [phone, setPhone] = useState(initial.phone ?? "");
  const [about, setAbout] = useState(initial.about ?? "");
  const [emergency, setEmergency] = useState(initial.emergencyContact ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [storageId, setStorageId] = useState<Id<"_storage"> | null>(null);
  const [uploading, setUploading] = useState(false);

  /**
   * Pick a photo and upload it straight to Convex storage.
   *
   * The upload URL is short-lived and issued per request, so the file goes
   * browser -> storage without passing through a mutation (Convex mutations
   * cannot take binary, and routing an image through one would be the slow,
   * wrong way round).
   */
  async function pickPhoto() {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Photo permission is off. Turn it on in Settings to change your picture.");
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      // A profile thumbnail does not need a 12MP original, and a factory-gate
      // phone on mobile data should not upload one.
      quality: 0.6,
    });
    if (picked.canceled) return;

    const asset = picked.assets[0];
    setUploading(true);
    try {
      const url = await uploadUrl({ orgId });
      const blob = await (await fetch(asset.uri)).blob();
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": asset.mimeType ?? "image/jpeg" },
        body: blob,
      });
      if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
      const { storageId: id } = (await res.json()) as { storageId: Id<"_storage"> };
      setStorageId(id);
      setPhoto(asset.uri); // show the local file immediately, not after a round trip
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

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
        avatarStorageId: storageId ?? undefined,
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

      <TouchableOpacity
        onPress={pickPhoto}
        disabled={uploading}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 16 }}
      >
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: 64, height: 64, borderRadius: 999 }} />
        ) : (
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              backgroundColor: c.inBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontSize: 22, fontWeight: "600", color: c.in }}>
              {initial.fullName.trim().charAt(0).toUpperCase() || "?"}
            </Text>
          </View>
        )}
        <Text style={{ color: c.link, fontSize: 15 }}>
          {uploading ? "Uploading…" : photo ? "Change photo" : "Add a photo"}
        </Text>
      </TouchableOpacity>

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
