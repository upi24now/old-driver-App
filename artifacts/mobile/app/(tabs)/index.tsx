import { Feather } from "@expo/vector-icons";
import * as Location from "expo-location";
import { Redirect, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { checkNotificationPermissions } from "@/utils/notifications";
import {
  type AllPermissionsStatus,
  checkAllPermissions,
  openNotificationSettings,
  openPermissionSettings,
} from "@/utils/permissions";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
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
// Soft action-card palette
const MINT          = "#0EA372";
const MINT_SOFT     = "#DCFCE7";
const MINT_BORDER   = "#86EFAC";
// Home dashboard "My Deliveries" / "Delivery Hub" premium lemon theme
const LEMON_SOFT    = "#FEF9C3";
const LEMON_BORDER  = "#FDE68A";
const LEMON_ACCENT  = "#78350F";
// Duty-toggle bridge constants (ON = green, OFF = red)
const SUCCESS_TRACK = "#86EFAC";
const DANGER        = "#DC2626";
const DANGER_TRACK  = "#FCA5A5";

// ─── Permission Health Card ───────────────────────────────────────────────────
// Only renders when at least one permission is missing.

const DEFAULT_PERMS: AllPermissionsStatus = {
  notifications:      { granted: false, canAskAgain: false },
  location:           { granted: false, canAskAgain: false },
  backgroundLocation: { granted: false, canAskAgain: false },
};

function PermissionHealthCard() {
  const [perms, setPerms] = useState<AllPermissionsStatus | null>(null);

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

  // Foreground location is the ONLY permission that actually blocks GPS/online/
  // offers — see the retain-online fix in DriverContext. Background Location and
  // Battery Optimization cannot be read reliably from JS (no native module) and
  // going online never depends on them, so they must never be presented as
  // blocking "issues" once foreground location works. Both are opt-in advisory
  // setup steps handled entirely by Profile › background-setup instead of
  // nagging on the dashboard.
  const rows: Row[] = [
    { key: "notif", icon: "bell",    label: "Notifications", granted: perms.notifications.granted, onFix: openNotificationSettings },
    { key: "loc",   icon: "map-pin", label: "Location",      granted: perms.location.granted,      onFix: openPermissionSettings },
  ];

  const issueRows = rows.filter((r) => !r.granted);
  if (issueRows.length === 0) return null;

  return (
    <View style={ph.card}>
      <View style={ph.header}>
        <Feather name="alert-triangle" size={15} color="#DC2626" />
        <Text style={ph.headerText}>Permission Issues</Text>
        <View style={ph.issueBadge}>
          <Text style={ph.issueBadgeText}>{issueRows.length} issue{issueRows.length === 1 ? "" : "s"}</Text>
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
    lastLocationSyncAt,
    setOnline: setDriverOnline,
    subscriptionActive,
    subscriptionPlan,
    planExpiredNoOrders,
    planExpiredWithOrders,
    todayEarnings,
    activeOrderCount,
    activeOrders,
    currentActiveOrderId,
    focusOrder,
    maxActiveOrders,
    hasCapacity,
    isAtCapacity,
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
    console.log("[ONLINE_ROUTE] button pressed:", v);
    console.log("[ONLINE_ROUTE] driver uid:", driverUid);
    console.log("[ONLINE_ROUTE] API base URL:", process.env["EXPO_PUBLIC_DOMAIN"] ?? "(unset)");
    if (v && Platform.OS !== "web") {
      const [notifOk, locStatus] = await Promise.all([
        checkNotificationPermissions().catch(() => false),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      ]);
      const locOk = locStatus.granted;
      console.log("[ONLINE_ROUTE] permission status: notif=", notifOk, "location=", locOk);
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
    console.log("[ONLINE_ROUTE] final local UI online state:", v, "setDriverOnline result:", JSON.stringify(r));
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

  // Active-ride dock data (read-only, real orders only) ────────────────────────
  const focused =
    activeOrders.find((o) => o.id === currentActiveOrderId) ?? activeOrders[0] ?? null;
  const slots = Array.from({ length: maxActiveOrders }, (_, i) => activeOrders[i] ?? null);

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
            {online && lastLocationSyncAt != null && (
              <Text style={s.lastSyncTxt}>
                Last sync {new Date(lastLocationSyncAt).toLocaleTimeString()}
              </Text>
            )}
          </View>
        </View>
        <View style={s.headerRight}>
          {subscriptionActive && planLabel && (
            <View style={s.planChip}>
              <View style={s.planChipDot} />
              <Text style={s.planChipText}>{planLabel}</Text>
            </View>
          )}
          <Switch
            value={online}
            onValueChange={(v) => void setOnline(v)}
            trackColor={{ false: DANGER_TRACK, true: SUCCESS_TRACK }}
            thumbColor={online ? SUCCESS : DANGER}
            ios_backgroundColor={DANGER_TRACK}
          />
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

      {/* ── EARNED TODAY + HUB STRIP (always visible) ──────────────────────── */}
      <View style={s.topStrip}>
        <View style={s.earnedCard}>
          <View style={s.earnedCardIcon}>
            <Feather name="credit-card" size={16} color={SUCCESS} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.earnedCardLabel}>Earned today</Text>
            <Text style={s.earnedCardValue}>{earnings}</Text>
          </View>
        </View>

        <View style={s.splitCard}>
          {/* My Deliveries (moved from former floating card) */}
          <TouchableOpacity style={s.splitHalf} activeOpacity={0.85} onPress={openAvailable}>
            <View style={s.splitIcon}>
              <Feather name="package" size={15} color={LEMON_ACCENT} />
            </View>
            <Text style={[s.splitCount, { color: LEMON_ACCENT }]} numberOfLines={1}>
              {activeOrderCount}
            </Text>
            <Text style={s.splitLabel} numberOfLines={1}>My Deliveries</Text>
          </TouchableOpacity>

          <View style={s.splitDivider} />

          {/* Delivery Hub */}
          <TouchableOpacity style={s.splitHalf} activeOpacity={0.85} onPress={openHub}>
            <View style={s.splitIcon}>
              <Feather name="grid" size={15} color={LEMON_ACCENT} />
            </View>
            <Text
              style={[s.splitCount, { color: LEMON_ACCENT }, isAtCapacity && s.hubCardValueFull]}
              numberOfLines={1}
            >
              {activeOrderCount}/{maxActiveOrders}
            </Text>
            <Text style={s.splitLabel} numberOfLines={1}>Delivery Hub</Text>
          </TouchableOpacity>
        </View>
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
          paddingTop: 10,
          paddingBottom: insets.bottom + 130,
          gap: 10,
        }}
        showsVerticalScrollIndicator={false}
      >
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

        {/* ── HOT ZONES — HERO MAP with floating deliveries card ────────────── */}
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
  lastSyncTxt: { fontSize: 10, fontWeight: "500", color: MUTED, marginTop: 1 },
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

  // Earned today + Hub top strip
  topStrip: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  earnedCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: MINT_SOFT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: MINT_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  earnedCardIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  earnedCardLabel: { fontSize: 11, fontWeight: "700", color: MUTED },
  earnedCardValue: { fontSize: 18, fontWeight: "900", color: SUCCESS, marginTop: 1, letterSpacing: -0.4 },
  hubCardValueFull: { color: DANGER },

  // Two-column split card (My Deliveries | Delivery Hub)
  splitCard: {
    flex: 1,
    flexDirection: "row",
    alignItems: "stretch",
    backgroundColor: LEMON_SOFT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: LEMON_BORDER,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  splitHalf: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingHorizontal: 2,
  },
  splitIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: CARD,
    alignItems: "center",
    justifyContent: "center",
  },
  splitDivider: {
    width: 1,
    alignSelf: "stretch",
    marginVertical: 6,
    backgroundColor: LEMON_BORDER,
  },
  splitCount: { fontSize: 15, fontWeight: "900", letterSpacing: -0.3 },
  splitLabel: { fontSize: 10, fontWeight: "700", color: MUTED },

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

  // Hot zones / map card
  mapCard: {
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 12,
    gap: 8,
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
