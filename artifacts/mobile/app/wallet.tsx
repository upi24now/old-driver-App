import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type TxnType = "earning" | "withdraw" | "bonus" | "tip";
type Filter = "all" | "earning" | "withdraw" | "bonus";

type Transaction = {
  id: string;
  type: TxnType;
  title: string;
  subtitle: string;
  amount: number;
  status: "completed" | "pending" | "failed";
  time: string;
  date: string;
};

const TRANSACTIONS: Transaction[] = [
  { id: "t1", type: "earning", title: "Trip · Indiranagar → Whitefield", subtitle: "9.6 km · UPI", amount: 186, status: "completed", time: "2:42 PM", date: "Today" },
  { id: "t2", type: "tip", title: "Tip from Priya S.", subtitle: "Trip #4827", amount: 24, status: "completed", time: "2:42 PM", date: "Today" },
  { id: "t3", type: "earning", title: "Trip · HSR → Koramangala", subtitle: "4.1 km · Cash", amount: 92, status: "completed", time: "1:18 PM", date: "Today" },
  { id: "t4", type: "bonus", title: "Daily streak bonus", subtitle: "10 trips completed", amount: 150, status: "completed", time: "11:30 AM", date: "Today" },
  { id: "t5", type: "withdraw", title: "Withdrawal to HDFC ••2841", subtitle: "Instant transfer", amount: -2400, status: "completed", time: "9:14 AM", date: "Today" },
  { id: "t6", type: "earning", title: "Trip · Airport → MG Road", subtitle: "32 km · UPI", amount: 478, status: "completed", time: "8:02 PM", date: "Yesterday" },
  { id: "t7", type: "earning", title: "Trip · Marathahalli → BTM", subtitle: "12.3 km · UPI", amount: 215, status: "completed", time: "5:46 PM", date: "Yesterday" },
  { id: "t8", type: "withdraw", title: "Withdrawal to HDFC ••2841", subtitle: "Pending review", amount: -1200, status: "pending", time: "4:20 PM", date: "Yesterday" },
];

const TYPE_META: Record<TxnType, { icon: string; color: string; bg: string }> = {
  earning: { icon: "navigation", color: "#00C853", bg: "#f0fdf4" },
  tip: { icon: "heart", color: "#E91E63", bg: "#fce4ec" },
  bonus: { icon: "gift", color: "#9C27B0", bg: "#f3e5f5" },
  withdraw: { icon: "arrow-up-right", color: "#1976D2", bg: "#e3f2fd" },
};

