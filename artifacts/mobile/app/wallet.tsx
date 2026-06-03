import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

// ─── Constants ────────────────────────────────────────────────────────────────
const LOCKED_BALANCE = 50;
const UPI_REGEX      = /^[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}$/;

// ─── Types ────────────────────────────────────────────────────────────────────
type TxnType = "earning" | "withdraw" | "bonus" | "tip";
type Filter   = "all" | "earning" | "withdraw" | "bonus";

type Transaction = {
  id:       string;
  type:     TxnType;
  title:    string;
  subtitle: string;
  amount:   number;
  status:   "completed" | "pending" | "failed";
  time:     string;
  date:     string;
};

// ─── Seed data (Phase 2 will replace with real Firestore reads) ───────────────
const SEED_YESTERDAY: Transaction[] = [
  { id: "t6", type: "earning",  title: "Trip · Airport → MG Road",      subtitle: "32 km · UPI",  amount:  478, status: "completed", time: "8:02 PM", date: "Yesterday" },
  { id: "t7", type: "earning",  title: "Trip · Marathahalli → BTM",     subtitle: "12.3 km · UPI", amount: 215, status: "completed", time: "5:46 PM", date: "Yesterday" },
  { id: "t8", type: "withdraw", title: "Withdrawal via UPI",             subtitle: "Pending review", amount: -1200, status: "pending", time: "4:20 PM", date: "Yesterday" },
];

const TYPE_META: Record<TxnType, { icon: string; color: string; bg: string }> = {
  earning:  { icon: "navigation",    color: "#00C853", bg: "#f0fdf4" },
  tip:      { icon: "heart",         color: "#E91E63", bg: "#fce4ec" },
  bonus:    { icon: "gift",          color: "#9C27B0", bg: "#f3e5f5" },
  withdraw: { icon: "arrow-up-right", color: "#1976D2", bg: "#e3f2fd" },
};

