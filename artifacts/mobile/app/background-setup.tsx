/**
 * Permission Center — App Permissions screen (Screen 1 of onboarding)
 *
 * UI redesigned to match professional logistics app style (Rapido/Porter/Uber Driver).
 * ALL permission logic, navigation, and AppState handling are unchanged.
 *
 * Permissions:
 *   1. Notifications      — required;     auto-fired on mount
 *   2. Location           — required;     auto-fired after notifications settle
 *   3. Background Loc     — recommended;  explicit tap
 *
 * Continue button unlocks only when Notifications + Location are granted.
 */

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import {
  type AllPermissionsStatus,
  checkAllPermissions,
  openBatterySettings,
  openNotificationSettings,
  openPermissionSettings,
  requestBackgroundLocation,
  requestForegroundLocation,
  requestNotificationPermissions,
} from "@/utils/permissions";
import { getDriverProfile } from "@/utils/profile-api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:          "#F8FAFC",
  primary:     "#FF6B00",
  primarySoft: "#FFF3EC",
  success:     "#16A34A",
  successSoft: "#DCFCE7",
  text:        "#111827",
  textMuted:   "#6B7280",
  white:       "#FFFFFF",
  border:      "#E5E7EB",
  divider:     "#F3F4F6",
  errorSoft:   "#FEE2E2",
  errorText:   "#DC2626",
  blueSoft:    "#DBEAFE",
  blueText:    "#2563EB",
  blueIcon:    "#3B82F6",
} as const;

// ─── Default "all pending" state ──────────────────────────────────────────────
const DEFAULT_PERMS: AllPermissionsStatus = {
  notifications:      { granted: false, canAskAgain: true },
  location:           { granted: false, canAskAgain: true },
  backgroundLocation: { granted: false, canAskAgain: true },
};

// ─── Permission card ──────────────────────────────────────────────────────────
type IconName = React.ComponentProps<typeof Feather>["name"];

interface CardProps {
  icon:            IconName;
  iconColor:       string;
  iconBg:          string;
  title:           string;
  description:     string;
  required:        boolean;
  granted:         boolean;
  canAskAgain:     boolean;
  actionDisabled?: boolean;
  disabledNote?:   string;
  loading?:        boolean;
  onAllow:         () => void;
  onOpenSettings:  () => void;
}

