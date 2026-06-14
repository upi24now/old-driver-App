/**
 * Permission Center — Card Wall (v6)
 *
 * Replaced the step-by-step wizard with a single screen showing all
 * 4 mandatory permissions simultaneously as cards.
 *
 * Permissions:
 *   1. Notifications      — required;     auto-fired on mount
 *   2. Location           — required;     auto-fired after notifications settle
 *   3. Background Loc     — recommended;  explicit "Allow All The Time" tap
 *   4. Phone Call         — recommended;  explicit "Allow" tap
 *
 * Continue button unlocks only when Notifications + Location are granted.
 * Background Location and Phone are strongly recommended but not blockers.
 *
 * Android restrictions respected:
 *   - Only one OS dialog is shown at a time (sequential auto-fire).
 *   - Background location can only be requested after foreground is granted.
 *   - CALL_PHONE uses PermissionsAndroid (no extra package needed).
 *   - If canAskAgain=false, button switches to "Open Settings".
 *   - AppState listener refreshes all statuses when app returns to foreground.
 */

import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
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
import { useColors } from "@/hooks/useColors";
import {
  type AllPermissionsStatus,
  checkAllPermissions,
  openNotificationSettings,
  openPermissionSettings,
  requestBackgroundLocation,
  requestForegroundLocation,
  requestNotificationPermissions,
  requestPhonePermission,
} from "@/utils/permissions";

// ─── Default "all pending" state ──────────────────────────────────────────────

const DEFAULT_PERMS: AllPermissionsStatus = {
  notifications:      { granted: false, canAskAgain: true },
  location:           { granted: false, canAskAgain: true },
  backgroundLocation: { granted: false, canAskAgain: true },
  phoneCall:          { granted: false, canAskAgain: true },
};

// ─── Individual permission card ───────────────────────────────────────────────

type IconName = React.ComponentProps<typeof Feather>["name"];

interface CardProps {
  icon: IconName;
  iconColor: string;
  iconBg: string;
  title: string;
  description: string;
  required: boolean;
  granted: boolean;
  canAskAgain: boolean;
  actionDisabled?: boolean;
  disabledNote?: string;
  loading?: boolean;
  onAllow: () => void;
  onOpenSettings: () => void;
}

