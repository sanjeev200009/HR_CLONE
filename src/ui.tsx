import { StyleSheet } from "react-native";

// One stylesheet for the whole app. It is a handful of screens; it does not need a
// design system. Grows into one only if it ever stops fitting here.

export const c = {
  bg: "#ffffff",
  text: "#111111",
  muted: "#666666",
  fine: "#8a8a8a",
  border: "#d4d4d4",
  onDark: "#ffffff",
  in: "#15803d", // clocked in / verified
  out: "#1f2937", // clocked out
  warn: "#b45309",
  error: "#b91c1c",
  link: "#2563eb",
  inBg: "#dcfce7",
  outBg: "#f3f4f6",
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, padding: 24 },
  h1: { fontSize: 28, fontWeight: "700", color: c.text, marginBottom: 4 },
  h2: { fontSize: 19, fontWeight: "600", color: c.text, marginTop: 20, marginBottom: 8 },
  muted: { fontSize: 15, color: c.muted, marginBottom: 4 },
  fine: { fontSize: 13, color: c.fine, marginTop: 6 },
  label: { fontSize: 13, color: "#444", marginBottom: 6, marginTop: 12 },

  // The clock face and today's total: the two numbers the screen exists to show.
  clock: { fontSize: 56, fontWeight: "200", color: c.text, marginVertical: 8, fontVariant: ["tabular-nums"] },
  big: { fontSize: 34, fontWeight: "600", color: c.text, marginTop: 16, fontVariant: ["tabular-nums"] },

  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  pillIn: { backgroundColor: c.inBg },
  pillOut: { backgroundColor: c.outBg },
  pillText: { fontSize: 14, fontWeight: "600", color: c.text },

  input: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 17,
    color: c.text,
  },
  button: { backgroundColor: c.text, borderRadius: 10, paddingVertical: 16, alignItems: "center", marginTop: 20 },
  buttonText: { color: c.onDark, fontSize: 17, fontWeight: "600" },

  // Deliberately oversized. This gets pressed twice a day, often one-handed,
  // sometimes in a hurry at a factory gate.
  bigButton: { borderRadius: 16, paddingVertical: 26, alignItems: "center", justifyContent: "center" },
  bigButtonText: { color: c.onDark, fontSize: 24, fontWeight: "700" },
  buttonIn: { backgroundColor: c.in },
  buttonOut: { backgroundColor: c.out },

  row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#eee" },
  rowTitle: { fontSize: 16, fontWeight: "600", color: c.text },
  rowSub: { fontSize: 13, color: c.muted, marginTop: 2 },

  // Balance cards and leave-type chips.
  card: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 12,
    padding: 16,
    marginTop: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { backgroundColor: c.text, borderColor: c.text },
  chipText: { fontSize: 14, color: c.text },
  chipTextOn: { fontSize: 14, color: c.onDark, fontWeight: "600" },

  link: { color: c.link, fontSize: 15, marginTop: 20, textAlign: "center" },
  ok: { color: c.in, fontSize: 14, marginTop: 10, fontWeight: "500" },
  warn: { color: c.warn, fontSize: 14, marginTop: 10, fontWeight: "500" },
  error: { color: c.error, fontSize: 14, marginTop: 14 },
});
