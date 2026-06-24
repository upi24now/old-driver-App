import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
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

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#F8FAFC";
const CARD    = "#FFFFFF";
const PRIMARY = "#FF6B00";
const TEXT    = "#0F172A";
const MUTED   = "#64748B";
const BORDER  = "#E2E8F0";
const SUCCESS = "#059669";
const INFO    = "#2563EB";

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

const TYPE_META: Record<TxnType, { icon: string; color: string; bg: string }> = {
  earning:  { icon: "navigation",     color: SUCCESS,   bg: "#D1FAE5" },
  tip:      { icon: "heart",          color: "#E8336C", bg: "#FFF0F5" },
  bonus:    { icon: "gift",           color: "#7C3AED", bg: "#EDE9FE" },
  withdraw: { icon: "arrow-up-right", color: INFO,      bg: "#DBEAFE" },
};

// ─── TransactionRow ───────────────────────────────────────────────────────────
function TransactionRow({ txn }: { txn: Transaction }) {
  const meta    = TYPE_META[txn.type];
  const isDebit = txn.amount < 0;
  return (
    <View style={w.txnRow}>
      <View style={[w.txnIcon, { backgroundColor: meta.bg }]}>
        <Feather name={meta.icon as any} size={16} color={meta.color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={w.txnTitle} numberOfLines={1}>{txn.title}</Text>
        <View style={w.txnMeta}>
          <Text style={w.txnSub}>{txn.subtitle}</Text>
          <View style={w.metaDot} />
          <Text style={w.txnSub}>{txn.time}</Text>
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 3 }}>
        <Text style={[w.txnAmount, { color: isDebit ? TEXT : SUCCESS }]}>
          {isDebit ? "-" : "+"}₹{Math.abs(txn.amount).toLocaleString("en-IN")}
        </Text>
        {txn.status === "pending" && (
          <View style={w.pendingPill}>
            <Text style={w.pendingText}>Pending</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Withdraw Sheet ───────────────────────────────────────────────────────────
function WithdrawSheet({
  visible,
  onClose,
  withdrawable,
  canWithdraw,
  requestWithdrawal,
}: {
  visible: boolean;
  onClose: () => void;
  withdrawable: number;
  canWithdraw: boolean;
  requestWithdrawal: (amount: number, upiId: string) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const insets     = useSafeAreaInsets();
  const amountRef  = useRef<TextInput>(null);

  const [upiId,      setUpiId]      = useState("");
  const [amountText, setAmountText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success,    setSuccess]    = useState(false);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);

  const parsedAmount = parseFloat(amountText.replace(/,/g, "")) || 0;
  const upiValid     = UPI_REGEX.test(upiId.trim());
  const amountValid  = parsedAmount > 0 && parsedAmount <= withdrawable;
  const btnEnabled   = canWithdraw && upiValid && amountValid && !submitting;

  function resetAndClose() {
    setUpiId(""); setAmountText(""); setSuccess(false); setErrorMsg(null);
    onClose();
  }

  async function handleWithdraw() {
    if (!btnEnabled) return;
    setSubmitting(true); setErrorMsg(null);
    const result = await requestWithdrawal(parsedAmount, upiId.trim());
    setSubmitting(false);
    if (result.ok) {
      setSuccess(true);
      setUpiId(""); setAmountText("");
    } else {
      setErrorMsg(result.reason ?? "Withdrawal failed. Please try again.");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={resetAndClose} statusBarTranslucent>
      <Pressable style={w.sheetBackdrop} onPress={resetAndClose}>
        <Pressable style={[w.sheetCard, { paddingBottom: insets.bottom + 12 }]} onPress={() => {}}>
          {/* Handle */}
          <View style={w.sheetHandle} />
          <View style={w.sheetHeader}>
            <Text style={w.sheetTitle}>Withdraw via UPI</Text>
            <TouchableOpacity style={w.sheetCloseBtn} onPress={resetAndClose} activeOpacity={0.7}>
              <Feather name="x" size={18} color={TEXT} />
            </TouchableOpacity>
          </View>

          {success ? (
            <View style={w.successBox}>
              <View style={w.successIcon}>
                <Feather name="check-circle" size={36} color={SUCCESS} />
              </View>
              <Text style={w.successTitle}>Withdrawal Submitted</Text>
              <Text style={w.successSub}>Amount will be processed to your UPI ID within 24 hours.</Text>
              <TouchableOpacity style={w.successNewBtn} onPress={() => setSuccess(false)} activeOpacity={0.75}>
                <Text style={w.successNewBtnText}>New request</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <View style={{ gap: 14 }}>
                {/* Available */}
                <View style={w.availableRow}>
                  <Text style={w.availableLabel}>Available to withdraw</Text>
                  <Text style={w.availableAmount}>
                    ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                  </Text>
                </View>

                {/* UPI ID */}
                <View>
                  <Text style={w.inputLabel}>UPI ID</Text>
                  <View style={[w.inputWrap, {
                    borderColor: upiId.length > 0 && !upiValid ? "#DC2626" : upiValid ? SUCCESS : BORDER,
                  }]}>
                    <Feather name="at-sign" size={15} color={MUTED} />
                    <TextInput
                      style={w.input}
                      placeholder="yourname@upi"
                      placeholderTextColor={MUTED}
                      value={upiId}
                      onChangeText={(t) => { setUpiId(t); setErrorMsg(null); setSuccess(false); }}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                      returnKeyType="next"
                      onSubmitEditing={() => amountRef.current?.focus()}
                    />
                    {upiValid && <Feather name="check-circle" size={14} color={SUCCESS} />}
                  </View>
                  {upiId.length > 0 && !upiValid && (
                    <Text style={w.inputError}>Enter a valid UPI ID (e.g. name@paytm)</Text>
                  )}
                </View>

                {/* Amount */}
                <View>
                  <Text style={w.inputLabel}>Amount</Text>
                  <View style={[w.inputWrap, {
                    borderColor: amountText.length > 0 && !amountValid ? "#DC2626" : amountValid ? SUCCESS : BORDER,
                  }]}>
                    <Text style={w.rupeePfx}>₹</Text>
                    <TextInput
                      ref={amountRef}
                      style={w.input}
                      placeholder={canWithdraw ? `Max ₹${withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}` : "0"}
                      placeholderTextColor={MUTED}
                      value={amountText}
                      onChangeText={(t) => { setAmountText(t.replace(/[^0-9.]/g, "")); setErrorMsg(null); }}
                      keyboardType="numeric"
                      returnKeyType="done"
                      onSubmitEditing={handleWithdraw}
                      editable={canWithdraw}
                    />
                    {amountValid && <Feather name="check-circle" size={14} color={SUCCESS} />}
                  </View>
                  {amountText.length > 0 && parsedAmount > withdrawable && (
                    <Text style={w.inputError}>Maximum withdrawable is ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</Text>
                  )}
                  {amountText.length > 0 && parsedAmount <= 0 && (
                    <Text style={w.inputError}>Amount must be greater than ₹0</Text>
                  )}
                </View>

                {/* Server error */}
                {errorMsg && (
                  <View style={w.errorBox}>
                    <Feather name="alert-circle" size={13} color="#DC2626" />
                    <Text style={w.errorBoxText}>{errorMsg}</Text>
                  </View>
                )}

                {/* Locked note */}
                <View style={w.lockNote}>
                  <Feather name="lock" size={11} color="#D97706" />
                  <Text style={w.lockNoteText}>₹{LOCKED_BALANCE} minimum always stays in wallet</Text>
                </View>

                {/* Submit */}
                <TouchableOpacity
                  style={[w.submitBtn, { backgroundColor: btnEnabled ? INFO : BORDER }]}
                  activeOpacity={0.85}
                  onPress={handleWithdraw}
                  disabled={!btnEnabled}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Feather name="arrow-up-right" size={17} color="#fff" />
                      <Text style={w.submitBtnText}>Request Withdrawal</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function WalletScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const {
    walletBalance, lifetimeEarnings, totalPaid,
    todayEarnings, tripsToday, totalTrips,
    transactions, requestWithdrawal, refreshWallet, driverUid,
  } = useDriver();

  const [filter,          setFilter]          = useState<Filter>("all");
  const [withdrawVisible, setWithdrawVisible] = useState(false);

  // Computed
  const withdrawable = Math.max(0, walletBalance - LOCKED_BALANCE);
  const canWithdraw  = walletBalance > LOCKED_BALANCE;

  // Transactions
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

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <View style={[w.header, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={w.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Feather name="arrow-left" size={18} color={TEXT} />
        </TouchableOpacity>
        <Text style={w.headerTitle}>Wallet</Text>
        <TouchableOpacity style={w.iconBtn} onPress={callSupport} activeOpacity={0.7}>
          <Feather name="help-circle" size={18} color={TEXT} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── BALANCE HERO ────────────────────────────────────────────────── */}
        <View style={w.balanceCard}>
          {/* Balance amount */}
          <View style={w.balanceTopRow}>
            <View style={{ flex: 1 }}>
              <Text style={w.balanceLabel}>WALLET BALANCE</Text>
              <View style={w.balanceAmountRow}>
                <Text style={w.balanceCurrency}>₹</Text>
                <Text style={w.balanceAmount}>
                  {Math.floor(walletBalance).toLocaleString("en-IN")}
                </Text>
                <Text style={w.balanceDecimal}>.{(walletBalance % 1).toFixed(2).slice(2)}</Text>
              </View>
            </View>
            <View style={w.balanceIconWrap}>
              <Feather name="credit-card" size={22} color={PRIMARY} />
            </View>
          </View>

          {/* Progress bar: locked → withdrawable */}
          <View>
            <View style={w.progressTrack}>
              <View style={[w.progressFill, {
                width: walletBalance > 0 ? `${Math.min(100, (withdrawable / walletBalance) * 100)}%` : "0%",
              }]} />
            </View>
            <View style={w.progressLabels}>
              <View style={w.progressLabelItem}>
                <View style={[w.progressDot, { backgroundColor: BORDER }]} />
                <Text style={w.progressLabelText}>Locked ₹{LOCKED_BALANCE}</Text>
              </View>
              <View style={w.progressLabelItem}>
                <View style={[w.progressDot, { backgroundColor: SUCCESS }]} />
                <Text style={[w.progressLabelText, { color: SUCCESS }]}>
                  Withdrawable ₹{withdrawable.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </Text>
              </View>
            </View>
          </View>

          {/* Today chip */}
          {todayEarnings > 0 && (
            <View style={w.todayChip}>
              <Feather name="trending-up" size={11} color={SUCCESS} />
              <Text style={w.todayChipText}>
                +₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })} earned today
              </Text>
            </View>
          )}

          {/* Quick actions */}
          <View style={w.quickActions}>
            <TouchableOpacity
              style={[w.quickBtn, { backgroundColor: canWithdraw ? PRIMARY : BORDER }]}
              onPress={() => canWithdraw && setWithdrawVisible(true)}
              activeOpacity={canWithdraw ? 0.85 : 1}
            >
              <Feather name="arrow-up-right" size={16} color={canWithdraw ? "#fff" : MUTED} />
              <Text style={[w.quickBtnText, { color: canWithdraw ? "#fff" : MUTED }]}>Withdraw</Text>
            </TouchableOpacity>
            <TouchableOpacity style={w.quickBtnOutline} activeOpacity={0.8}>
              <Feather name="download" size={16} color={TEXT} />
              <Text style={w.quickBtnOutlineText}>Export</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── EARNINGS SNAPSHOT ───────────────────────────────────────────── */}
        <View style={w.snapshotCard}>
          <View style={w.snapshotItem}>
            <View style={[w.snapshotIcon, { backgroundColor: "#D1FAE5" }]}>
              <Feather name="trending-up" size={14} color={SUCCESS} />
            </View>
            <Text style={w.snapshotLabel}>TODAY</Text>
            <Text style={w.snapshotValue}>
              ₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={w.snapshotSep} />
          <View style={w.snapshotItem}>
            <View style={[w.snapshotIcon, { backgroundColor: "#DBEAFE" }]}>
              <Feather name="send" size={14} color={INFO} />
            </View>
            <Text style={w.snapshotLabel}>TOTAL PAID</Text>
            <Text style={w.snapshotValue}>
              ₹{totalPaid.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={w.snapshotSep} />
          <View style={w.snapshotItem}>
            <View style={[w.snapshotIcon, { backgroundColor: "#EDE9FE" }]}>
              <Feather name="award" size={14} color="#7C3AED" />
            </View>
            <Text style={w.snapshotLabel}>LIFETIME</Text>
            <Text style={w.snapshotValue}>
              ₹{lifetimeEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </Text>
          </View>
        </View>

        {/* ── Trip stats ──────────────────────────────────────────────────── */}
        <View style={w.tripStatsRow}>
          <View style={w.tripStatCard}>
            <View style={[w.snapshotIcon, { backgroundColor: "#EDE9FE" }]}>
              <Feather name="map-pin" size={14} color="#7C3AED" />
            </View>
            <Text style={w.snapshotLabel}>TRIPS TODAY</Text>
            <Text style={w.snapshotValue}>{tripsToday}</Text>
          </View>
          <View style={w.tripStatCard}>
            <View style={[w.snapshotIcon, { backgroundColor: "#FFF0F5" }]}>
              <Feather name="flag" size={14} color="#E8336C" />
            </View>
            <Text style={w.snapshotLabel}>TOTAL TRIPS</Text>
            <Text style={w.snapshotValue}>{totalTrips}</Text>
          </View>
        </View>

        {/* ── TRANSACTIONS ────────────────────────────────────────────────── */}
        <View style={w.txnSection}>
          <View style={w.txnHeaderRow}>
            <Text style={w.txnSectionTitle}>Transactions</Text>
          </View>

          {/* Filter pills */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={w.filterRow}>
            {([
              { id: "all"      as Filter, label: "All"         },
              { id: "earning"  as Filter, label: "Earnings"    },
              { id: "withdraw" as Filter, label: "Withdrawals" },
              { id: "bonus"    as Filter, label: "Bonuses"     },
            ] as const).map((f) => {
              const active = filter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  activeOpacity={0.7}
                  style={[w.filterPill, { backgroundColor: active ? TEXT : CARD, borderColor: active ? TEXT : BORDER }]}
                >
                  <Text style={[w.filterPillText, { color: active ? "#fff" : TEXT }]}>{f.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Grouped rows */}
          {Object.entries(grouped).map(([date, items]) => (
            <View key={date} style={w.txnGroup}>
              <View style={w.txnGroupHeader}>
                <Text style={w.txnGroupTitle}>{date}</Text>
                <Text style={w.txnGroupCount}>{items.length} txn{items.length > 1 ? "s" : ""}</Text>
              </View>
              <View style={w.txnGroupCard}>
                {items.map((txn, i) => (
                  <View key={txn.id}>
                    <TransactionRow txn={txn} />
                    {i < items.length - 1 && <View style={w.txnDivider} />}
                  </View>
                ))}
              </View>
            </View>
          ))}

          {filtered.length === 0 && (
            <View style={w.emptyBox}>
              <Feather name="inbox" size={28} color={MUTED} />
              <Text style={w.emptyText}>No transactions yet</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Withdraw bottom sheet */}
      <WithdrawSheet
        visible={withdrawVisible}
        onClose={() => setWithdrawVisible(false)}
        withdrawable={withdrawable}
        canWithdraw={canWithdraw}
        requestWithdrawal={requestWithdrawal}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const w = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: CARD, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 18, fontWeight: "800", color: TEXT },
  iconBtn: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BORDER,
  },

  // Balance card
  balanceCard: {
    backgroundColor: CARD, borderRadius: 20, borderWidth: 1, borderColor: BORDER,
    padding: 20, gap: 14,
    shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  balanceTopRow: { flexDirection: "row", alignItems: "flex-start" },
  balanceLabel: { fontSize: 10, fontWeight: "700", color: MUTED, letterSpacing: 1, marginBottom: 4 },
  balanceAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  balanceCurrency: { fontSize: 22, fontWeight: "800", color: PRIMARY, marginBottom: 4 },
  balanceAmount: { fontSize: 44, fontWeight: "900", color: TEXT, lineHeight: 50 },
  balanceDecimal: { fontSize: 18, fontWeight: "600", color: MUTED, marginBottom: 6 },
  balanceIconWrap: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: "#FFF3EC",
    alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#FFD0B0",
  },

  // Progress bar
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: BORDER, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: SUCCESS },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", marginTop: 6 },
  progressLabelItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  progressDot: { width: 6, height: 6, borderRadius: 3 },
  progressLabelText: { fontSize: 11, fontWeight: "600", color: MUTED },

  // Today chip
  todayChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#ECFDF5", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    alignSelf: "flex-start",
  },
  todayChipText: { fontSize: 12, fontWeight: "700", color: SUCCESS },

  // Quick actions
  quickActions: { flexDirection: "row", gap: 10 },
  quickBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  quickBtnText: { fontSize: 14, fontWeight: "700" },
  quickBtnOutline: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 13, borderRadius: 12,
    borderWidth: 1.5, borderColor: BORDER, backgroundColor: CARD,
  },
  quickBtnOutlineText: { fontSize: 14, fontWeight: "700", color: TEXT },

  // Snapshot (earnings strip)
  snapshotCard: {
    backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER,
    flexDirection: "row", alignItems: "center", paddingVertical: 16,
  },
  snapshotItem: { flex: 1, alignItems: "center", gap: 5 },
  snapshotSep: { width: 1, height: 50, backgroundColor: BORDER },
  snapshotIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  snapshotLabel: { fontSize: 9, fontWeight: "700", color: MUTED, letterSpacing: 0.5 },
  snapshotValue: { fontSize: 15, fontWeight: "800", color: TEXT },

  // Trip stats
  tripStatsRow: { flexDirection: "row", gap: 10 },
  tripStatCard: {
    flex: 1, backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER,
    padding: 14, gap: 5, alignItems: "center",
  },

  // Transactions
  txnSection: { gap: 12 },
  txnHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  txnSectionTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  filterRow: { gap: 8, paddingBottom: 4 },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  filterPillText: { fontSize: 12, fontWeight: "600" },
  txnGroup: { gap: 6 },
  txnGroupHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 },
  txnGroupTitle: { fontSize: 12, fontWeight: "700", color: MUTED },
  txnGroupCount: { fontSize: 11, fontWeight: "500", color: MUTED },
  txnGroupCard: { backgroundColor: CARD, borderRadius: 14, borderWidth: 1, borderColor: BORDER, overflow: "hidden" },
  txnRow: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  txnIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  txnTitle: { fontSize: 14, fontWeight: "600", color: TEXT },
  txnMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  txnSub: { fontSize: 11, color: MUTED },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: BORDER },
  txnAmount: { fontSize: 14, fontWeight: "700" },
  pendingPill: { backgroundColor: "#FEF3C7", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  pendingText: { fontSize: 9, fontWeight: "700", color: "#D97706" },
  txnDivider: { height: StyleSheet.hairlineWidth, backgroundColor: BORDER, marginLeft: 62 },
  emptyBox: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, color: MUTED, fontWeight: "500" },

  // Withdraw sheet
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheetCard: {
    backgroundColor: CARD, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 16, gap: 16,
    shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 20,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: BORDER, alignSelf: "center", marginBottom: 4 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: TEXT },
  sheetCloseBtn: {
    width: 32, height: 32, borderRadius: 10, backgroundColor: "#F1F5F9",
    alignItems: "center", justifyContent: "center",
  },
  availableRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#ECFDF5", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
  },
  availableLabel: { fontSize: 12, fontWeight: "600", color: MUTED },
  availableAmount: { fontSize: 18, fontWeight: "900", color: SUCCESS },
  inputLabel: { fontSize: 11, fontWeight: "700", color: MUTED, marginBottom: 6, letterSpacing: 0.3 },
  inputWrap: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: "#F8FAFC",
  },
  input: { flex: 1, fontSize: 15, color: TEXT, fontWeight: "600" },
  rupeePfx: { fontSize: 16, fontWeight: "700", color: MUTED },
  inputError: { fontSize: 11, color: "#DC2626", marginTop: 4, fontWeight: "500" },
  errorBox: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#FEE2E2", borderRadius: 10, borderWidth: 1, borderColor: "#DC2626",
    paddingHorizontal: 12, paddingVertical: 8,
  },
  errorBoxText: { fontSize: 12, color: "#DC2626", fontWeight: "500", flex: 1 },
  lockNote: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FEF3C7", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
  },
  lockNoteText: { fontSize: 12, color: "#D97706", fontWeight: "600" },
  submitBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    height: 52, borderRadius: 14,
  },
  submitBtnText: { fontSize: 15, fontWeight: "800", color: "#fff" },
  successBox: { alignItems: "center", paddingVertical: 20, gap: 12 },
  successIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: "#ECFDF5", alignItems: "center", justifyContent: "center" },
  successTitle: { fontSize: 18, fontWeight: "800", color: TEXT, textAlign: "center" },
  successSub: { fontSize: 13, color: MUTED, textAlign: "center", lineHeight: 20 },
  successNewBtn: { backgroundColor: "#F1F5F9", paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, marginTop: 4 },
  successNewBtnText: { fontSize: 14, fontWeight: "700", color: TEXT },
});
