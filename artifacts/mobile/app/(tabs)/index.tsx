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
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useDriver } from "@/contexts/DriverContext";
import LiveMap, { HotZoneStrip } from "@/components/LiveMap";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG           = "#F4F6FA";
const CARD         = "#FFFFFF";
const SURFACE      = "#F7F8FA";
const PRIMARY      = "#FF6B00";
const PRIMARY_SOFT = "#FFF3EC";
const TEXT         = "#0F172A";
const MUTED        = "#64748B";
const BORDER       = "#ECEFF3";
const SUCCESS      = "#059669";
const SUCCESS_SOFT = "#ECFDF5";
const INFO         = "#2563EB";
const INFO_SOFT    = "#EFF6FF";
const LOCK_BG      = "#F1F5F9";

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

// ─── Helpers (presentation only) ──────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  to_pickup: "To Pickup",
  at_pickup: "At Pickup",
  to_drop:   "To Drop",
  at_drop:   "At Drop",
  delivered: "Delivered",
  accepted:  "Accepted",
};
function statusLabel(st: string | null | undefined): string {
  return (st && STATUS_LABEL[st]) || "In progress";
}
function firstName(n: string | null | undefined): string {
  const t = (n ?? "").trim();
  return t.length ? (t.split(/\s+/)[0] ?? t) : "Customer";
}
function initial(n: string | null | undefined): string {
  const t = (n ?? "").trim();
  return (t.charAt(0) || "C").toUpperCase();
}

