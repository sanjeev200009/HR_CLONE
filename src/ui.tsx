import { StyleSheet } from "react-native";

// One stylesheet for the whole app. It is three screens; it does not need a
// design system. Grows into one only if it ever stops fitting here.
export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff", padding: 24, justifyContent: "center" },
  h1: { fontSize: 28, fontWeight: "700", marginBottom: 4 },
  muted: { fontSize: 15, color: "#666", marginBottom: 24 },
  label: { fontSize: 13, color: "#444", marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#d4d4d4",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
  },
  button: {
    backgroundColor: "#111",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
  },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
  link: { color: "#2563eb", fontSize: 15, marginTop: 20, textAlign: "center" },
  error: { color: "#b91c1c", fontSize: 14, marginTop: 14 },
});
