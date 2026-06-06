/**
 * Background Permission Setup Screen
 *
 * Shown once after onboarding approval, before the main dashboard.
 * Guides the driver to enable three Android settings required for
 * reliable background / lock-screen order-alert delivery:
 *
 *   1. POST_NOTIFICATIONS permission
 *   2. Battery optimization exemption
 *   3. Auto-start / background activity (manufacturer-specific)
 *
 * After the driver taps "Continue", a Firestore flag (backgroundSetupShown)
 * is written so this screen is not shown again on subsequent logins.
 *
 * Profile entry point (future): router.push("/background-setup?back=1")
 */

import { Feather } from "@expo/vector-icons";
import * as IntentLauncher from "expo-intent-launcher";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
  checkNotificationPermissions,
  requestNotificationPermissions,
} from "@/utils/notifications";

const APP_PKG = "in.bikecourierservice.driver";

async function openBatterySettings(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      "android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" as IntentLauncher.ActivityAction,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
        { data: `package:${APP_PKG}` },
      );
    } catch {
      await Linking.openSettings();
    }
  }
}

async function openAppDetails(): Promise<void> {
  if (Platform.OS !== "android") {
    await Linking.openSettings();
    return;
  }
  try {
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS,
      { data: `package:${APP_PKG}` },
    );
  } catch {
    await Linking.openSettings();
  }
}

