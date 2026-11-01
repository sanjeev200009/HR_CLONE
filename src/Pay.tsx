import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import { s, c } from "./ui";

// Payslips. Finalised runs only — the backend filters drafts out, because a
// draft is working material and showing it would have people reading a number
// that is about to change.
//
// Every deduction is itemised. A net figure an employee cannot decompose is the
// fastest way to get an argument about pay.

type Props = { orgId: Id<"organizations"> };

const money = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
};

export default function Pay({ orgId }: Props) {
  const slips = useQuery(api.payroll.myPayslips, { orgId });

  if (slips === undefined) {
    return (
      <View style={[s.screen, { justifyContent: "center" }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{ padding: 24 }}
      data={slips}
      keyExtractor={(p) => p._id}
      ListHeaderComponent={
        <>
          <Text style={s.h1}>Pay</Text>
          <Text style={s.muted}>Finalised payslips. Amounts in LKR.</Text>
        </>
      }
      ListEmptyComponent={
        <Text style={s.muted}>
          No payslips yet. They appear here once your company finalises a month.
        </Text>
      }
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.rowTitle}>{item.period}</Text>
          <Text style={s.big}>{money(item.netCents)}</Text>
          <Text style={s.fine}>take-home pay</Text>

          <View style={{ marginTop: 16, gap: 6 }}>
            <Line label="Basic" value={money(item.basicCents)} />
            {item.allowancesCents > 0 && (
              <Line label="Allowances" value={money(item.allowancesCents)} />
            )}
            {item.unpaidLeaveDays > 0 && (
              <Line
                label={`Unpaid leave (${item.unpaidLeaveDays} day${item.unpaidLeaveDays === 1 ? "" : "s"})`}
                value={`−${money(item.unpaidLeaveDeductionCents)}`}
                negative
              />
            )}
            {item.otHours > 0 && (
              <Line label={`Overtime (${item.otHours}h)`} value={money(item.otPayCents)} />
            )}
            <Line label="Gross" value={money(item.grossCents)} bold />
            <Line label="EPF (your share)" value={`−${money(item.epfEmployeeCents)}`} negative />
            {item.payeCalculated ? (
              <Line label="PAYE" value={`−${money(item.payeCents)}`} negative />
            ) : (
              <Line label="PAYE" value="not applied" />
            )}
            {item.otherDeductionsCents > 0 && (
              <Line
                label="Other deductions"
                value={`−${money(item.otherDeductionsCents)}`}
                negative
              />
            )}
            <Line label="Net pay" value={money(item.netCents)} bold />
          </View>

          <Text style={s.fine}>
            Your employer also paid {money(item.epfEmployerCents)} EPF and{" "}
            {money(item.etfEmployerCents)} ETF on your behalf.
          </Text>
        </View>
      )}
    />
  );
}

function Line({
  label,
  value,
  negative,
  bold,
}: {
  label: string;
  value: string;
  negative?: boolean;
  bold?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={{ fontSize: 14, color: c.muted, fontWeight: bold ? "600" : "400" }}>
        {label}
      </Text>
      <Text
        style={{
          fontSize: 14,
          fontVariant: ["tabular-nums"],
          color: negative ? c.error : c.text,
          fontWeight: bold ? "700" : "400",
        }}
      >
        {value}
      </Text>
    </View>
  );
}
