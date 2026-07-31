/**
 * COMPARTMENT 8 — UI Layer: Home Screen (V3 Placeholder)
 *
 * Single responsibility: confirm successful authentication, show session info,
 * and provide a logout mechanism.
 *
 * Imports only from:
 *   C2  Engine      — engineLogout, V3Session (type)
 *   C3  Session     — sessionLoad (read-only display)
 *   C8  FlowContext — clearFlow
 *   C1  Navigation  — navToWelcome
 *   C10 Config      — COLORS
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

import { engineLogout }    from "@/modules/auth-v3/engine";
import { sessionLoad }     from "@/modules/auth-v3/session";
import { useV3Flow }       from "@/modules/auth-v3/ui/context/FlowContext";
import { navToWelcome }    from "@/modules/auth-v3/navigation";
import { COLORS }          from "@/modules/auth-v3/config";

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
    sessionLoad().then((result) => {
      if (!mountedRef.current) return;
      if (result.success && result.data) {
        setPhone(result.data.phone);
        setUid(result.data.uid);
      }
    });
    return () => { mountedRef.current = false; };
  }, []);

  const handleLogout = async () => {
    if (busy) return;
    setBusy(true);
    await engineLogout();
    if (!mountedRef.current) return;
    clearFlow();
    navToWelcome(router);
  };

  return (
    <View
      style={[
        ss.flex, ss.bg,
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

      <View style={{ flex: 1 }} />

      {/* Logout */}
      <Pressable
        style={[ss.logoutBtn, { marginHorizontal: 24 }, busy && ss.btnDisabled]}
        onPress={() => void handleLogout()}
        disabled={busy}
      >
        {busy
          ? <ActivityIndicator color={COLORS.primary} />
          : <Text style={ss.logoutLabel}>Log Out</Text>}
      </Pressable>
    </View>
  );
}

function InfoRow({ label, value, mono = false }: {
  label: string; value: string; mono?: boolean;
}) {
  return (
    <View style={ir.row}>
      <Text style={ir.label}>{label}</Text>
      <Text style={[ir.value, mono && ir.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { backgroundColor: COLORS.bgAlt },
  badgeSection: { alignItems: "center", marginBottom: 28, paddingHorizontal: 24 },
  badge:        {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: COLORS.success, alignItems: "center", justifyContent: "center",
    marginBottom: 16,
  },
  badgeIcon:    { fontSize: 32, color: "#fff", fontWeight: "700" },
  badgeTitle:   { fontSize: 20, fontWeight: "800", color: COLORS.text, marginBottom: 4 },
  badgeSub:     { fontSize: 14, color: COLORS.muted },
  card:         {
    marginHorizontal: 24, backgroundColor: "#fff",
    borderRadius: 16, padding: 20, marginBottom: 16,
  },
  divider:      { height: 1, backgroundColor: COLORS.border, marginVertical: 8 },
  notice:       {
    marginHorizontal: 24, backgroundColor: "#FFFBEB",
    borderRadius: 12, padding: 16, borderWidth: 1, borderColor: COLORS.tintBorder,
  },
  noticeText:   { fontSize: 13, color: "#92400E", lineHeight: 20 },
  logoutBtn:    {
    borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:  { opacity: 0.4 },
  logoutLabel:  { color: COLORS.primary, fontSize: 16, fontWeight: "700" },
});

const ir = StyleSheet.create({
  row:   { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  label: { fontSize: 13, color: COLORS.muted, fontWeight: "500" },
  value: { fontSize: 13, color: COLORS.text, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  mono:  { fontFamily: "monospace", fontSize: 11 },
});
