/**
 * home.tsx — V3 Phase 15: Authenticated Home (Placeholder)
 *
 * Responsibility (ONE):
 *   Confirm successful authentication and provide a logout mechanism.
 *
 * This is a V3-phase placeholder. During the B2 migration phase, successful
 * authentication will navigate to the real driver home (/(tabs)) instead.
 *
 * Reads: saved V3 session (uid + phone)
 * On logout: clears session, clears flow context, navigates to welcome
 *
 * Unmount-safe: mountedRef prevents state updates after navigation.
 *
 * No B2 dependencies.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signOut } from "firebase/auth";

import { useV3Flow }                    from "@/contexts/auth-v3/FlowContext";
import { getV3Session, clearV3Session } from "@/utils/auth-v3-session";
import { firebaseAuth }                 from "@/utils/firebase";

export default function V3HomeScreen() {
  const router      = useRouter();
  const insets      = useSafeAreaInsets();
  const mountedRef  = useRef(true);
  const { clearFlow } = useV3Flow();

  const [phone, setPhone] = useState("");
  const [uid,   setUid]   = useState("");
  const [busy,  setBusy]  = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    getV3Session().then((s) => {
      if (!mountedRef.current) return;
      if (s) { setPhone(s.phone); setUid(s.uid); }
    });
    return () => { mountedRef.current = false; };
  }, []);

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    try { await signOut(firebaseAuth); } catch { /* ignore — clear anyway */ }
    if (!mountedRef.current) return;
    await clearV3Session();
    clearFlow();
    router.replace("/auth-v3/welcome");
  };

  return (
    <View
      style={[
        ss.flex,
        ss.bg,
        { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      {/* Success badge */}
      <View style={ss.badgeSection}>
        <View style={ss.badge}>
          <Text style={ss.badgeIcon}>✓</Text>
        </View>
        <Text style={ss.badgeTitle}>Authentication Successful</Text>
        <Text style={ss.badgeSub}>You are now logged in.</Text>
      </View>

      {/* Session info */}
      <View style={ss.card}>
        <InfoRow label="Phone" value={phone || "—"} />
        <View style={ss.divider} />
        <InfoRow label="UID" value={uid || "—"} mono />
      </View>

      {/* Migration notice */}
      <View style={ss.notice}>
        <Text style={ss.noticeText}>
          🏗  V3 Phase — Placeholder screen.{"\n"}
          The real driver home will be connected during the B2 migration phase.
        </Text>
      </View>

      {/* Spacer */}
      <View style={{ flex: 1 }} />

      {/* Logout */}
      <Pressable
        style={[ss.logoutBtn, { marginHorizontal: 24 }, busy && ss.btnDisabled]}
        onPress={() => void handleLogout()}
        disabled={busy}
      >
        {busy
          ? <ActivityIndicator color={C.primary} />
          : <Text style={ss.logoutLabel}>Log Out</Text>}
      </Pressable>
    </View>
  );
}

function InfoRow({
  label, value, mono = false,
}: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <View style={ir.row}>
      <Text style={ir.label}>{label}</Text>
      <Text style={[ir.value, mono && ir.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const C = {
  primary: "#FF6B00",
  bg:      "#F5F4F2",
  text:    "#111111",
  muted:   "#6B7280",
  border:  "#E5E7EB",
  success: "#059669",
} as const;

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { backgroundColor: C.bg },
  badgeSection: { alignItems: "center", marginBottom: 28, paddingHorizontal: 24 },
  badge:        {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.success, alignItems: "center", justifyContent: "center",
    marginBottom: 16,
  },
  badgeIcon:    { fontSize: 32, color: "#fff", fontWeight: "700" },
  badgeTitle:   { fontSize: 20, fontWeight: "800", color: C.text, marginBottom: 4 },
  badgeSub:     { fontSize: 14, color: C.muted },
  card:         {
    marginHorizontal: 24, backgroundColor: "#fff",
    borderRadius: 16, padding: 20, marginBottom: 16,
  },
  divider:      { height: 1, backgroundColor: C.border, marginVertical: 8 },
  notice:       {
    marginHorizontal: 24, backgroundColor: "#FFFBEB",
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#FDE68A",
  },
  noticeText:   { fontSize: 13, color: "#92400E", lineHeight: 20 },
  logoutBtn:    {
    borderWidth: 1.5, borderColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:  { opacity: 0.4 },
  logoutLabel:  { color: C.primary, fontSize: 16, fontWeight: "700" },
});

const ir = StyleSheet.create({
  row:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  label: { fontSize: 13, color: C.muted, fontWeight: "500" },
  value: { fontSize: 13, color: C.text, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  mono:  { fontFamily: "monospace", fontSize: 11 },
});
