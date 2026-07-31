/**
 * COMPARTMENT 8 — UI Layer: Welcome Screen
 *
 * Single responsibility: check for a valid session on mount; navigate home if
 * found, otherwise present Login and Create Account entry points.
 *
 * Imports only from:
 *   C2  Engine      — session restore
 *   C1  Navigation  — route actions
 *   C10 Config      — colours
 *
 * No direct API, Firebase, or storage imports.
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

import { engineRestoreSession } from "@/modules/auth-v3/engine";
import { navToHome, navToLogin, navToSignupForm } from "@/modules/auth-v3/navigation";
import { COLORS } from "@/modules/auth-v3/config";

export default function WelcomeScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const mountedRef = useRef(true);

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    mountedRef.current = true;

    async function restore() {
      const session = await engineRestoreSession();
      if (!mountedRef.current) return;
      setChecking(false);
      if (session) navToHome(router);
    }

    void restore();
    return () => { mountedRef.current = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <View style={[ss.flex, ss.center, ss.bg]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View
      style={[
        ss.flex, ss.bg,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) },
      ]}
    >
      {/* Hero */}
      <View style={ss.hero}>
        <View style={ss.logoRing}>
          <View style={ss.logoDot} />
        </View>
        <Text style={ss.appName}>Bike Courier</Text>
        <Text style={ss.tagline}>Deliver Smarter. Earn More.</Text>
      </View>

      {/* Actions */}
      <View style={[ss.actions, { paddingHorizontal: 24 }]}>
        <Pressable
          style={({ pressed }) => [ss.primaryBtn, pressed && ss.primaryBtnActive]}
          onPress={() => navToLogin(router)}
          accessibilityRole="button"
          accessibilityLabel="Login to existing account"
        >
          <Text style={ss.primaryBtnLabel}>Login</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [ss.outlineBtn, pressed && ss.outlineBtnActive]}
          onPress={() => navToSignupForm(router)}
          accessibilityRole="button"
          accessibilityLabel="Create a new driver account"
        >
          <Text style={ss.outlineBtnLabel}>Create Account</Text>
        </Pressable>

        <Text style={ss.legal}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  flex:             { flex: 1 },
  bg:               { backgroundColor: COLORS.bg },
  center:           { alignItems: "center", justifyContent: "center" },

  hero:             { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  logoRing:         {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: COLORS.primary + "22",
    alignItems: "center", justifyContent: "center", marginBottom: 24,
  },
  logoDot:          { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.primary },
  appName:          { fontSize: 32, fontWeight: "800", color: COLORS.text, marginBottom: 8 },
  tagline:          { fontSize: 16, color: COLORS.muted, textAlign: "center" },

  actions:          { gap: 12, paddingBottom: 8 },
  primaryBtn:       {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnActive: { backgroundColor: COLORS.primaryPress },
  primaryBtnLabel:  { color: "#fff", fontSize: 17, fontWeight: "700" },
  outlineBtn:       {
    borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnActive: { backgroundColor: COLORS.tint },
  outlineBtnLabel:  { color: COLORS.primary, fontSize: 17, fontWeight: "600" },
  legal:            { textAlign: "center", fontSize: 12, color: COLORS.muted, lineHeight: 18, marginTop: 4 },
});