// ─── TransactionRow ───────────────────────────────────────────────────────────
function TransactionRow({ txn }: { txn: Transaction }) {
  const colors = useColors();
  const meta   = TYPE_META[txn.type];
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
        <Text style={[styles.txnAmount, { color: isDebit ? "#0a0a0a" : "#00C853" }]}>
          {isDebit ? "-" : "+"}₹{Math.abs(txn.amount).toLocaleString("en-IN")}
        </Text>
        {txn.status === "pending" && (
          <View style={[styles.statusPill, { backgroundColor: "#fff5e6" }]}>
            <Text style={[styles.statusPillText, { color: "#b75d00" }]}>Pending</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const { walletBalance, todayEarnings, transactions, requestWithdrawal, refreshWallet, driverUid } = useDriver();

  const [filter, setFilter] = useState<Filter>("all");

  // Withdrawal form state
  const [upiId,       setUpiId]       = useState("");
  const [amountText,  setAmountText]  = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [success,     setSuccess]     = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);

  const amountRef = useRef<TextInput>(null);


  // ── Computed ────────────────────────────────────────────────────────────────
  const withdrawable   = Math.max(0, walletBalance - LOCKED_BALANCE);
  const canWithdraw    = walletBalance > LOCKED_BALANCE;
  const parsedAmount   = parseFloat(amountText.replace(/,/g, "")) || 0;
  const upiValid       = UPI_REGEX.test(upiId.trim());
  const amountValid    = parsedAmount > 0 && parsedAmount <= withdrawable;
  const btnEnabled     = canWithdraw && upiValid && amountValid && !submitting;

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleWithdraw = async () => {
    if (!btnEnabled) return;
    setSubmitting(true);
    setErrorMsg(null);
    const result = await requestWithdrawal(parsedAmount, upiId.trim());
    setSubmitting(false);
    if (result.ok) {
      setSuccess(true);
      setUpiId("");
      setAmountText("");
    } else {
      setErrorMsg(result.reason ?? "Withdrawal failed. Please try again.");
    }
  };

  // ── Transactions list ────────────────────────────────────────────────────────
  const allTxns: Transaction[] = [
    ...(transactions as Transaction[]),
    ...SEED_YESTERDAY,
  ];
  const filtered = allTxns.filter((t) => {
    if (filter === "all")     return true;
    if (filter === "earning") return t.type === "earning" || t.type === "tip";
    return t.type === filter;
  });
  const grouped = filtered.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12, backgroundColor: "#fff" }]}>
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
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── BALANCE HERO ──────────────────────────────────────────────────── */}
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.balanceCard}
        >
          {/* Top row: balance + icon */}
          <View style={styles.balanceTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.balanceLabel}>WALLET BALANCE</Text>
              <View style={styles.balanceAmountRow}>
                <Text style={styles.balanceCurrency}>₹</Text>
                <Text style={styles.balanceAmount}>
                  {Math.floor(walletBalance).toLocaleString("en-IN")}
                </Text>
                <Text style={styles.balanceDecimal}>
                  .{(walletBalance % 1).toFixed(2).slice(2)}
                </Text>
              </View>
            </View>
            <View style={styles.balanceIconWrap}>
              <Feather name="credit-card" size={20} color="rgba(255,255,255,0.85)" />
            </View>
          </View>

          {/* Balance breakdown: locked + withdrawable */}
          <View style={styles.balanceSplitRow}>
            <View style={styles.balanceSplitItem}>
              <View style={styles.balanceSplitDot} />
              <View>
                <Text style={styles.balanceSplitLabel}>LOCKED</Text>
                <Text style={styles.balanceSplitValue}>₹{LOCKED_BALANCE}</Text>
              </View>
            </View>
            <View style={[styles.balanceSplitDivider]} />
            <View style={styles.balanceSplitItem}>
              <View style={[styles.balanceSplitDot, { backgroundColor: "#00C853" }]} />
              <View>
                <Text style={styles.balanceSplitLabel}>WITHDRAWABLE</Text>
                <Text style={[styles.balanceSplitValue, { color: "#00C853" }]}>
                  ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </Text>
              </View>
            </View>
          </View>

          {/* Today's earnings chip */}
          {todayEarnings > 0 && (
            <View style={styles.todayChip}>
              <Feather name="trending-up" size={11} color="#00C853" />
              <Text style={styles.todayChipText}>
                +₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })} earned today
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* ── UPI WITHDRAWAL CARD ───────────────────────────────────────────── */}
        <View style={[styles.withdrawCard, { borderColor: colors.border }]}>
          <View style={styles.withdrawCardHeader}>
            <View style={[styles.withdrawCardIcon, { backgroundColor: "#e3f2fd" }]}>
              <Feather name="smartphone" size={16} color="#1976D2" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.withdrawCardTitle, { color: colors.foreground }]}>
                Withdraw via UPI
              </Text>
              <Text style={[styles.withdrawCardSub, { color: colors.mutedForeground }]}>
                {canWithdraw
                  ? `Up to ₹${withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })} available`
                  : "Minimum ₹50 must stay in wallet"}
              </Text>
            </View>
          </View>

          {success ? (
            /* Success state */
            <View style={styles.successBox}>
              <View style={styles.successIconWrap}>
                <Feather name="check-circle" size={28} color="#00C853" />
              </View>
              <Text style={[styles.successTitle, { color: colors.foreground }]}>
                Withdrawal request submitted
              </Text>
              <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                Amount will be processed to your UPI ID within 24 hours.
              </Text>
              <TouchableOpacity
                style={styles.successNewBtn}
                onPress={() => setSuccess(false)}
                activeOpacity={0.75}
              >
                <Text style={styles.successNewBtnText}>New request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            /* Form */
            <View style={styles.withdrawForm}>
              {/* UPI ID */}
              <View>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  UPI ID
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      borderColor: upiId.length > 0 && !upiValid
                        ? "#FF5252"
                        : upiValid
                        ? "#00C853"
                        : colors.border,
                    },
                  ]}
                >
                  <Feather name="at-sign" size={15} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="yourname@upi"
                    placeholderTextColor={colors.mutedForeground}
                    value={upiId}
                    onChangeText={(t) => { setUpiId(t); setErrorMsg(null); setSuccess(false); }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    returnKeyType="next"
                    onSubmitEditing={() => amountRef.current?.focus()}
                  />
                  {upiValid && (
                    <Feather name="check-circle" size={14} color="#00C853" />
                  )}
                </View>
                {upiId.length > 0 && !upiValid && (
                  <Text style={styles.inputError}>
                    Enter a valid UPI ID (e.g. name@paytm)
                  </Text>
                )}
              </View>

              {/* Amount */}
              <View>
                <Text style={[styles.inputLabel, { color: colors.mutedForeground }]}>
                  Amount
                </Text>
                <View
                  style={[
                    styles.inputWrap,
                    {
                      borderColor: amountText.length > 0 && !amountValid
                        ? "#FF5252"
                        : amountValid
                        ? "#00C853"
                        : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.rupeePfx, { color: colors.mutedForeground }]}>₹</Text>
                  <TextInput
                    ref={amountRef}
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder={canWithdraw ? `Max ₹${withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "0"}
                    placeholderTextColor={colors.mutedForeground}
                    value={amountText}
                    onChangeText={(t) => { setAmountText(t.replace(/[^0-9.]/g, "")); setErrorMsg(null); setSuccess(false); }}
                    keyboardType="numeric"
                    returnKeyType="done"
                    onSubmitEditing={handleWithdraw}
                    editable={canWithdraw}
                  />
                  {amountValid && (
                    <Feather name="check-circle" size={14} color="#00C853" />
                  )}
                </View>
                {amountText.length > 0 && parsedAmount > withdrawable && (
                  <Text style={styles.inputError}>
                    Maximum withdrawable is ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </Text>
                )}
                {amountText.length > 0 && parsedAmount <= 0 && (
                  <Text style={styles.inputError}>
                    Amount must be greater than ₹0
                  </Text>
                )}
              </View>

              {/* Server error */}
              {errorMsg && (
                <View style={styles.errorBox}>
                  <Feather name="alert-circle" size={13} color="#FF5252" />
                  <Text style={styles.errorBoxText}>{errorMsg}</Text>
                </View>
              )}

              {/* Locked balance note */}
              <View style={styles.lockNote}>
                <Feather name="lock" size={11} color="#b75d00" />
                <Text style={[styles.lockNoteText, { color: "#b75d00" }]}>
                  ₹{LOCKED_BALANCE} minimum always stays in wallet
                </Text>
              </View>

              {/* Submit button */}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  { backgroundColor: btnEnabled ? "#1976D2" : colors.border },
                ]}
                activeOpacity={0.85}
                onPress={handleWithdraw}
                disabled={!btnEnabled}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="arrow-up-right" size={17} color="#fff" />
                    <Text style={styles.submitBtnText}>Request Withdrawal</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>


        {/* ── PERIOD STATS ──────────────────────────────────────────────────── */}
        <View style={styles.periodRow}>
          {[
            { label: "This Week",  value: "12,480", delta: "+18%", days: "Mon – Sun"  },
            { label: "This Month", value: "48,920", delta: "+24%", days: "Jun 2026"   },
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
                  <Feather name="trending-up" size={9} color="#00C853" />
                  <Text style={[styles.deltaText, { color: "#00C853" }]}>{p.delta}</Text>
                </View>
                <Text style={[styles.periodDays, { color: colors.mutedForeground }]}>
                  {p.days}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── TRANSACTIONS ──────────────────────────────────────────────────── */}
        <View style={styles.transactionsSection}>
          <View style={styles.txnHeaderRow}>
            <Text style={[styles.txnSectionTitle, { color: colors.foreground }]}>
              Transactions
            </Text>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={[styles.txnSeeAll, { color: "#00C853" }]}>Export</Text>
            </TouchableOpacity>
          </View>

          {/* Filter pills */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {[
              { id: "all"     as Filter, label: "All"          },
              { id: "earning" as Filter, label: "Earnings"     },
              { id: "withdraw"as Filter, label: "Withdrawals"  },
              { id: "bonus"   as Filter, label: "Bonuses"      },
            ].map((f) => {
              const active = filter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  activeOpacity={0.7}
                  style={[
                    styles.filterPill,
                    { backgroundColor: active ? "#0a0a0a" : "#fff", borderColor: active ? "#0a0a0a" : colors.border },
                  ]}
                >
                  <Text style={[styles.filterPillText, { color: active ? "#fff" : colors.foreground }]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Grouped transaction rows */}
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
                      <View style={[styles.txnDivider, { backgroundColor: colors.border }]} />
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
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
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
    width: 38, height: 38, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
  },

  // Balance card
  balanceCard: {
    borderRadius: 20,
    padding: 18,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  balanceTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  balanceLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.6)", letterSpacing: 0.6 },
  balanceAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 2, marginTop: 6 },
  balanceCurrency: { fontSize: 22, fontWeight: "700", color: "#fff", marginBottom: 6, marginRight: 2 },
  balanceAmount: { fontSize: 40, fontWeight: "800", color: "#fff", letterSpacing: -1.5, lineHeight: 44 },
  balanceDecimal: { fontSize: 20, fontWeight: "700", color: "rgba(255,255,255,0.55)", marginBottom: 4, marginLeft: 1 },
  balanceIconWrap: {
    width: 44, height: 44, borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  balanceSplitRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  balanceSplitItem: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  balanceSplitDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.35)" },
  balanceSplitDivider: { width: 1, height: 30, backgroundColor: "rgba(255,255,255,0.12)" },
  balanceSplitLabel: { fontSize: 9, fontWeight: "700", color: "rgba(255,255,255,0.5)", letterSpacing: 0.5 },
  balanceSplitValue: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: -0.3, marginTop: 1 },
  todayChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,200,83,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(0,200,83,0.2)",
  },
  todayChipText: { fontSize: 11, fontWeight: "700", color: "#00C853" },

  // Withdrawal card
  withdrawCard: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  withdrawCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  withdrawCardIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  withdrawCardTitle: { fontSize: 14, fontWeight: "800" },
  withdrawCardSub: { fontSize: 11, fontWeight: "500", marginTop: 1 },

  withdrawForm: { padding: 14, gap: 14 },

  inputLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3, marginBottom: 6 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    backgroundColor: "#fafafa",
  },
  input: { flex: 1, fontSize: 15, fontWeight: "600" },
  rupeePfx: { fontSize: 16, fontWeight: "700" },
  inputError: { fontSize: 11, fontWeight: "600", color: "#FF5252", marginTop: 5 },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#fff5f5",
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: "#ffcdd2",
  },
  errorBoxText: { flex: 1, fontSize: 12, fontWeight: "600", color: "#c62828" },

  lockNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff8f0",
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  lockNoteText: { fontSize: 11, fontWeight: "600" },

  submitBtn: {
    height: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  submitBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  // Success
  successBox: { padding: 24, alignItems: "center", gap: 10 },
  successIconWrap: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "#f0fdf4",
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  successSub: { fontSize: 12, fontWeight: "500", textAlign: "center", lineHeight: 18 },
  successNewBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 9,
    backgroundColor: "#f5f5f5",
    borderRadius: 20,
  },
  successNewBtnText: { fontSize: 13, fontWeight: "700", color: "#0a0a0a" },

  // Period stats
  periodRow: { flexDirection: "row", gap: 10 },
  periodCard: {
    flex: 1, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, padding: 12, gap: 6,
  },
  periodTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  periodLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.3 },
  periodAmount: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  periodBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  deltaPill: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },
  deltaText: { fontSize: 10, fontWeight: "800" },
  periodDays: { fontSize: 10, fontWeight: "500" },

  // Transactions
  transactionsSection: { gap: 12 },
  txnHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 2 },
  txnSectionTitle: { fontSize: 16, fontWeight: "800" },
  txnSeeAll: { fontSize: 13, fontWeight: "700" },
  filterRow: { flexDirection: "row", gap: 8, paddingVertical: 2, paddingRight: 8 },
  filterPill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  filterPillText: { fontSize: 12, fontWeight: "700" },
  txnGroup: { gap: 8 },
  txnGroupHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 4,
  },
  txnGroupTitle: { fontSize: 11, fontWeight: "800", letterSpacing: 0.4, textTransform: "uppercase" },
  txnGroupCount: { fontSize: 10, fontWeight: "600" },
  txnList: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  txnRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  txnIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  txnTitle: { fontSize: 13, fontWeight: "700" },
  txnMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  txnSub: { fontSize: 11, fontWeight: "500" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  txnAmount: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  txnDivider: { height: 1, marginLeft: 58 },
  statusPill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  statusPillText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3 },
  emptyState: {
    backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, paddingVertical: 30, alignItems: "center", gap: 8,
  },
  emptyText: { fontSize: 12, fontWeight: "600" },
});