function PermCard({
  icon, iconColor, iconBg, title, description, required,
  granted, canAskAgain, actionDisabled, disabledNote, loading,
  onAllow, onOpenSettings,
}: CardProps) {
  const colors = useColors();

  const chipBg    = required ? colors.errorSoft : colors.infoSoft;
  const chipColor = required ? colors.errorText  : colors.infoText;

  return (
    <View
      style={[
        cs.card,
        {
          backgroundColor: colors.card,
          borderColor: granted
            ? (colors.success as string) + "50"
            : colors.border,
        },
      ]}
    >
      {/* Card header — icon + title + badge */}
      <View style={cs.cardTop}>
        <View style={[cs.iconCircle, { backgroundColor: iconBg }]}>
          <Feather name={icon} size={22} color={iconColor} />
        </View>

        <View style={cs.cardMeta}>
          <View style={cs.titleRow}>
            <Text style={[cs.cardTitle, { color: colors.foreground }]}>{title}</Text>
            <View style={[cs.chip, { backgroundColor: chipBg }]}>
              <Text style={[cs.chipText, { color: chipColor }]}>
                {required ? "Required" : "Recommended"}
              </Text>
            </View>
          </View>
          <Text style={[cs.cardDesc, { color: colors.mutedForeground }]}>
            {description}
          </Text>
        </View>
      </View>

      {/* Status + action row */}
      <View style={[cs.statusRow, { borderTopColor: colors.border }]}>
        {granted ? (
          <View style={[cs.statusChip, { backgroundColor: colors.successSoft }]}>
            <Feather name="check-circle" size={12} color={colors.success} />
            <Text style={[cs.statusText, { color: colors.successText }]}>Granted</Text>
          </View>
        ) : (
          <View style={[cs.statusChip, { backgroundColor: colors.warningSoft }]}>
            <Feather name="clock" size={12} color={colors.warning} />
            <Text style={[cs.statusText, { color: colors.warningText }]}>Pending</Text>
          </View>
        )}

        {/* Spacer */}
        <View style={{ flex: 1 }} />

        {/* Action area (only shown when not granted) */}
        {!granted && (
          <>
            {loading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : actionDisabled && disabledNote ? (
              <Text style={[cs.disabledNote, { color: colors.mutedForeground }]}>
                {disabledNote}
              </Text>
            ) : canAskAgain ? (
              <TouchableOpacity
                style={[cs.allowBtn, { backgroundColor: colors.primary }]}
                onPress={onAllow}
                activeOpacity={0.8}
              >
                <Text style={cs.allowBtnText}>Allow</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[cs.settingsBtn, { borderColor: colors.border }]}
                onPress={onOpenSettings}
                activeOpacity={0.8}
              >
                <Feather name="settings" size={12} color={colors.foreground} />
                <Text style={[cs.settingsBtnText, { color: colors.foreground }]}>
                  Open Settings
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PermissionCenterScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { markBackgroundSetupShown } = useDriver();
  const params  = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  const [perms,          setPerms]          = useState<AllPermissionsStatus>(DEFAULT_PERMS);
  const [initializing,   setInitializing]   = useState(true);
  const [requestingBg,   setRequestingBg]   = useState(false);
  const [requestingPhone,setRequestingPhone] = useState(false);
  const [finishing,      setFinishing]      = useState(false);

  // ── Refresh all permission states ─────────────────────────────────────────
  async function refresh() {
    if (Platform.OS === "web") return;
    const s = await checkAllPermissions().catch(() => DEFAULT_PERMS);
    setPerms(s);
  }

  // ── AppState listener — re-check when app returns from Settings ───────────
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void refresh();
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

      // Step 1 — Notifications
      if (!current.notifications.granted && current.notifications.canAskAgain) {
        await requestNotificationPermissions().catch(() => false);
      }

      // Brief pause so Android can settle between dialogs
      await new Promise<void>((r) => setTimeout(r, 350));

      // Step 2 — Location (foreground)
      const afterNotif = await checkAllPermissions().catch(() => DEFAULT_PERMS);
      setPerms(afterNotif);

      if (!afterNotif.location.granted && afterNotif.location.canAskAgain) {
        await requestForegroundLocation().catch(() => ({ granted: false, canAskAgain: false }));
      }

      // Final state
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
    } else {
      router.replace("/(tabs)");
    }
  }

  // ── Background location handler ───────────────────────────────────────────
  async function handleAllowBgLoc() {
    setRequestingBg(true);
    await requestBackgroundLocation().catch(() => ({ granted: false, canAskAgain: false }));
    await refresh();
    setRequestingBg(false);
  }

  // ── Phone handler ─────────────────────────────────────────────────────────
  async function handleAllowPhone() {
    setRequestingPhone(true);
    await requestPhonePermission().catch(() => ({ granted: false, canAskAgain: false }));
    await refresh();
    setRequestingPhone(false);
  }

  // ── Web bypass ────────────────────────────────────────────────────────────
  if (Platform.OS === "web") {
    return (
      <View style={[ws.root, { paddingTop: insets.top + 40 }]}>
        <Text style={[ws.title, { color: colors.foreground }]}>App Permissions</Text>
        <Text style={[ws.sub, { color: colors.mutedForeground }]}>
          Permission dialogs are not available in the web preview.
        </Text>
        <TouchableOpacity
          style={[ws.btn, { backgroundColor: colors.primary }]}
          onPress={() => {
            setFinishing(true);
            void markBackgroundSetupShown()
              .then(() => router.replace("/(tabs)"))
              .finally(() => setFinishing(false));
          }}
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

  // ── Derived values for card props ─────────────────────────────────────────
  const primaryColor = colors.primary as string;
  const infoColor    = colors.info    as string;

  return (
    <View style={[cs.root, { backgroundColor: colors.background }]}>

      {/* Back button (profile entry only) */}
      {fromProfile && (
        <View style={[cs.topBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={[cs.backBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>
      )}

      {/* Scrollable content */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          cs.scroll,
          { paddingTop: fromProfile ? 12 : insets.top + 20 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand header */}
        <View style={cs.brandRow}>
          <View style={[cs.logoCircle, { backgroundColor: colors.primary }]}>
            <Feather name="truck" size={20} color="#fff" />
          </View>
          <Text style={[cs.appName, { color: colors.foreground }]}>Driver App</Text>
        </View>

        {/* Title */}
        <Text style={[cs.heading, { color: colors.foreground }]}>
          App Permissions
        </Text>
        <Text style={[cs.subheading, { color: colors.mutedForeground }]}>
          Grant these permissions for the best delivery experience
        </Text>

        {/* ── Card 1 — Notifications ──────────────────────────────────────── */}
        <PermCard
          icon="bell"
          iconColor="#fff"
          iconBg={primaryColor}
          title="Notifications"
          description="Get instant alerts for new delivery orders, even when the screen is locked."
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

        {/* ── Card 2 — Location ───────────────────────────────────────────── */}
        <PermCard
          icon="map-pin"
          iconColor="#fff"
          iconBg={primaryColor}
          title="Precise Location"
          description="Required for finding nearby deliveries and navigating routes accurately."
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

        {/* ── Card 3 — Background Location ────────────────────────────────── */}
        <PermCard
          icon="navigation"
          iconColor={infoColor}
          iconBg={(colors.infoSoft as string)}
          title="Background Location"
          description="Allows the app to receive delivery requests and track routes even when minimised."
          required={false}
          granted={perms.backgroundLocation.granted}
          canAskAgain={perms.backgroundLocation.canAskAgain}
          loading={requestingBg}
          actionDisabled={!perms.location.granted || initializing}
          disabledNote={!perms.location.granted ? "Grant Location first" : undefined}
          onAllow={() => void handleAllowBgLoc()}
          onOpenSettings={() => void openPermissionSettings()}
        />

        {/* ── Card 4 — Phone Call ──────────────────────────────────────────── */}
        <PermCard
          icon="phone"
          iconColor={infoColor}
          iconBg={(colors.infoSoft as string)}
          title="Phone Calls"
          description="Lets you call customers and support directly from within the app."
          required={false}
          granted={perms.phoneCall.granted}
          canAskAgain={perms.phoneCall.canAskAgain}
          loading={requestingPhone}
          actionDisabled={initializing}
          onAllow={() => void handleAllowPhone()}
          onOpenSettings={() => void openPermissionSettings()}
        />

        {/* Hint text */}
        <Text style={[cs.hint, { color: colors.mutedForeground }]}>
          Background Location and Phone are recommended but not mandatory to start delivering.
        </Text>

        {/* Bottom spacing for sticky footer */}
        <View style={{ height: 24 }} />
      </ScrollView>

      {/* Sticky footer */}
      <View
        style={[
          cs.footer,
          {
            paddingBottom: insets.bottom + 24,
            backgroundColor: colors.background,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[
            cs.continueBtn,
            {
              backgroundColor: canContinue ? colors.primary : colors.muted,
            },
          ]}
          onPress={() => void finish()}
          activeOpacity={0.85}
          disabled={!canContinue || finishing}
        >
          {finishing || (initializing && !canContinue) ? (
            <ActivityIndicator size="small" color={canContinue ? "#fff" : colors.mutedForeground} />
          ) : (
            <>
              <Text
                style={[
                  cs.continueBtnText,
                  { color: canContinue ? "#fff" : colors.mutedForeground },
                ]}
              >
                Continue
              </Text>
              {canContinue && (
                <Feather name="arrow-right" size={16} color="#fff" style={{ marginLeft: 6 }} />
              )}
            </>
          )}
        </TouchableOpacity>

        {!canContinue && !initializing && (
          <Text style={[cs.gateNote, { color: colors.mutedForeground }]}>
            Allow Notifications and Location to continue
          </Text>
        )}
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cs = StyleSheet.create({
  root: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: 20,
    gap: 12,
    paddingBottom: 20,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  logoCircle: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontSize: 17,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  heading: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subheading: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },

  // ── Card ────────────────────────────────────────────────────────────────────
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 16,
    gap: 14,
  },
  iconCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardMeta: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
    flexWrap: "wrap",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
  },
  chip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 20,
  },
  chipText: {
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
  },

  // ── Status row ──────────────────────────────────────────────────────────────
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  allowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  allowBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  settingsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  settingsBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  disabledNote: {
    fontSize: 12,
    fontStyle: "italic",
  },

  // ── Hint ────────────────────────────────────────────────────────────────────
  hint: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    paddingHorizontal: 8,
    marginTop: 4,
  },

  // ── Footer ──────────────────────────────────────────────────────────────────
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  continueBtn: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  gateNote: {
    fontSize: 12,
    textAlign: "center",
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
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
  },
  sub: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  btn: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  btnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