// ─── Home Screen ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
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
    activeOrders,
    currentActiveOrderId,
    focusOrder,
    maxActiveOrders,
    hasCapacity,
    isAtCapacity,
    walletBalance,
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

  const earnings = `₹${todayEarnings.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const walletText = `₹${(walletBalance ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

  // Routes (unchanged) ────────────────────────────────────────────────────────
  function openAvailable() {
    if (incomingRide) {
      router.push("/ride-request");
    } else {
      Alert.alert("No orders right now", "You'll be notified as soon as a nearby order arrives.", [{ text: "OK" }]);
    }
  }
  function openHub() {
    router.push("/delivery-command-center");
  }
  function openNotifications() {
    router.push("/notifications");
  }
  function openWallet() {
    router.push("/wallet");
  }

  // Active-ride dock data (read-only, real orders only) ────────────────────────
  const focused =
    activeOrders.find((o) => o.id === currentActiveOrderId) ?? activeOrders[0] ?? null;
  const slots = Array.from({ length: maxActiveOrders }, (_, i) => activeOrders[i] ?? null);

  // Available Deliveries section availability ──────────────────────────────────
  const availLocked = !online || isAtCapacity;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>

      {/* ── PINNED HEADER (greeting + status + bell) ───────────────────────── */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerLeft}>
          <View style={s.logoMark}>
            <Feather name="navigation" size={16} color="#fff" />
          </View>
          <View>
            <Text style={s.brandName}>Bike Courier</Text>
            <View style={s.statusLine}>
              <View style={[s.statusLineDot, { backgroundColor: online ? SUCCESS : MUTED }]} />
              <Text style={s.statusLineTxt}>
                {online
                  ? activeOrderCount > 0
                    ? `Online · ${activeOrderCount} active`
                    : "Online · searching"
                  : "Offline"}
              </Text>
            </View>
          </View>
        </View>
        <View style={s.headerRight}>
          {subscriptionActive && planLabel && (
            <View style={s.planChip}>
              <View style={s.planChipDot} />
              <Text style={s.planChipText}>{planLabel}</Text>
            </View>
          )}
          <TouchableOpacity
            style={s.bellBtn}
            onPress={openNotifications}
            activeOpacity={0.7}
            hitSlop={8}
          >
            <Feather name="bell" size={20} color={TEXT} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── WALLET + HUB STRIP (always visible) ────────────────────────────── */}
      <View style={s.topStrip}>
        <TouchableOpacity style={s.walletPill} activeOpacity={0.85} onPress={openWallet}>
          <View style={s.walletPillIcon}>
            <Feather name="credit-card" size={15} color={SUCCESS} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.walletPillLabel}>Wallet</Text>
            <Text style={s.walletPillValue}>{walletText}</Text>
          </View>
          <Feather name="chevron-right" size={16} color={MUTED} />
        </TouchableOpacity>

        <TouchableOpacity style={s.hubPill} activeOpacity={0.85} onPress={openHub}>
          <Feather name="grid" size={15} color={PRIMARY} />
          <Text style={s.hubPillTxt}>Delivery Hub</Text>
          {online && (
            <View style={[s.slotCounter, isAtCapacity && s.slotCounterFull]}>
              <Text style={[s.slotCounterTxt, isAtCapacity && s.slotCounterTxtFull]}>
                {activeOrderCount}/{maxActiveOrders}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── PINNED ACTIVE RIDE DOCK (impossible to miss, above fold) ────────── */}
      {activeOrderCount > 0 && focused && (
        <View style={s.dock}>
          <View style={s.dockHead}>
            <View style={s.dockHeadLeft}>
              <View style={s.dockRank}><Text style={s.dockRankTxt}>1</Text></View>
              <Text style={s.dockTitle}>{activeOrderCount > 1 ? "ACTIVE RIDES" : "ACTIVE RIDE"}</Text>
            </View>
            <View style={s.dockHeadRight}>
              {isAtCapacity && (
                <View style={s.fullBadge}><Text style={s.fullBadgeTxt}>FULL</Text></View>
              )}
              <Text style={s.dockCount}>{activeOrderCount}/{maxActiveOrders}</Text>
            </View>
          </View>

          <TouchableOpacity style={s.focusCard} activeOpacity={0.9} onPress={openHub}>
            <View style={s.focusTop}>
              <View style={s.focusAvatar}>
                <Text style={s.focusAvatarTxt}>{initial(focused.passengerName)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.focusName} numberOfLines={1}>{focused.passengerName}</Text>
                <Text style={s.focusMeta} numberOfLines={1}>
                  {focused.distanceKm} km · ₹{focused.fareEstimate} · {focused.paymentMode}
                </Text>
              </View>
              <View style={s.focusStatus}>
                <Text style={s.focusStatusTxt}>{statusLabel(focused.orderStatus)}</Text>
              </View>
            </View>

            <View style={s.focusCtaRow}>
              <View style={s.focusCta}>
                <Feather name="navigation" size={15} color="#fff" />
                <Text style={s.focusCtaTxt}>Open Delivery</Text>
              </View>
              <Feather name="chevron-right" size={18} color={PRIMARY} />
            </View>
          </TouchableOpacity>

          {/* 3-slot rail (architecture preserved visually) */}
          <View style={s.slotRail}>
            {slots.map((o, i) =>
              o ? (
                <TouchableOpacity
                  key={o.id}
                  style={[s.slotChip, o.id === currentActiveOrderId && s.slotChipActive]}
                  activeOpacity={0.85}
                  onPress={() => focusOrder(o.id)}
                >
                  <Text style={[s.slotNum, o.id === currentActiveOrderId && s.slotNumActive]}>{i + 1}</Text>
                  <Text
                    style={[s.slotName, o.id === currentActiveOrderId && s.slotNameActive]}
                    numberOfLines={1}
                  >
                    {firstName(o.passengerName)}
                  </Text>
                  {o.id === currentActiveOrderId && <View style={s.slotFocusDot} />}
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  key={`slot-empty-${i}`}
                  style={s.slotEmpty}
                  activeOpacity={0.8}
                  onPress={openAvailable}
                  disabled={!hasCapacity}
                >
                  <Feather name="plus" size={13} color={MUTED} />
                  <Text style={s.slotEmptyTxt}>Slot {i + 1}</Text>
                </TouchableOpacity>
              ),
            )}
          </View>
        </View>
      )}

      {/* ── SCROLLABLE CONTENT ─────────────────────────────────────────────── */}
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 14,
          paddingBottom: insets.bottom + 130,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── STATUS BLOCK (online/offline toggle + earnings) ───────────────── */}
        <View style={s.statusBlock}>
          <View style={s.statusTop}>
            <View style={s.statusInfo}>
              <View style={[s.statusDot, { backgroundColor: online ? SUCCESS : MUTED }]} />
              <View>
                <Text style={s.statusLabel}>{online ? "You're Online" : "You're Offline"}</Text>
                <Text style={s.statusSub}>
                  {online
                    ? activeOrderCount > 0
                      ? `${activeOrderCount} order${activeOrderCount > 1 ? "s" : ""} in progress`
                      : "Receiving orders nearby"
                    : "Not receiving orders"}
                </Text>
              </View>
            </View>
            <Switch
              value={online}
              onValueChange={(v) => void setOnline(v)}
              trackColor={{ false: "#CBD5E1", true: "#FFB37A" }}
              thumbColor={online ? PRIMARY : "#FFFFFF"}
              ios_backgroundColor="#CBD5E1"
            />
          </View>

          <View style={s.statusDivider} />

          <View style={s.earningsRow}>
            <View style={s.earningsMain}>
              <Text style={s.earningsLabel}>Earned today</Text>
              <Text style={s.earningsValue}>{earnings}</Text>
            </View>
            <View style={s.earningsStat}>
              <Text style={s.earningsStatNum}>{tripsToday}</Text>
              <Text style={s.earningsStatLbl}>Trips</Text>
            </View>
            {online && (
              <>
                <View style={s.earningsStatSep} />
                <View style={s.earningsStat}>
                  <Text style={s.earningsStatNum}>{activeOrderCount}</Text>
                  <Text style={s.earningsStatLbl}>Active</Text>
                </View>
              </>
            )}
          </View>

          {!online && (
            <TouchableOpacity style={s.goOnlineBtn} onPress={() => void setOnline(true)} activeOpacity={0.9}>
              <Feather name="power" size={18} color="#fff" />
              <Text style={s.goOnlineTxt}>GO ONLINE</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* ── PLAN BANNERS ──────────────────────────────────────────────────── */}
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

        {/* ── AVAILABLE DELIVERIES (always visible; locked/muted when offline or full) ── */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>Available Deliveries</Text>
            {online && !isAtCapacity && incomingRide && (
              <View style={s.newBadge}><Text style={s.newBadgeTxt}>NEW</Text></View>
            )}
          </View>

          <TouchableOpacity
            style={[s.availRow, availLocked && s.availRowLocked]}
            activeOpacity={availLocked ? 1 : 0.85}
            onPress={openAvailable}
            disabled={availLocked}
          >
            <View style={[s.availIcon, availLocked && s.availIconLocked]}>
              <Feather
                name={availLocked ? "lock" : "inbox"}
                size={18}
                color={availLocked ? MUTED : PRIMARY}
              />
            </View>
            <View style={{ flex: 1 }}>
              {!online ? (
                <>
                  <Text style={s.availTitleLocked}>Go online to see nearby orders</Text>
                  <Text style={s.availSub}>You're offline right now</Text>
                </>
              ) : isAtCapacity ? (
                <>
                  <Text style={s.availTitleLocked}>At capacity ({activeOrderCount}/{maxActiveOrders})</Text>
                  <Text style={s.availSub}>Finish a ride to accept new orders</Text>
                </>
              ) : incomingRide ? (
                <>
                  <Text style={s.availTitle}>New order waiting</Text>
                  <Text style={s.availSub}>Tap to view and accept</Text>
                </>
              ) : (
                <>
                  <Text style={s.availTitle}>No orders right now</Text>
                  <Text style={s.availSub}>You'll be notified when one arrives nearby</Text>
                </>
              )}
            </View>
            {!availLocked && <Feather name="chevron-right" size={18} color={MUTED} />}
          </TouchableOpacity>
        </View>

        {/* ── MY DELIVERIES (always visible) ─────────────────────────────────── */}
        <View style={s.section}>
          <View style={s.sectionHead}>
            <Text style={s.sectionTitle}>My Deliveries</Text>
            {activeOrderCount > 0 && (
              <View style={s.countPill}><Text style={s.countPillTxt}>{activeOrderCount}</Text></View>
            )}
          </View>

          {activeOrderCount === 0 ? (
            <View style={s.emptyRow}>
              <View style={s.availIcon}>
                <Feather name="package" size={18} color={INFO} />
              </View>
              <Text style={s.emptyTxt}>No active deliveries right now</Text>
            </View>
          ) : (
            <View style={s.myList}>
              {activeOrders.map((o) => {
                const isFocus = o.id === currentActiveOrderId;
                return (
                  <TouchableOpacity
                    key={o.id}
                    style={s.myRow}
                    activeOpacity={0.85}
                    onPress={() => { focusOrder(o.id); openHub(); }}
                  >
                    <View style={[s.myDot, { backgroundColor: isFocus ? PRIMARY : INFO }]} />
                    <Text style={s.myName} numberOfLines={1}>{firstName(o.passengerName)}</Text>
                    <Text style={s.myStatus}>{statusLabel(o.orderStatus)}</Text>
                    <Feather name="chevron-right" size={16} color={MUTED} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>

        {/* ── DELIVERY HUB BAR (always visible) ──────────────────────────────── */}
        <TouchableOpacity style={s.hubBar} activeOpacity={0.9} onPress={openHub}>
          <View style={s.hubBarIcon}>
            <Feather name="grid" size={18} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.hubBarTitle}>Delivery Hub</Text>
            <Text style={s.hubBarSub}>
              {activeOrderCount > 0 ? `Manage ${activeOrderCount} active deliver${activeOrderCount > 1 ? "ies" : "y"}` : "Manage all your deliveries"}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={PRIMARY} />
        </TouchableOpacity>

        {/* ── HOT ZONES / LIVE MAP ──────────────────────────────────────────── */}
        <View style={s.mapCard}>
          <View style={s.mapHeader}>
            <View>
              <Text style={s.mapTitle}>Hot Zones</Text>
              <Text style={s.mapSub}>High-demand areas near you</Text>
            </View>
            <View style={[s.mapChip, { backgroundColor: online ? SUCCESS_SOFT : "#F1F5F9" }]}>
              <View style={[s.mapDot, { backgroundColor: online ? SUCCESS : MUTED }]} />
              <Text style={[s.mapChipTxt, { color: online ? SUCCESS : MUTED }]}>
                {online ? "Live" : "Paused"}
              </Text>
            </View>
          </View>
          <LiveMap online={online} />
          <HotZoneStrip online={online} />
        </View>

        {/* ── PERMISSION HEALTH (lowest priority) ───────────────────────────── */}
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
    paddingBottom: 14,
    backgroundColor: CARD,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: { fontSize: 16, fontWeight: "800", color: TEXT, letterSpacing: -0.2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  statusLineDot: { width: 7, height: 7, borderRadius: 4 },
  statusLineTxt: { fontSize: 11, fontWeight: "600", color: MUTED },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  planChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: SUCCESS_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  planChipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SUCCESS },
  planChipText: { fontSize: 12, fontWeight: "700", color: SUCCESS },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },

  // Wallet + Hub top strip
  topStrip: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  walletPill: {
    flex: 1.1,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: CARD,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  walletPillIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: SUCCESS_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  walletPillLabel: { fontSize: 11, fontWeight: "600", color: MUTED },
  walletPillValue: { fontSize: 15, fontWeight: "800", color: TEXT, marginTop: 1 },
  hubPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: PRIMARY_SOFT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FFD9C2",
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  hubPillTxt: { fontSize: 13, fontWeight: "800", color: PRIMARY },
  slotCounter: {
    backgroundColor: "#FFE0CC",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  slotCounterFull: { backgroundColor: "#DC2626" },
  slotCounterTxt: { fontSize: 11, fontWeight: "800", color: PRIMARY },
  slotCounterTxtFull: { color: "#fff" },

  // Active ride dock (pinned)
  dock: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: "#FFF7F1",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "#FFD0B0",
    padding: 14,
    gap: 12,
    shadowColor: PRIMARY,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  dockHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dockHeadLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dockRank: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  dockRankTxt: { fontSize: 12, fontWeight: "900", color: "#fff" },
  dockTitle: { fontSize: 12, fontWeight: "900", color: PRIMARY, letterSpacing: 0.6 },
  dockHeadRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  fullBadge: { backgroundColor: "#DC2626", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  fullBadgeTxt: { fontSize: 10, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
  dockCount: { fontSize: 13, fontWeight: "800", color: TEXT },

  focusCard: {
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 12,
  },
  focusTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  focusAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  focusAvatarTxt: { fontSize: 18, fontWeight: "800", color: PRIMARY },
  focusName: { fontSize: 16, fontWeight: "800", color: TEXT, letterSpacing: -0.2 },
  focusMeta: { fontSize: 12, fontWeight: "500", color: MUTED, marginTop: 2 },
  focusStatus: {
    backgroundColor: INFO_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  focusStatusTxt: { fontSize: 11, fontWeight: "800", color: INFO },
  focusCtaRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  focusCta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 13,
  },
  focusCtaTxt: { fontSize: 15, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },

  // 3-slot rail
  slotRail: { flexDirection: "row", gap: 8 },
  slotChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: CARD,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 9,
    paddingVertical: 9,
  },
  slotChipActive: { borderColor: PRIMARY, backgroundColor: PRIMARY_SOFT },
  slotNum: {
    fontSize: 11,
    fontWeight: "800",
    color: MUTED,
    width: 14,
    textAlign: "center",
  },
  slotNumActive: { color: PRIMARY },
  slotName: { flex: 1, fontSize: 12, fontWeight: "700", color: TEXT },
  slotNameActive: { color: PRIMARY },
  slotFocusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: PRIMARY },
  slotEmpty: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: SURFACE,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#CBD5E1",
    paddingVertical: 9,
  },
  slotEmptyTxt: { fontSize: 12, fontWeight: "600", color: MUTED },

  // Status block
  statusBlock: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    gap: 18,
    shadowColor: "#0F172A",
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  statusTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusInfo: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusDot: { width: 12, height: 12, borderRadius: 6 },
  statusLabel: { fontSize: 18, fontWeight: "800", color: TEXT, letterSpacing: -0.3 },
  statusSub: { fontSize: 13, fontWeight: "500", color: MUTED, marginTop: 2 },
  statusDivider: { height: 1, backgroundColor: BORDER },
  earningsRow: { flexDirection: "row", alignItems: "center" },
  earningsMain: { flex: 1 },
  earningsLabel: { fontSize: 12, fontWeight: "600", color: MUTED, marginBottom: 3 },
  earningsValue: { fontSize: 30, fontWeight: "900", color: TEXT, letterSpacing: -1 },
  earningsStat: { alignItems: "center", minWidth: 56 },
  earningsStatNum: { fontSize: 20, fontWeight: "800", color: TEXT },
  earningsStatLbl: { fontSize: 11, fontWeight: "500", color: MUTED, marginTop: 2 },
  earningsStatSep: { width: 1, height: 34, backgroundColor: BORDER },
  goOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    shadowColor: PRIMARY,
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  goOnlineTxt: { fontSize: 16, fontWeight: "900", color: "#fff", letterSpacing: 0.4 },

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
    backgroundColor: PRIMARY_SOFT,
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

  // Generic section (Available / My deliveries)
  section: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 15, fontWeight: "800", color: TEXT, letterSpacing: -0.2 },
  newBadge: { backgroundColor: PRIMARY, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  newBadgeTxt: { fontSize: 10, fontWeight: "900", color: "#fff", letterSpacing: 0.5 },
  countPill: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: INFO_SOFT,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 7,
  },
  countPillTxt: { fontSize: 12, fontWeight: "800", color: INFO },

  // Available row
  availRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  availRowLocked: { backgroundColor: LOCK_BG },
  availIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: PRIMARY_SOFT,
    alignItems: "center",
    justifyContent: "center",
  },
  availIconLocked: { backgroundColor: "#E2E8F0" },
  availTitle: { fontSize: 14, fontWeight: "700", color: TEXT },
  availTitleLocked: { fontSize: 14, fontWeight: "700", color: MUTED },
  availSub: { fontSize: 12, fontWeight: "500", color: MUTED, marginTop: 2 },

  // My deliveries list
  myList: { gap: 8 },
  myRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: SURFACE,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  myDot: { width: 9, height: 9, borderRadius: 5 },
  myName: { flex: 1, fontSize: 14, fontWeight: "700", color: TEXT },
  myStatus: { fontSize: 12, fontWeight: "700", color: INFO },
  emptyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: SURFACE,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  emptyTxt: { flex: 1, fontSize: 13, fontWeight: "500", color: MUTED },

  // Delivery Hub bar
  hubBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: CARD,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#FFD9C2",
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  hubBarIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  hubBarTitle: { fontSize: 15, fontWeight: "800", color: TEXT, letterSpacing: -0.2 },
  hubBarSub: { fontSize: 12, fontWeight: "500", color: MUTED, marginTop: 1 },

  // Hot zones / map card
  mapCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 16,
    gap: 12,
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  mapHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  mapTitle: { fontSize: 16, fontWeight: "800", color: TEXT, letterSpacing: -0.2 },
  mapSub: { fontSize: 12, fontWeight: "500", color: MUTED, marginTop: 2 },
  mapChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  mapDot: { width: 6, height: 6, borderRadius: 3 },
  mapChipTxt: { fontSize: 11, fontWeight: "700" },
});
