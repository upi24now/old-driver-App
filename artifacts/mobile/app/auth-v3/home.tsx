/**
 * home.tsx — V3 Phase 11: Authenticated Home (V3 Phase Placeholder)
 *
 * Responsibility (ONE):
 *   Show the authenticated driver a confirmation that they're logged in.
 *   This is a placeholder for the V3 phase — during the migration phase
 *   this will be replaced with navigation to the real driver home.
 *
 * Reads from session: uid, phone
 *
 * No B2 dependencies.
 */

import React, { useEffect, useState } from "react";
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

import { getV3Session, clearV3Session } from "@/utils/auth-v3-session";
import { v3Store }                      from "@/utils/auth-v3-store";
import { firebaseAuth }                 from "@/utils/firebase";

export default function V3HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phone, setPhone]   = useState("");
  const [uid,   setUid]     = useState("");
  const [busy,  setBusy]    = useState(false);

  useEffect(() => {
    getV3Session().then((s) => {
      if (s) {
        setPhone(s.phone);
        setUid(s.uid);
      }
    });
  }, []);

  const handleLogout = async () => {
    setBusy(true);
    try {
      await signOut(firebaseAuth);
    } catch {
      // ignore — clear session regardless
    }
    await clearV3Session();
    v3Store.clear();
    router.replace("/auth-v3/welcome");
  };

  return (
    <View
      style={[
        ss.flex, ss.bg,
        { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
      {/* Success badge */}
      <View style={ss.badgeWrap}>
        <View style={ss.badge}>
          <Text style={ss.badgeIcon}>✓</Text>
        </View>
        <Text style={ss.badgeTitle}>Authentication Successful</Text>
        <Text style={ss.badgeSub}>You are now logged in.</Text>
      </View>

      {/* Driver info */}
      <View style={ss.infoCard}>
        <View style={ss.infoRow}>
          <Text style={ss.infoLabel}>Phone</Text>
          <Text style={ss.infoValue}>{phone || "—"}</Text>
        </View>
        <View style={ss.divider} />
        <View style={ss.infoRow}>
          <Text style={ss.infoLabel}>UID</Text>
          <Text style={ss.infoValue} numberOfLines={1}>{uid || "—"}</Text>
        </View>
      </View>

      {/* Migration note */}
      <View style={ss.noticeCard}>
        <Text style={ss.noticeText}>
          🏗 V3 Phase — This screen is a placeholder.{"\n"}
          The real driver home will be wired in during the B2 migration phase.
        </Text>
      </View>

      {/* Logout */}
      <View style={[ss.footer, { paddingHorizontal: 24 }]}>
        <Pressable
          style={[ss.logoutBtn, busy && ss.btnDisabled]}
          onPress={handleLogout}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color={C.primary} />
            : <Text style={ss.logoutLabel}>Log Out</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const C = {
  primary: "#FF6B00",
  bg:      "#F5F4F2",
  text:    "#111111",
  sub:     "#374151",
  muted:   "#6B7280",
  border:  "#E5E7EB",
  success: "#059669",
} as const;

const ss = StyleSheet.create({
  flex:        { flex: 1 },
  bg:          { backgroundColor: C.bg },
  badgeWrap:   { alignItems: "center", marginBottom: 32, paddingHorizontal: 24 },
  badge:       {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: C.success, alignItems: "center", justifyContent: "center",
    marginBottom: 16,
  },
  badgeIcon:   { fontSize: 32, color: "#fff", fontWeight: "700" },
  badgeTitle:  { fontSize: 20, fontWeight: "800", color: C.text, marginBottom: 4 },
  badgeSub:    { fontSize: 14, color: C.sub },

  infoCard:    {
    marginHorizontal: 24, backgroundColor: "#fff",
    borderRadius: 16, padding: 20, marginBottom: 16,
  },
  infoRow:     { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  infoLabel:   { fontSize: 13, color: C.muted, fontWeight: "500" },
  infoValue:   { fontSize: 13, color: C.text, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  divider:     { height: 1, backgroundColor: C.border, marginVertical: 4 },

  noticeCard:  {
    marginHorizontal: 24, backgroundColor: "#FFFBEB",
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#FDE68A",
  },
  noticeText:  { fontSize: 13, color: "#92400E", lineHeight: 20 },

  footer:      { marginTop: "auto" },
  logoutBtn:   {
    borderWidth: 1.5, borderColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  logoutLabel: { color: C.primary, fontSize: 16, fontWeight: "700" },
});
