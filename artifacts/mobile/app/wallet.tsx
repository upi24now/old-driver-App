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
import { callSupport } from "@/utils/support";

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

// Semantic-token hex used at module level (no hook access here)
const TYPE_META: Record<TxnType, { icon: string; color: string; bg: string }> = {
  earning:  { icon: "navigation",     color: "#059669", bg: "#D1FAE5" },  // money / successSoft
  tip:      { icon: "heart",          color: "#E8336C", bg: "#FFF0F5" },  // primary / primarySoft
  bonus:    { icon: "gift",           color: "#7C3AED", bg: "#EDE9FE" },  // pending / pendingSoft
  withdraw: { icon: "arrow-up-right", color: "#2563EB", bg: "#DBEAFE" },  // info / infoSoft
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
        <Text style={[styles.txnAmount, { color: isDebit ? colors.foreground : colors.money }]}>
          {isDebit ? "-" : "+"}₹{Math.abs(txn.amount).toLocaleString("en-IN")}
        </Text>
        {txn.status === "pending" && (
          <View style={[styles.statusPill, { backgroundColor: colors.warningSoft }]}>
            <Text style={[styles.statusPillText, { color: colors.warningText }]}>Pending</Text>
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
  const { walletBalance, lifetimeEarnings, todayEarnings, tripsToday, totalTrips, transactions, requestWithdrawal, refreshWallet, driverUid } = useDriver();

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
  const totalPaidOut   = transactions
    .filter((t) => t.type === "withdraw")
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
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
  const allTxns: Transaction[] = transactions as Transaction[];
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
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 12,
            backgroundColor:   colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Wallet</Text>
        <TouchableOpacity
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <Feather name="help-circle" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── BALANCE HERO ──────────────────────────────────────────────────── */}
        <LinearGradient
          colors={["#065F46", "#0F172A"]}
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
              <View style={[styles.balanceSplitDot, { backgroundColor: colors.money }]} />
              <View>
                <Text style={styles.balanceSplitLabel}>WITHDRAWABLE</Text>
                <Text style={[styles.balanceSplitValue, { color: colors.money }]}>
                  ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </Text>
              </View>
            </View>
          </View>

          {/* Today's earnings chip */}
          {todayEarnings > 0 && (
            <View style={styles.todayChip}>
              <Feather name="trending-up" size={11} color={colors.money} />
              <Text style={[styles.todayChipText, { color: colors.money }]}>
                +₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })} earned today
              </Text>
            </View>
          )}
        </LinearGradient>

        {/* ── UPI WITHDRAWAL CARD ───────────────────────────────────────────── */}
        <View
          style={[
            styles.withdrawCard,
            { borderColor: colors.border, backgroundColor: colors.surface },
          ]}
        >
          <View
            style={[
              styles.withdrawCardHeader,
              { borderBottomColor: colors.border },
            ]}
          >
            <View style={[styles.withdrawCardIcon, { backgroundColor: colors.infoSoft }]}>
              <Feather name="smartphone" size={16} color={colors.info} />
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
              <View style={[styles.successIconWrap, { backgroundColor: colors.moneySoft }]}>
                <Feather name="check-circle" size={28} color={colors.money} />
              </View>
              <Text style={[styles.successTitle, { color: colors.foreground }]}>
                Withdrawal request submitted
              </Text>
              <Text style={[styles.successSub, { color: colors.mutedForeground }]}>
                Amount will be processed to your UPI ID within 24 hours.
              </Text>
              <TouchableOpacity
                style={[styles.successNewBtn, { backgroundColor: colors.muted }]}
                onPress={() => setSuccess(false)}
                activeOpacity={0.75}
              >
                <Text style={[styles.successNewBtnText, { color: colors.foreground }]}>New request</Text>
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
                    { backgroundColor: colors.surfaceElevated },
                    {
                      borderColor: upiId.length > 0 && !upiValid
                        ? colors.error
                        : upiValid
                        ? colors.money
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
                    <Feather name="check-circle" size={14} color={colors.money} />
                  )}
                </View>
                {upiId.length > 0 && !upiValid && (
                  <Text style={[styles.inputError, { color: colors.error }]}>
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
                    { backgroundColor: colors.surfaceElevated },
                    {
                      borderColor: amountText.length > 0 && !amountValid
                        ? colors.error
                        : amountValid
                        ? colors.money
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
                    <Feather name="check-circle" size={14} color={colors.money} />
                  )}
                </View>
                {amountText.length > 0 && parsedAmount > withdrawable && (
                  <Text style={[styles.inputError, { color: colors.error }]}>
                    Maximum withdrawable is ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </Text>
                )}
                {amountText.length > 0 && parsedAmount <= 0 && (
                  <Text style={[styles.inputError, { color: colors.error }]}>
                    Amount must be greater than ₹0
                  </Text>
                )}
              </View>

              {/* Server error */}
              {errorMsg && (
                <View
                  style={[
                    styles.errorBox,
                    { backgroundColor: colors.errorSoft, borderColor: colors.error },
                  ]}
                >
                  <Feather name="alert-circle" size={13} color={colors.error} />
                  <Text style={[styles.errorBoxText, { color: colors.errorText }]}>{errorMsg}</Text>
                </View>
              )}

              {/* Locked balance note */}
              <View style={[styles.lockNote, { backgroundColor: colors.warningSoft }]}>
                <Feather name="lock" size={11} color={colors.warning} />
                <Text style={[styles.lockNoteText, { color: colors.warning }]}>
                  ₹{LOCKED_BALANCE} minimum always stays in wallet
                </Text>
              </View>

              {/* Submit button */}
              <TouchableOpacity
                style={[
                  styles.submitBtn,
                  { backgroundColor: btnEnabled ? colors.info : colors.border },
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


        {/* ── STATS GRID ────────────────────────────────────────────────────── */}
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.statIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="trending-up" size={14} color="#059669" />
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>TOTAL EARNED</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              ₹{lifetimeEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.statIcon, { backgroundColor: "#DBEAFE" }]}>
              <Feather name="send" size={14} color="#2563EB" />
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>TOTAL PAID OUT</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>
              ₹{totalPaidOut.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </Text>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.statIcon, { backgroundColor: "#EDE9FE" }]}>
              <Feather name="map-pin" size={14} color="#7C3AED" />
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>TRIPS TODAY</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{tripsToday}</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={[styles.statIcon, { backgroundColor: "#FFF0F5" }]}>
              <Feather name="award" size={14} color="#E8336C" />
            </View>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>TOTAL TRIPS</Text>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{totalTrips}</Text>
          </View>
        </View>

        {/* ── TRANSACTIONS ──────────────────────────────────────────────────── */}
        <View style={styles.transactionsSection}>
          <View style={styles.txnHeaderRow}>
            <Text style={[styles.txnSectionTitle, { color: colors.foreground }]}>
              Transactions
            </Text>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={[styles.txnSeeAll, { color: colors.money }]}>Export</Text>
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
                    {
                      backgroundColor: active ? colors.foreground : colors.surface,
                      borderColor:     active ? colors.foreground : colors.border,
                    },
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
              <View
                style={[
                  styles.txnList,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
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
            <View
              style={[
                styles.emptyState,
                { borderColor: colors.border, backgroundColor: colors.surface },
              ]}
            >
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
  },
  headerTitle: { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
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
    backgroundColor: "rgba(5,150,105,0.14)",   // money token at 14% opacity
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(5,150,105,0.22)",
  },
  todayChipText: { fontSize: 11, fontWeight: "700" },

  // Withdrawal card
  withdrawCard: {
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
  },
  input: { flex: 1, fontSize: 15, fontWeight: "600" },
  rupeePfx: { fontSize: 16, fontWeight: "700" },
  inputError: { fontSize: 11, fontWeight: "600", marginTop: 5 },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
  },
  errorBoxText: { flex: 1, fontSize: 12, fontWeight: "600" },

  lockNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
    alignItems: "center", justifyContent: "center",
    marginBottom: 4,
  },
  successTitle: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  successSub: { fontSize: 12, fontWeight: "500", textAlign: "center", lineHeight: 18 },
  successNewBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 9,
    borderRadius: 20,
  },
  successNewBtnText: { fontSize: 13, fontWeight: "700" },

  // Stats grid
  statsRow:  { flexDirection: "row", gap: 10 },
  statCard:  { flex: 1, borderRadius: 14, borderWidth: 1, padding: 14, gap: 6 },
  statIcon:  { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 9,  fontWeight: "800", letterSpacing: 0.5 },
  statValue: { fontSize: 20, fontWeight: "800", letterSpacing: -0.5 },

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
  txnList: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
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
    borderRadius: 14, borderWidth: 1, paddingVertical: 30, alignItems: "center", gap: 8,
  },
  emptyText: { fontSize: 12, fontWeight: "600" },
});
