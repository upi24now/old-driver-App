import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { checkNotificationPermissions } from "@/utils/notifications";
import {
  type AllPermissionsStatus,
  checkAllPermissions,
  openBatterySettings,
  openNotificationSettings,
  openPermissionSettings,
} from "@/utils/permissions";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import LiveMap, { HotZoneStrip } from "@/components/LiveMap";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG      = "#F8FAFC";
const CARD    = "#FFFFFF";
const PRIMARY = "#FF6B00";
const TEXT    = "#0F172A";
const MUTED   = "#64748B";
const BORDER  = "#E2E8F0";
const SUCCESS = "#059669";

// ─── Permission Health Card ───────────────────────────────────────────────────
// Only renders when at least one permission is missing.

const DEFAULT_PERMS: AllPermissionsStatus = {
  notifications:      { granted: false, canAskAgain: false },
  location:           { granted: false, canAskAgain: false },
  backgroundLocation: { granted: false, canAskAgain: false },
};

function PermissionHealthCard() {
  const [perms, setPerms]                       = useState<AllPermissionsStatus | null>(null);
  const [showBatteryModal, setShowBatteryModal] = useState(false);

  async function refresh() {
    if (Platform.OS !== "android") return;
    const s = await checkAllPermissions().catch(() => DEFAULT_PERMS);
    setPerms(s);
  }

  useEffect(() => {
    void refresh();
    const sub = AppState.addEventListener("change", (s: AppStateStatus) => {
      if (s === "active") void refresh();
    });
    return () => sub.remove();
  }, []);

  if (Platform.OS !== "android" || !perms) return null;

  type Row = {
    key: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    granted: boolean;
    onFix: () => Promise<void>;
  };

  const rows: Row[] = [
    { key: "notif", icon: "bell",       label: "Notifications",       granted: perms.notifications.granted,      onFix: openNotificationSettings },
    { key: "loc",   icon: "map-pin",    label: "Location",            granted: perms.location.granted,           onFix: openPermissionSettings },
    { key: "bgloc", icon: "navigation", label: "Background Location", granted: perms.backgroundLocation.granted, onFix: openPermissionSettings },
  ];

  const issueRows = rows.filter((r) => !r.granted);
  if (issueRows.length === 0) return null;

  return (
    <View style={ph.card}>
      <View style={ph.header}>
        <Feather name="alert-triangle" size={15} color="#DC2626" />
        <Text style={ph.headerText}>Permission Issues</Text>
        <View style={ph.issueBadge}>
          <Text style={ph.issueBadgeText}>{issueRows.length + 1} issues</Text>
        </View>
      </View>

      {issueRows.map((row) => (
        <View key={row.key} style={ph.row}>
          <Feather name={row.icon} size={14} color={MUTED} />
          <Text style={ph.rowLabel}>{row.label}</Text>
          <TouchableOpacity style={ph.fixBtn} onPress={() => void row.onFix()} activeOpacity={0.75}>
            <Text style={ph.fixText}>Fix</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={ph.row}>
        <Feather name="battery-charging" size={14} color="#D97706" />
        <Text style={ph.rowLabel}>Battery Optimization</Text>
        <TouchableOpacity style={ph.fixBtn} onPress={() => setShowBatteryModal(true)} activeOpacity={0.75}>
          <Text style={ph.fixText}>Fix</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={showBatteryModal} transparent animationType="fade" onRequestClose={() => setShowBatteryModal(false)}>
        <View style={ph.modalOverlay}>
          <View style={ph.modalCard}>
            <Text style={ph.modalTitle}>Battery Optimization बंद करें</Text>
            <View style={{ gap: 10 }}>
              <Text style={ph.modalStep}>1. Battery या App battery usage खोलें</Text>
              <Text style={ph.modalStep}>2. Unrestricted / Don't optimize select करें</Text>
              <Text style={ph.modalStep}>3. Back दबाकर app में वापस आएं</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <TouchableOpacity style={ph.modalCancel} onPress={() => setShowBatteryModal(false)} activeOpacity={0.75}>
                <Text style={ph.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={ph.modalConfirm}
                onPress={async () => { setShowBatteryModal(false); await openBatterySettings(); }}
                activeOpacity={0.75}
              >
                <Text style={ph.modalConfirmText}>Continue →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const ph = StyleSheet.create({
  card: { backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: "#FEE2E2", overflow: "hidden" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  headerText: { flex: 1, fontSize: 14, fontWeight: "700", color: TEXT },
  issueBadge: { backgroundColor: "#FEE2E2", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  issueBadgeText: { fontSize: 11, fontWeight: "700", color: "#DC2626" },
  row: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: BORDER, gap: 10,
  },
  rowLabel: { flex: 1, fontSize: 13, color: TEXT },
  fixBtn: { backgroundColor: "#FFF3EC", paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8 },
  fixText: { fontSize: 12, fontWeight: "700", color: PRIMARY },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", paddingHorizontal: 28 },
  modalCard: { width: "100%", backgroundColor: CARD, borderRadius: 16, borderWidth: 1, borderColor: BORDER, padding: 20, gap: 14 },
  modalTitle: { fontSize: 16, fontWeight: "700", color: TEXT },
  modalStep: { fontSize: 14, lineHeight: 22, color: MUTED },
  modalCancel: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: "#F1F5F9" },
  modalCancelText: { fontSize: 14, fontWeight: "700", color: MUTED },
  modalConfirm: { flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: "center", backgroundColor: PRIMARY },
  modalConfirmText: { fontSize: 14, fontWeight: "700", color: "#fff" },
});

// ─── Home Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    authLoading,
    driverUid,
    isOnline: online,
    setOnline: setDriverOnline,
    subscriptionActive,
    subscriptionPlan,
    planExpiredNoOrders,
    planExpiredWithOrders,
    todayEarnings,
    tripsToday,
    activeOrderCount,
    incomingRide,
  } = useDriver();

  if (authLoading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: BG }}>
        <ActivityIndicator size="large" color={PRIMARY} />
      </View>
    );
  }

  if (!driverUid) return <Redirect href="/login" />;

  async function setOnline(v: boolean) {
    if (v && Platform.OS !== "web") {
      const [notifOk, locStatus] = await Promise.all([
        checkNotificationPermissions().catch(() => false),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      ]);
      const locOk = locStatus.granted;
      if (!notifOk || !locOk) {
        const missing = [!notifOk ? "Notifications" : null, !locOk ? "GPS Location" : null].filter(Boolean).join(" & ");
        Alert.alert(
          "Permissions Required",
          `${missing} ${missing.includes("&") ? "permissions are" : "permission is"} required to go online and receive delivery requests. Please enable them in setup.`,
          [{ text: "Fix Setup", onPress: () => router.push("/background-setup?back=1") }],
          { cancelable: false },
        );
        return;
      }
    }
    const r = setDriverOnline(v);
    if (!r.ok && r.reason) {
      Alert.alert("Can't go online", r.reason, [
        { text: "Not now", style: "cancel" },
        { text: "View plans", onPress: () => router.push("/subscription") },
      ]);
    }
  }

  const PLAN_LABEL: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
  const planLabel = subscriptionPlan ? (PLAN_LABEL[subscriptionPlan] ?? subscriptionPlan) : null;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── FIXED HEADER ───────────────────────────────────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerLeft}>
          <View style={s.brandIconWrap}>
            <Feather name="navigation" size={15} color={PRIMARY} />
          </View>
          <View>
            <Text style={s.brandName}>BIKE COURIER</Text>
            <Text style={s.brandSub}>Driver Partner</Text>
          </View>
        </View>
        <View style={s.headerRight}>
          {subscriptionActive && planLabel && (
            <View style={s.planChip}>
              <View style={s.planChipDot} />
              <Text style={s.planChipText}>{planLabel} Plan</Text>
            </View>
          )}
          <TouchableOpacity
            style={s.bellBtn}
            onPress={() => router.push("/notifications")}
            activeOpacity={0.7}
          >
            <Feather name="bell" size={18} color={TEXT} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── ONLINE / OFFLINE HERO ───────────────────────────────────────────── */}
      <View style={[s.heroWrap, { marginHorizontal: 16, marginTop: 14 }]}>
        {online ? (
          /* ONLINE STATE */
          <View style={[s.heroCard, { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" }]}>
            <View style={s.heroTopRow}>
              <View style={s.onlineStatusRow}>
                <View style={s.onlineDot} />
                <Text style={s.onlineLabel}>ONLINE</Text>
              </View>
              <View style={s.heroEarningBadge}>
                <Feather name="trending-up" size={12} color={SUCCESS} />
                <Text style={s.heroEarningText}>
                  ₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })} today
                </Text>
              </View>
            </View>

            <Text style={s.heroSubtext}>
              {activeOrderCount > 0
                ? `${activeOrderCount} active order${activeOrderCount > 1 ? "s" : ""} in progress`
                : "Waiting for orders nearby..."}
            </Text>

            <View style={s.heroStatsRow}>
              <View style={s.heroStat}>
                <Text style={s.heroStatNum}>{tripsToday}</Text>
                <Text style={s.heroStatLbl}>Trips Today</Text>
              </View>
              <View style={s.heroStatSep} />
              <View style={s.heroStat}>
                <Text style={s.heroStatNum}>
                  ₹{todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                </Text>
                <Text style={s.heroStatLbl}>Earned Today</Text>
              </View>
              <View style={s.heroStatSep} />
              <View style={s.heroStat}>
                <Text style={s.heroStatNum}>{activeOrderCount}</Text>
                <Text style={s.heroStatLbl}>Active Orders</Text>
              </View>
            </View>

            <TouchableOpacity style={s.goOfflineBtn} onPress={() => setOnline(false)} activeOpacity={0.85}>
              <Feather name="wifi-off" size={15} color={TEXT} />
              <Text style={s.goOfflineTxt}>Go Offline</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* OFFLINE STATE */
          <View style={[s.heroCard, { backgroundColor: CARD, borderColor: BORDER }]}>
            <View style={s.offlineStatusRow}>
              <View style={s.offlineDot} />
              <Text style={s.offlineLabel}>OFFLINE</Text>
            </View>
            <Text style={s.offlineTitle}>Start earning now</Text>
            <Text style={s.offlineSubtext}>
              Go online to receive delivery orders from customers nearby
            </Text>
            <TouchableOpacity
              style={s.goOnlineBtn}
              onPress={() => setOnline(true)}
              activeOpacity={0.88}
            >
              <Feather name="wifi" size={18} color="#fff" />
              <Text style={s.goOnlineTxt}>GO ONLINE</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* ── SCROLLABLE CONTENT ─────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: insets.bottom + 130,
          gap: 12,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Plan expiry / no-plan banners */}
        {planExpiredWithOrders && (
          <TouchableOpacity style={s.bannerAmber} activeOpacity={0.88} onPress={() => router.push("/subscription")}>
            <Feather name="clock" size={15} color="#fff" style={{ flexShrink: 0 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>Plan Expired</Text>
              <Text style={s.bannerSub}>Finish current deliveries. Renew to get new orders.</Text>
            </View>
            <View style={s.bannerCta}><Text style={s.bannerCtaText}>Renew</Text></View>
          </TouchableOpacity>
        )}
        {!planExpiredWithOrders && planExpiredNoOrders && (
          <TouchableOpacity style={s.bannerRed} activeOpacity={0.88} onPress={() => router.push("/subscription")}>
            <Feather name="alert-circle" size={15} color="#fff" style={{ flexShrink: 0 }} />
            <View style={{ flex: 1 }}>
              <Text style={s.bannerTitle}>Plan Expired</Text>
              <Text style={s.bannerSub}>Renew to continue receiving orders</Text>
            </View>
            <View style={s.bannerCta}><Text style={s.bannerCtaText}>Renew</Text></View>
          </TouchableOpacity>
        )}
        {!subscriptionActive && !planExpiredNoOrders && !planExpiredWithOrders && (
          <TouchableOpacity style={s.bannerSoft} activeOpacity={0.88} onPress={() => router.push("/subscription")}>
            <View style={s.bannerSoftIcon}>
              <Feather name="zap" size={14} color={PRIMARY} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.bannerSoftTitle}>No active plan</Text>
              <Text style={s.bannerSoftSub}>Activate a plan to receive orders & keep 100% earnings</Text>
            </View>
            <Feather name="chevron-right" size={16} color={PRIMARY} />
          </TouchableOpacity>
        )}

        {/* Quick action cards */}
        <View style={s.actionRow}>
          <TouchableOpacity
            style={s.actionCard}
            activeOpacity={0.82}
            onPress={() => {
              if (incomingRide) {
                router.push("/ride-request");
              } else {
                Alert.alert("No orders right now", "You'll be notified as soon as a nearby order arrives.", [{ text: "OK" }]);
              }
            }}
          >
            <View style={[s.actionIconWrap, { backgroundColor: "#FFF3EC" }]}>
              <Feather name="bell" size={20} color={PRIMARY} />
            </View>
            <Text style={s.actionCardTitle}>Available</Text>
            <Text style={s.actionCardSub}>New orders</Text>
            {incomingRide && <View style={[s.actionBadgeDot, { backgroundColor: PRIMARY }]} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.actionCard}
            activeOpacity={0.82}
            onPress={() => router.push("/delivery-command-center")}
          >
            <View style={[s.actionIconWrap, { backgroundColor: "#EFF6FF" }]}>
              <Feather name="layers" size={20} color="#2563EB" />
            </View>
            <Text style={s.actionCardTitle}>My Orders</Text>
            <Text style={s.actionCardSub}>Active deliveries</Text>
            {activeOrderCount > 0 && (
              <View style={s.actionBadgeCount}>
                <Text style={s.actionBadgeNum}>{activeOrderCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={s.actionCard}
            activeOpacity={0.82}
            onPress={() => router.push("/wallet")}
          >
            <View style={[s.actionIconWrap, { backgroundColor: "#ECFDF5" }]}>
              <Feather name="credit-card" size={20} color={SUCCESS} />
            </View>
            <Text style={s.actionCardTitle}>Wallet</Text>
            <Text style={s.actionCardSub}>Balance & pay</Text>
          </TouchableOpacity>
        </View>

        {/* Live Map card */}
        <View style={s.mapCard}>
          <View style={s.mapCardHeader}>
            <Text style={s.mapCardTitle}>Live Map</Text>
            <View style={[s.mapStatusChip, { backgroundColor: online ? "#ECFDF5" : "#F1F5F9" }]}>
              <View style={[s.mapStatusDot, { backgroundColor: online ? SUCCESS : MUTED }]} />
              <Text style={[s.mapStatusText, { color: online ? SUCCESS : MUTED }]}>
                {online ? "Live" : "Paused"}
              </Text>
            </View>
          </View>
          <LiveMap online={online} />
          <HotZoneStrip online={online} />
        </View>

        {/* Permission health — only when issues exist */}
        <PermissionHealthCard />

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  brandIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "#FFF3EC",
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontSize: 13, fontWeight: "800", color: TEXT, letterSpacing: 1 },
  brandSub: { fontSize: 10, fontWeight: "500", color: MUTED, marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  planChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  planChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SUCCESS },
  planChipText: { fontSize: 11, fontWeight: "700", color: SUCCESS },
  bellBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  // Hero wrapper
  heroWrap: { marginBottom: 2 },
  heroCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 14,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  // Online state
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  onlineStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  onlineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: SUCCESS },
  onlineLabel: { fontSize: 13, fontWeight: "800", color: SUCCESS, letterSpacing: 0.5 },
  heroEarningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  heroEarningText: { fontSize: 12, fontWeight: "700", color: SUCCESS },
  heroSubtext: { fontSize: 14, fontWeight: "500", color: "#374151" },
  heroStatsRow: {
    flexDirection: "row",
    backgroundColor: CARD,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderWidth: 1,
    borderColor: "#D1FAE5",
  },
  heroStat: { flex: 1, alignItems: "center", gap: 3 },
  heroStatNum: { fontSize: 16, fontWeight: "800", color: TEXT },
  heroStatLbl: { fontSize: 10, fontWeight: "500", color: MUTED },
  heroStatSep: { width: 1, height: 32, backgroundColor: BORDER },
  goOfflineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: CARD,
    borderWidth: 1.5,
    borderColor: BORDER,
  },
  goOfflineTxt: { fontSize: 14, fontWeight: "700", color: TEXT },

  // Offline state
  offlineStatusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  offlineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: MUTED },
  offlineLabel: { fontSize: 12, fontWeight: "800", color: MUTED, letterSpacing: 0.8 },
  offlineTitle: { fontSize: 22, fontWeight: "800", color: TEXT },
  offlineSubtext: { fontSize: 14, color: MUTED, lineHeight: 21 },
  goOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 4,
    shadowColor: PRIMARY,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  goOnlineTxt: { fontSize: 16, fontWeight: "900", color: "#fff", letterSpacing: 0.3 },

  // Banners
  bannerAmber: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#D97706",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerRed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#DC2626",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerSoft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#FFF3EC",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "#FFD0B0",
  },
  bannerSoftIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "#FFE8D9",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerTitle: { fontSize: 13, fontWeight: "700", color: "#fff", marginBottom: 1 },
  bannerSub: { fontSize: 11, fontWeight: "500", color: "rgba(255,255,255,0.85)" },
  bannerCta: { backgroundColor: "rgba(255,255,255,0.22)", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  bannerCtaText: { fontSize: 11, fontWeight: "700", color: "#fff" },
  bannerSoftTitle: { fontSize: 13, fontWeight: "700", color: TEXT, marginBottom: 1 },
  bannerSoftSub: { fontSize: 11, fontWeight: "500", color: MUTED },

  // Action cards (3-up)
  actionRow: { flexDirection: "row", gap: 10 },
  actionCard: {
    flex: 1,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 4,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  actionIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  actionCardTitle: { fontSize: 13, fontWeight: "700", color: TEXT },
  actionCardSub: { fontSize: 10, fontWeight: "500", color: MUTED },
  actionBadgeDot: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: CARD,
  },
  actionBadgeCount: {
    position: "absolute",
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: CARD,
  },
  actionBadgeNum: { fontSize: 10, fontWeight: "800", color: "#fff" },

  // Map card
  mapCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  mapCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mapCardTitle: { fontSize: 15, fontWeight: "700", color: TEXT },
  mapStatusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  mapStatusDot: { width: 6, height: 6, borderRadius: 3 },
  mapStatusText: { fontSize: 11, fontWeight: "700" },
});