export default function BackgroundSetupScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const { markBackgroundSetupShown } = useDriver();
  const params   = useLocalSearchParams<{ back?: string }>();
  const fromProfile = params.back === "1";

  const [notifGranted,    setNotifGranted]    = useState(false);
  const [notifLoading,    setNotifLoading]    = useState(false);
  const [batteryOpened,   setBatteryOpened]   = useState(false);
  const [autostartOpened, setAutostartOpened] = useState(false);
  const [saving,          setSaving]          = useState(false);

  useEffect(() => {
    checkNotificationPermissions()
      .then(setNotifGranted)
      .catch(() => setNotifGranted(false));
  }, []);

  async function handleEnableNotifs() {
    setNotifLoading(true);
    const granted = await requestNotificationPermissions();
    setNotifGranted(granted);
    setNotifLoading(false);
  }

  async function handleBattery() {
    await openBatterySettings();
    setBatteryOpened(true);
  }

  async function handleAutostart() {
    await openAppDetails();
    setAutostartOpened(true);
  }

  async function handleContinue() {
    setSaving(true);
    try {
      await markBackgroundSetupShown();
    } finally {
      setSaving(false);
    }
    if (fromProfile) {
      router.back();
    } else {
      router.replace("/(tabs)");
    }
  }

  const scrollPaddingTop = fromProfile ? 16 : insets.top + 16;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {fromProfile && (
        <View
          style={[
            styles.header,
            {
              paddingTop: insets.top + 8,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.backBtn, { backgroundColor: colors.muted }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {"Notification & Background Settings"}
          </Text>
          <View style={{ width: 38 }} />
        </View>
      )}

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: scrollPaddingTop, paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View
            style={[styles.heroIconWrap, { backgroundColor: colors.primary }]}
          >
            <Feather name="bell" size={30} color="#fff" />
          </View>
          <Text style={styles.heroTitle}>Enable Delivery Alerts</Text>
          <Text style={styles.heroSub}>
            {"To receive delivery requests reliably on lock screen and in background, please enable these settings. Takes less than a minute."}
          </Text>
        </LinearGradient>

        <StepCard
          num="1"
          icon="bell"
          title="Notifications"
          body="Required to display order alerts and play the ringtone when a delivery is assigned to you."
          done={notifGranted}
          colors={colors}
        >
          {notifGranted ? (
            <DoneBadge label="Notifications allowed" />
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleEnableNotifs}
              activeOpacity={0.85}
              disabled={notifLoading}
            >
              {notifLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather name="bell" size={14} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    Enable Notifications
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}
          {!notifGranted && (
            <TouchableOpacity
              style={[styles.ghostBtn, { borderColor: colors.border }]}
              onPress={() => Linking.openSettings()}
              activeOpacity={0.7}
            >
              <Feather
                name="external-link"
                size={13}
                color={colors.foreground}
              />
              <Text
                style={[styles.ghostBtnText, { color: colors.foreground }]}
              >
                Open App Settings
              </Text>
            </TouchableOpacity>
          )}
        </StepCard>

        <StepCard
          num="2"
          icon="battery-charging"
          title="Allow Background Running"
          body={"Open battery settings and set this app to \"Unrestricted\", \"Don't optimize\", or \"Allow background activity\"."}
          done={batteryOpened}
          colors={colors}
        >
          {batteryOpened ? (
            <DoneBadge label="Settings opened — select Unrestricted" />
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleBattery}
              activeOpacity={0.85}
            >
              <Feather name="battery-charging" size={14} color="#fff" />
              <Text style={styles.primaryBtnText}>Open Battery Settings</Text>
            </TouchableOpacity>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather
              name="info"
              size={12}
              color={colors.mutedForeground}
              style={{ marginTop: 1 }}
            />
            <Text
              style={[styles.infoText, { color: colors.mutedForeground }]}
            >
              {"Without this, Android may delay or block delivery alerts when your phone is locked or idle for a few minutes."}
            </Text>
          </View>
        </StepCard>

        <StepCard
          num="3"
          icon="smartphone"
          title={"Auto-start & Background Activity"}
          body={"On Realme, Oppo, Vivo, Xiaomi, and Samsung, open App Info and enable Auto Start and Background Activity if available."}
          done={autostartOpened}
          colors={colors}
        >
          {autostartOpened ? (
            <DoneBadge label="App Info opened — enable Auto Start" />
          ) : (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleAutostart}
              activeOpacity={0.85}
            >
              <Feather name="settings" size={14} color="#fff" />
              <Text style={styles.primaryBtnText}>Open App Info</Text>
            </TouchableOpacity>
          )}
          <View style={[styles.infoBox, { backgroundColor: colors.muted }]}>
            <Feather
              name="alert-triangle"
              size={12}
              color="#b75d00"
              style={{ marginTop: 1 }}
            />
            <Text
              style={[styles.infoText, { color: colors.mutedForeground }]}
            >
              {"Path varies by brand — look for Battery \u2192 Unrestricted, or a dedicated \"Auto Start\" toggle in App Info."}
            </Text>
          </View>
        </StepCard>

        <Text style={[styles.skipNote, { color: colors.mutedForeground }]}>
          {"These settings can be changed later from Profile \u2192 Notification & Background Settings."}
        </Text>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.continueBtn, { backgroundColor: colors.primary }]}
          onPress={handleContinue}
          activeOpacity={0.85}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Feather name="check-circle" size={18} color="#fff" />
              <Text style={styles.continueBtnText}>
                I have enabled these — Continue
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

type ColorsShape = ReturnType<typeof useColors>;

function StepCard({
  num,
  icon,
  title,
  body,
  done,
  colors,
  children,
}: {
  num: string;
  icon: string;
  title: string;
  body: string;
  done: boolean;
  colors: ColorsShape;
  children: React.ReactNode;
}) {
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: "#fff",
          borderColor: done ? "#00C853" : colors.border,
          borderWidth: done ? 1.5 : 1,
        },
      ]}
    >
      <View style={styles.cardRow}>
        <View
          style={[
            styles.numBadge,
            { backgroundColor: done ? "#00C853" : "rgba(0,200,83,0.1)" },
          ]}
        >
          {done ? (
            <Feather name="check" size={14} color="#fff" />
          ) : (
            <Text style={styles.numText}>{num}</Text>
          )}
        </View>
        <Text style={[styles.cardTitle, { color: "#0a0a0a", flex: 1 }]}>
          {title}
        </Text>
        <View style={styles.iconCircle}>
          <Feather
            name={icon as React.ComponentProps<typeof Feather>["name"]}
            size={16}
            color="#00C853"
          />
        </View>
      </View>
      <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
        {body}
      </Text>
      <View style={styles.cardActions}>{children}</View>
    </View>
  );
}

function DoneBadge({ label }: { label: string }) {
  return (
    <View style={styles.doneBadge}>
      <Feather name="check-circle" size={14} color="#00C853" />
      <Text style={styles.doneText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 16, fontWeight: "700" },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: { paddingHorizontal: 16, gap: 14 },

  hero: {
    borderRadius: 22,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
  },
  heroIconWrap: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  heroSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.72)",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 4,
  },

  card: {
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  numBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  numText: { fontSize: 13, fontWeight: "800", color: "#00C853" },
  cardTitle: { fontSize: 15, fontWeight: "700" },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(0,200,83,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { fontSize: 13, lineHeight: 18 },
  cardActions: { gap: 8 },

  primaryBtn: {
    height: 42,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  primaryBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  ghostBtn: {
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ghostBtnText: { fontSize: 13, fontWeight: "600" },

  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
    borderRadius: 10,
    padding: 10,
  },
  infoText: { fontSize: 12, lineHeight: 17, flex: 1 },

  doneBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },
  doneText: { fontSize: 13, fontWeight: "600", color: "#00C853" },

  skipNote: {
    textAlign: "center",
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 8,
  },

  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  continueBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
});