function TransactionRow({ txn }: { txn: Transaction }) {
  const colors = useColors();
  const meta = TYPE_META[txn.type];
  const isDebit = txn.amount < 0;

  return (
    <View style={styles.txnRow}>
      <View style={[styles.txnIcon, { backgroundColor: meta.bg }]}>
        <Feather name={meta.icon as any} size={16} color={meta.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.txnTitle, { color: colors.foreground }]} numberOfLines={1}>
          {txn.title}
        </Text>
        <View style={styles.txnMeta}>
          <Text style={[styles.txnSub, { color: colors.mutedForeground }]}>
            {txn.subtitle}
          </Text>
          <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
          <Text style={[styles.txnSub, { color: colors.mutedForeground }]}>
            {txn.time}
          </Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 3 }}>
        <Text
          style={[
            styles.txnAmount,
            { color: isDebit ? "#0a0a0a" : "#00C853" },
          ]}
        >
          {isDebit ? "-" : "+"}₹{Math.abs(txn.amount).toLocaleString()}
        </Text>
        {txn.status === "pending" && (
          <View style={[styles.statusPill, { backgroundColor: "#fff5e6" }]}>
            <Text style={[styles.statusPillText, { color: "#b75d00" }]}>
              Pending
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function WalletScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = TRANSACTIONS.filter((t) => {
    if (filter === "all") return true;
    if (filter === "earning") return t.type === "earning" || t.type === "tip";
    return t.type === filter;
  });

  const grouped = filtered.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  return (
    <View style={{ flex: 1, backgroundColor: "#fafafa" }}>
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + 12, backgroundColor: "#fff" },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: "#f5f5f5" }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color="#0a0a0a" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wallet</Text>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: "#f5f5f5" }]}
          activeOpacity={0.7}
        >
          <Feather name="help-circle" size={18} color="#0a0a0a" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        {/* BALANCE HERO */}
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          <View style={styles.balanceTopRow}>
            <View>
              <Text style={styles.balanceLabel}>AVAILABLE BALANCE</Text>
              <View style={styles.balanceAmountRow}>
                <Text style={styles.balanceCurrency}>₹</Text>
                <Text style={styles.balanceAmount}>8,420</Text>
                <Text style={styles.balanceDecimal}>.50</Text>
              </View>
              <View style={styles.balanceMetaRow}>
                <View style={[styles.dotGreen, { backgroundColor: colors.primary }]} />
                <Text style={styles.balanceMeta}>
                  Last withdrawn ₹2,400 · Today
                </Text>
              </View>
            </View>
            <View style={styles.balanceIconWrap}>
              <Feather name="credit-card" size={20} color="rgba(255,255,255,0.85)" />
            </View>
          </View>

          <View style={styles.balanceActions}>
            <TouchableOpacity
              style={[styles.withdrawBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.85}
            >
              <Feather name="arrow-down-circle" size={17} color="#fff" />
              <Text style={styles.withdrawText}>Withdraw to Bank</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ghostActionBtn}
              activeOpacity={0.7}
            >
              <Feather name="zap" size={15} color="#fff" />
              <Text style={styles.ghostActionText}>Instant</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.bankRow}>
            <Feather name="check-circle" size={11} color={colors.primary} />
            <Text style={styles.bankText}>
              HDFC Bank ••2841 · Default payout
            </Text>
            <Feather name="chevron-right" size={13} color="rgba(255,255,255,0.5)" />
          </View>
        </LinearGradient>

        {/* PERIOD STATS */}
        <View style={styles.periodRow}>
          {[
            { label: "This Week", value: "12,480", delta: "+18%", days: "Mon – Sun" },
            { label: "This Month", value: "48,920", delta: "+24%", days: "May 2026" },
          ].map((p) => (
            <TouchableOpacity
              key={p.label}
              style={[styles.periodCard, { borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <View style={styles.periodTopRow}>
                <Text style={[styles.periodLabel, { color: colors.mutedForeground }]}>
                  {p.label}
                </Text>
                <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.periodAmount, { color: colors.foreground }]}>
                ₹{p.value}
              </Text>
              <View style={styles.periodBottom}>
                <View style={[styles.deltaPill, { backgroundColor: "#f0fdf4" }]}>
                  <Feather name="trending-up" size={9} color={colors.primary} />
                  <Text style={[styles.deltaText, { color: colors.primary }]}>
                    {p.delta}
                  </Text>
                </View>
                <Text style={[styles.periodDays, { color: colors.mutedForeground }]}>
                  {p.days}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* EARNINGS BREAKDOWN */}
        <View style={[styles.breakdownCard, { borderColor: colors.border }]}>
          <View style={styles.breakdownHeader}>
            <Text style={[styles.breakdownTitle, { color: colors.foreground }]}>
              Earnings breakdown
            </Text>
            <Text style={[styles.breakdownPeriod, { color: colors.mutedForeground }]}>
              Today
            </Text>
          </View>
          <View style={styles.breakdownItems}>
            {[
              { label: "Trip fares", value: 1074, icon: "navigation", color: "#00C853" },
              { label: "Tips", value: 24, icon: "heart", color: "#E91E63" },
              { label: "Bonuses", value: 150, icon: "gift", color: "#9C27B0" },
            ].map((b) => (
              <View key={b.label} style={styles.breakdownItem}>
                <View style={[styles.breakdownIcon, { backgroundColor: b.color + "1a" }]}>
                  <Feather name={b.icon as any} size={13} color={b.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.breakdownLabel, { color: colors.foreground }]}>
                    {b.label}
                  </Text>
                </View>
                <Text style={[styles.breakdownValue, { color: colors.foreground }]}>
                  ₹{b.value.toLocaleString()}
                </Text>
              </View>
            ))}
            <View style={[styles.breakdownTotal, { borderTopColor: colors.border }]}>
              <Text style={[styles.breakdownTotalLabel, { color: colors.mutedForeground }]}>
                Total earned today
              </Text>
              <Text style={[styles.breakdownTotalValue, { color: colors.primary }]}>
                ₹1,248
              </Text>
            </View>
          </View>
        </View>

        {/* FILTERS + TRANSACTIONS */}
        <View style={styles.transactionsSection}>
          <View style={styles.txnHeaderRow}>
            <Text style={[styles.txnSectionTitle, { color: colors.foreground }]}>
              Transactions
            </Text>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={[styles.txnSeeAll, { color: colors.primary }]}>
                Export
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {[
              { id: "all" as Filter, label: "All" },
              { id: "earning" as Filter, label: "Earnings" },
              { id: "withdraw" as Filter, label: "Withdrawals" },
              { id: "bonus" as Filter, label: "Bonuses" },
            ].map((f) => {
              const active = filter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active ? "#0a0a0a" : "#fff",
                      borderColor: active ? "#0a0a0a" : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      { color: active ? "#fff" : colors.foreground },
                    ]}
                  >
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {Object.entries(grouped).map(([date, items]) => (
            <View key={date} style={styles.txnGroup}>
              <View style={styles.txnGroupHeader}>
                <Text style={[styles.txnGroupTitle, { color: colors.mutedForeground }]}>
                  {date}
                </Text>
                <Text style={[styles.txnGroupCount, { color: colors.mutedForeground }]}>
                  {items.length} transaction{items.length > 1 ? "s" : ""}
                </Text>
              </View>
              <View style={[styles.txnList, { borderColor: colors.border }]}>
                {items.map((t, i) => (
                  <View key={t.id}>
                    <TransactionRow txn={t} />
                    {i < items.length - 1 && (
                      <View
                        style={[
                          styles.txnDivider,
                          { backgroundColor: colors.border },
                        ]}
                      />
                    )}
                  </View>
                ))}
              </View>
            </View>
          ))}

          {filtered.length === 0 && (
            <View style={[styles.emptyState, { borderColor: colors.border }]}>
              <Feather name="inbox" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No transactions in this category
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#0a0a0a", letterSpacing: -0.2 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  balanceCard: {
    borderRadius: 20,
    padding: 18,
    gap: 16,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  balanceTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  balanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.6)",
    letterSpacing: 0.6,
  },
  balanceAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: 6 },
  balanceCurrency: {
    fontSize: 22,
    fontWeight: "700",
    color: "#fff",
    marginBottom: 6,
    marginRight: 2,
  },
  balanceAmount: {
    fontSize: 40,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1.5,
    lineHeight: 44,
  },
  balanceDecimal: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255,255,255,0.55)",
    marginBottom: 4,
    marginLeft: 1,
  },
  balanceMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  dotGreen: { width: 6, height: 6, borderRadius: 3 },
  balanceMeta: { fontSize: 11, color: "rgba(255,255,255,0.6)", fontWeight: "500" },
  balanceIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },

  balanceActions: { flexDirection: "row", gap: 8 },
  withdrawBtn: {
    flex: 1,
    height: 48,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  withdrawText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  ghostActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  ghostActionText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  bankRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.07)",
    padding: 10,
    borderRadius: 11,
  },
  bankText: { flex: 1, fontSize: 12, color: "rgba(255,255,255,0.8)", fontWeight: "600" },

  periodRow: { flexDirection: "row", gap: 10 },
  periodCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  periodTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  periodLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  periodAmount: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  periodBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deltaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  deltaText: { fontSize: 10, fontWeight: "800" },
  periodDays: { fontSize: 10, fontWeight: "500" },

  breakdownCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  breakdownHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownTitle: { fontSize: 14, fontWeight: "800" },
  breakdownPeriod: { fontSize: 11, fontWeight: "600" },
  breakdownItems: { gap: 10 },
  breakdownItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  breakdownIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  breakdownLabel: { fontSize: 13, fontWeight: "600" },
  breakdownValue: { fontSize: 14, fontWeight: "800" },
  breakdownTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
  },
  breakdownTotalLabel: { fontSize: 12, fontWeight: "700" },
  breakdownTotalValue: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },

  transactionsSection: { gap: 12 },
  txnHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  txnSectionTitle: { fontSize: 16, fontWeight: "800" },
  txnSeeAll: { fontSize: 13, fontWeight: "700" },

  filterRow: { flexDirection: "row", gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterPill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  filterPillText: { fontSize: 12, fontWeight: "700" },

  txnGroup: { gap: 8 },
  txnGroupHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  txnGroupTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  txnGroupCount: { fontSize: 10, fontWeight: "600" },

  txnList: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  txnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
  },
  txnIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  txnTitle: { fontSize: 13, fontWeight: "700" },
  txnMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  txnSub: { fontSize: 11, fontWeight: "500" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  txnAmount: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  txnDivider: { height: 1, marginLeft: 58 },
  statusPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusPillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },

  emptyState: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 30,
    alignItems: "center",
    gap: 8,
  },
  emptyText: { fontSize: 12, fontWeight: "600" },
});
