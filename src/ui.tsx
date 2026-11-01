import { StyleSheet } from "react-native";

// The design system, taken from the reference: soft lilac ground, white cards on
// generous radii, one lavender and one butter accent, ink for the single primary
// action. Minimal, warm, and quiet enough to read at a factory gate.
//
// Two rules kept from the earlier art direction, because they are about truth
// rather than taste:
//   - colour goes on DATA and state, never on chrome for decoration
//   - every figure is tabular, so a column of times does not jitter as it ticks

export const c = {
  // ground + surfaces
  bg: "#F4F1F8", // warm pale lilac, not grey
  surface: "#FFFFFF",
  sunken: "#EEEAF6",

  // ink
  text: "#141318",
  muted: "#6E6880",
  fine: "#6B6579",
  border: "#E7E2F0",
  onDark: "#FFFFFF",

  // the two accents
  lilac: "#C9C0F2",
  lilacSoft: "#E9E5FB",
  lilacInk: "#4A3F86",
  butter: "#FBE5A2",
  butterSoft: "#FEF4D4",
  butterInk: "#7A5B10",

  // state. Deliberately muted to sit inside the palette rather than shout.
  in: "#2F7D5B", // clocked in / verified
  inBg: "#DEF0E6",
  warn: "#9A6B12",
  warnBg: "#FDF0D6",
  error: "#B4384A",
  errorBg: "#FBE4E7",
  link: "#5B4BC4",

  // kept so older call sites still resolve
  out: "#141318",
  outBg: "#EEEAF6",
};

/** One soft lift. Used sparingly — only on cards that float above the ground. */
const lift = {
  shadowColor: "#2B2440",
  shadowOpacity: 0.06,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
};

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg, padding: 22 },

  // Type. The headline is large and light, the way the reference sets it.
  h1: { fontSize: 32, fontWeight: "600", color: c.text, letterSpacing: -0.6 },
  h2: { fontSize: 18, fontWeight: "600", color: c.text, marginTop: 26, marginBottom: 10 },
  muted: { fontSize: 15, color: c.muted, marginTop: 4 },
  fine: { fontSize: 13, color: c.fine, marginTop: 8, lineHeight: 18 },
  label: { fontSize: 13, color: c.muted, marginBottom: 8, marginTop: 16, fontWeight: "500" },

  // The clock face and the day's total: the two figures the app exists to show.
  clock: {
    fontSize: 60,
    fontWeight: "300",
    color: c.text,
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  big: {
    fontSize: 36,
    fontWeight: "600",
    color: c.text,
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },

  // Status pill.
  pill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  pillIn: { backgroundColor: c.inBg },
  pillOut: { backgroundColor: c.sunken },
  pillText: { fontSize: 13, fontWeight: "600", color: c.text },

  input: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 15,
    fontSize: 16,
    color: c.text,
  },

  // The one filled action, in ink, fully rounded.
  button: {
    backgroundColor: c.text,
    borderRadius: 999,
    paddingVertical: 17,
    alignItems: "center",
    marginTop: 22,
  },
  buttonText: { color: c.onDark, fontSize: 16, fontWeight: "600" },

  // The clock action. Deliberately oversized: pressed twice a day, often
  // one-handed, sometimes in a hurry at a gate.
  bigButton: {
    borderRadius: 32,
    paddingVertical: 26,
    alignItems: "center",
    justifyContent: "center",
    ...lift,
  },
  bigButtonText: { color: c.onDark, fontSize: 22, fontWeight: "700", letterSpacing: -0.3 },
  buttonIn: { backgroundColor: c.text },
  buttonOut: { backgroundColor: c.text },

  // Cards. White on lilac, generous radius, one soft lift.
  card: { backgroundColor: c.surface, borderRadius: 26, padding: 20, marginTop: 14, ...lift },
  cardLilac: { backgroundColor: c.lilacSoft, borderRadius: 26, padding: 20, marginTop: 14 },
  cardButter: { backgroundColor: c.butterSoft, borderRadius: 26, padding: 20, marginTop: 14 },
  cardInk: { backgroundColor: c.text, borderRadius: 26, padding: 20, marginTop: 14 },

  // A tile in the two-up action grid.
  tile: { flex: 1, borderRadius: 26, padding: 18, minHeight: 132, justifyContent: "space-between" },

  /** The round icon chip that leads a tile or a list row. */
  iconChip: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  iconChipText: { fontSize: 18 },

  // List rows sit on their own white capsule rather than sharing a ruled table.
  row: {
    backgroundColor: c.surface,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginTop: 10,
  },
  rowTitle: { fontSize: 15, fontWeight: "600", color: c.text },
  rowSub: { fontSize: 13, color: c.muted, marginTop: 3 },

  chip: {
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chipOn: { backgroundColor: c.lilac, borderColor: c.lilac },
  chipText: { fontSize: 14, color: c.muted },
  chipTextOn: { fontSize: 14, color: c.lilacInk, fontWeight: "600" },

  link: { color: c.link, fontSize: 15, marginTop: 20, textAlign: "center", fontWeight: "500" },
  ok: { color: c.in, fontSize: 14, marginTop: 12, fontWeight: "500" },
  warn: { color: c.warn, fontSize: 14, marginTop: 12, fontWeight: "500" },
  error: { color: c.error, fontSize: 14, marginTop: 14, fontWeight: "500" },

  // The floating tab bar from the reference: a white capsule lifted off the
  // ground rather than a rule across the bottom.
  tabBar: {
    flexDirection: "row",
    backgroundColor: c.surface,
    borderRadius: 999,
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 6,
    paddingVertical: 6,
    ...lift,
  },
  tab: { flex: 1, borderRadius: 999, paddingVertical: 11, alignItems: "center" },
  tabOn: { backgroundColor: c.lilacSoft },
  tabText: { fontSize: 12, fontWeight: "500", color: c.muted },
  tabTextOn: { fontSize: 12, fontWeight: "700", color: c.lilacInk },
});

export { lift };