function PermCard({
  icon, iconColor, iconBg, title, description, required,
  granted, canAskAgain, actionDisabled, disabledNote, loading,
  onAllow, onOpenSettings,
}: CardProps) {
  const badgeBg    = required ? D.errorSoft  : D.blueSoft;
  const badgeColor = required ? D.errorText  : D.blueText;
  const badgeLabel = required ? "Required"   : "Recommended";

  return (
    <View style={cs.card}>
      {/* Top: icon + title + badge */}
      <View style={cs.cardTop}>
        <View style={[cs.iconWrap, { backgroundColor: iconBg }]}>
          <Feather name={icon} size={22} color={iconColor} />
        </View>

        <View style={{ flex: 1, gap: 3 }}>
          <View style={cs.titleRow}>
            <Text style={cs.cardTitle}>{title}</Text>
            <View style={[cs.badge, { backgroundColor: badgeBg }]}>
              <Text style={[cs.badgeText, { color: badgeColor }]}>{badgeLabel}</Text>
            </View>
          </View>
          <Text style={cs.cardDesc}>{description}</Text>
        </View>
      </View>

      {/* Divider */}
      <View style={cs.divider} />

      {/* Status row */}
      <View style={cs.statusRow}>
        {/* Left: status indicator */}
        <View style={cs.statusLeft}>
          <Feather
            name="check-circle"
            size={16}
            color={granted ? D.success : D.success}
          />
          <Text style={[cs.statusText, { color: granted ? D.success : D.textMuted }]}>
            {granted ? "Granted" : "Not Granted"}
          </Text>
        </View>

        {/* Right: action */}
        {loading ? (
          <ActivityIndicator size="small" color={D.primary} />
        ) : granted ? (
          <Feather name="chevron-right" size={16} color={D.border} />
        ) : actionDisabled && disabledNote ? (
          <Text style={cs.disabledNote}>{disabledNote}</Text>
        ) : canAskAgain ? (
          <TouchableOpacity
            style={cs.allowBtn}
            onPress={onAllow}
            activeOpacity={0.8}
          >
            <Text style={cs.allowBtnText}>Allow</Text>
            <Feather name="chevron-right" size={13} color={D.white} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={cs.settingsBtn}
            onPress={onOpenSettings}
            activeOpacity={0.8}
          >
            <Feather name="settings" size={12} color={D.text} />
            <Text style={cs.settingsBtnText}>Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PermissionCenterScreen() {
  const insets  = useSafeAreaInsets();
  const { markBackgroundSetupShown, driverUid } = useDriver();
  const params  = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  const [perms,           setPerms]          = useState<AllPermissionsStatus>(DEFAULT_PERMS);
  const [initializing,    setInitializing]   = useState(true);
  const [requestingBg,    setRequestingBg]   = useState(false);
  const [finishing,       setFinishing]      = useState(false);
  const [batteryGranted,  setBatteryGranted] = useState(false);
  const [requestingBatt,  setRequestingBatt] = useState(false);
  // Optimistic: JS cannot read PowerManager.isIgnoringBatteryOptimizations()
  // without a native module, so we mark granted when the app returns from
  // background after the user tapped Allow (same pattern as dashboard health card).
  const battWaiting = useRef(false);

  // ── Refresh all permission states ─────────────────────────────────────────
  async function refresh() {
    if (Platform.OS === "web") return;
    const s = await checkAllPermissions().catch(() => DEFAULT_PERMS);
    setPerms(s);
  }

  // ── AppState listener — re-check when app returns from Settings ───────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        void refresh();
        // Battery: optimistic grant when user returns after tapping Allow
        if (battWaiting.current) {
          battWaiting.current = false;
          setBatteryGranted(true);
          setRequestingBatt(false);
        }
      }
    });
    return () => sub.remove();
  }, []);

  // ── On mount: auto-fire notifications → location sequentially ────────────
  useEffect(() => {
    void (async () => {
      setInitializing(true);

      if (Platform.OS === "web") {
        setInitializing(false);
        return;
      }

      const current = await checkAllPermissions().catch(() => DEFAULT_PERMS);
      setPerms(current);

      if (!current.notifications.granted && current.notifications.canAskAgain) {
        await requestNotificationPermissions().catch(() => false);
      }

      await new Promise<void>((r) => setTimeout(r, 350));

      const afterNotif = await checkAllPermissions().catch(() => DEFAULT_PERMS);
      setPerms(afterNotif);

      if (!afterNotif.location.granted && afterNotif.location.canAskAgain) {
        await requestForegroundLocation().catch(() => ({ granted: false, canAskAgain: false }));
      }

      const final = await checkAllPermissions().catch(() => DEFAULT_PERMS);
      setPerms(final);
      setInitializing(false);
    })();
  }, []);

  // ── Continue / Finish ─────────────────────────────────────────────────────
  const canContinue =
    perms.notifications.granted && perms.location.granted && !initializing;

  async function finish() {
    setFinishing(true);
    try {
      await markBackgroundSetupShown();
    } finally {
      setFinishing(false);
    }
    if (fromProfile) {
      router.back();
    } else if (driverUid) {
      const pgProfile = await getDriverProfile();
      const nextRoute = pgProfile?.nextRoute ?? "/(tabs)";
      console.log("[PERMISSION_GATE] background-setup complete — logged in → server nextRoute =", nextRoute);
      router.replace(nextRoute as never);
    } else {
      console.log("[PERMISSION_GATE] first install complete → /login");
      router.replace("/login");
    }
  }

  // ── Background location handler ───────────────────────────────────────────
  async function handleAllowBgLoc() {
    setRequestingBg(true);
    await requestBackgroundLocation().catch(() => ({ granted: false, canAskAgain: false }));
    await refresh();
    setRequestingBg(false);
  }

  // ── Battery optimization handler ──────────────────────────────────────────
  async function handleAllowBattery() {
    if (batteryGranted) return;
    setRequestingBatt(true);
    // Mark that we're waiting for the user to return from the battery dialog.
    // The AppState 'active' listener will mark batteryGranted=true on return.
    battWaiting.current = true;
    await openBatterySettings().catch(() => {});
    // If openBatterySettings() returned without going to background
    // (e.g. web / dialog dismissed instantly), clear the loading state.
    if (battWaiting.current) {
      battWaiting.current = false;
      setRequestingBatt(false);
    }
  }

  // ── Web bypass ────────────────────────────────────────────────────────────
  if (Platform.OS === "web") {
    return (
      <View style={[ws.root, { paddingTop: insets.top + 40, backgroundColor: D.bg }]}>
        <View style={ws.logoCircle}>
          <Text style={ws.logoText}>BC</Text>
        </View>
        <Text style={ws.title}>App Permissions</Text>
        <Text style={ws.sub}>Permission dialogs are not available in the web preview.</Text>
        <TouchableOpacity
          style={[ws.btn, { backgroundColor: D.primary }]}
          onPress={() => void finish()}
          activeOpacity={0.85}
          disabled={finishing}
        >
          {finishing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={ws.btnText}>Continue to Dashboard</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[cs.root, { backgroundColor: D.bg }]}>

      {/* Back button (only when opened from Profile) */}
      {fromProfile && (
        <View style={[cs.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={cs.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={D.text} />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Scrollable content ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          cs.scroll,
          { paddingTop: fromProfile ? 16 : insets.top + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Brand hero ── */}
        <View style={cs.heroSection}>
          {/* BC logo circle */}
          <View style={cs.logoCircle}>
            <Text style={cs.logoText}>BC</Text>
          </View>

          {/* BikeCourier + PARTNER label */}
          <Text style={cs.brandName}>
            <Text style={{ color: D.text }}>Bike</Text>
            <Text style={{ color: D.primary }}>Courier</Text>
          </Text>
          <Text style={cs.partnerLabel}>PARTNER</Text>

          {/* Main headline */}
          <Text style={cs.headline}>Start Delivering Today</Text>
          <Text style={cs.subline}>Complete setup in less than 2 minutes</Text>
        </View>

        {/* ══════════════════════════════════════════════════
            CARD 1 — Notifications
        ══════════════════════════════════════════════════ */}
        <PermCard
          icon="bell"
          iconColor={D.primary}
          iconBg={D.primarySoft}
          title="Notifications"
          description="Get instant order alerts and updates."
          required
          granted={perms.notifications.granted}
          canAskAgain={perms.notifications.canAskAgain}
          loading={initializing && !perms.notifications.granted}
          actionDisabled={false}
          onAllow={() => {
            void (async () => {
              await requestNotificationPermissions().catch(() => false);
              await refresh();
            })();
          }}
          onOpenSettings={() => void openNotificationSettings()}
        />

        {/* ══════════════════════════════════════════════════
            CARD 2 — Precise Location
        ══════════════════════════════════════════════════ */}
        <PermCard
          icon="map-pin"
          iconColor={D.primary}
          iconBg={D.primarySoft}
          title="Precise Location"
          description="Required to find nearby deliveries."
          required
          granted={perms.location.granted}
          canAskAgain={perms.location.canAskAgain}
          loading={initializing && perms.notifications.granted && !perms.location.granted}
          actionDisabled={false}
          onAllow={() => {
            void (async () => {
              await requestForegroundLocation().catch(() => ({ granted: false, canAskAgain: false }));
              await refresh();
            })();
          }}
          onOpenSettings={() => void openPermissionSettings()}
        />

        {/* ══════════════════════════════════════════════════
            CARD 3 — Background Location
        ══════════════════════════════════════════════════ */}
        <PermCard
          icon="navigation"
          iconColor={D.blueIcon}
          iconBg={D.blueSoft}
          title="Background Location"
          description="Receive orders even when app is minimized."
          required={false}
          granted={perms.backgroundLocation.granted}
          canAskAgain={perms.backgroundLocation.canAskAgain}
          loading={requestingBg}
          actionDisabled={!perms.location.granted || initializing}
          disabledNote={!perms.location.granted ? "Grant Location first" : undefined}
          onAllow={() => void handleAllowBgLoc()}
          onOpenSettings={() => void openPermissionSettings()}
        />

        {/* ══════════════════════════════════════════════════
            CARD 4 — Battery Optimization
        ══════════════════════════════════════════════════ */}
        <PermCard
          icon="battery-charging"
          iconColor="#16A34A"
          iconBg="#DCFCE7"
          title="Battery Optimization"
          description="Allow BikeCourier to run reliably in background and receive delivery requests without interruption."
          required={false}
          granted={batteryGranted}
          canAskAgain={!batteryGranted}
          loading={requestingBatt}
          actionDisabled={false}
          onAllow={() => void handleAllowBattery()}
          onOpenSettings={() => void handleAllowBattery()}
        />

        {/* ── Privacy note ── */}
        <View style={cs.privacyRow}>
          <Feather name="shield" size={16} color={D.primary} />
          <Text style={cs.privacyText}>
            We respect your privacy. Your data is safe and used only to provide better delivery experience.
          </Text>
        </View>

        <View style={{ height: 16 }} />
      </ScrollView>

      {/* ── Sticky footer ── */}
      <View style={[cs.footer, { paddingBottom: insets.bottom + 20 }]}>
        <TouchableOpacity
          style={[cs.continueBtn, !canContinue && cs.continueBtnDisabled]}
          onPress={() => void finish()}
          activeOpacity={0.85}
          disabled={!canContinue || finishing}
        >
          {finishing || (initializing && !canContinue) ? (
            <ActivityIndicator
              size="small"
              color={canContinue ? D.white : D.textMuted}
            />
          ) : (
            <>
              <Text style={[cs.continueBtnText, !canContinue && cs.continueBtnTextDisabled]}>
                Continue
              </Text>
              {canContinue && (
                <Feather name="arrow-right" size={18} color={D.white} style={{ marginLeft: 8 }} />
              )}
            </>
          )}
        </TouchableOpacity>

        {!canContinue && !initializing && (
          <Text style={cs.gateNote}>
            Allow Notifications and Location to continue
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const cs = StyleSheet.create({
  root: { flex: 1 },

  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 140,
  },

  // ── Hero ────────────────────────────────────────────────────────────────────
  heroSection: {
    alignItems: "center",
    marginBottom: 18,
  },
  logoCircle: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: D.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  logoText: {
    fontSize: 26,
    fontWeight: "900",
    color: D.white,
    letterSpacing: 0.5,
  },
  brandName: {
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  partnerLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: D.primary,
    letterSpacing: 2.5,
    textTransform: "uppercase",
  },
  headline: {
    fontSize: 27,
    fontWeight: "800",
    color: D.text,
    letterSpacing: -0.5,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 33,
  },
  subline: {
    fontSize: 13,
    color: D.textMuted,
    textAlign: "center",
    lineHeight: 19,
    marginTop: 4,
  },

  // ── Card ────────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: D.white,
    borderRadius: 20,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: D.text,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  cardDesc: {
    fontSize: 13,
    color: D.textMuted,
    lineHeight: 18,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: D.border,
    marginHorizontal: 18,
  },

  // ── Status row ──────────────────────────────────────────────────────────────
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  allowBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: D.primary,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 8,
  },
  allowBtnText: {
    color: D.white,
    fontSize: 12,
    fontWeight: "700",
  },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: D.border,
  },
  settingsBtnText: {
    fontSize: 11,
    fontWeight: "600",
    color: D.text,
  },
  disabledNote: {
    fontSize: 12,
    fontStyle: "italic",
    color: D.textMuted,
  },

  // ── Privacy note ─────────────────────────────────────────────────────────────
  privacyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: D.primarySoft,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  privacyText: {
    flex: 1,
    fontSize: 12,
    color: D.textMuted,
    lineHeight: 17,
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
    backgroundColor: D.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: D.border,
  },
  continueBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: D.primary,
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  continueBtnDisabled: {
    backgroundColor: "#E5E7EB",
    shadowOpacity: 0,
    elevation: 0,
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: D.white,
    letterSpacing: 0.2,
  },
  continueBtnTextDisabled: {
    color: D.textMuted,
  },
  gateNote: {
    fontSize: 12,
    textAlign: "center",
    color: D.textMuted,
    paddingBottom: 4,
  },
});

// ─── Web-only styles ──────────────────────────────────────────────────────────
const ws = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 14,
  },
  logoCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: D.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: {
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: D.text,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    color: D.textMuted,
  },
  btn: {
    height: 56,
    borderRadius: 16,
    paddingHorizontal: 40,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
