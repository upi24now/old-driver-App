/**
 * welcome.tsx — V3 Phase 7: Welcome Screen
 *
 * Responsibility (ONE):
 *   Check for a valid V3 session on mount. If found, skip to home.
 *   Otherwise present Login and Create Account entry points.
 *
 * Session restore uses firebaseAuth.authStateReady() to avoid the Firebase
 * cold-start timing race where currentUser is null immediately after an
 * app kill even when a valid session exists.
 *
 * Unmount-safe: async effects are cancelled if the component unmounts before
 * they complete.
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

import { checkV3Session } from "@/utils/auth-v3-session";

export default function WelcomeScreen() {
  const router    = useRouter();
  const insets    = useSafeAreaInsets();
  const mountedRef = useRef(true);

  const [checking, setChecking] = useState(true);

  useEffect(() => {
    mountedRef.current = true;

    async function restore() {
      const session = await checkV3Session();
      if (!mountedRef.current) return; // unmounted before async completed

      setChecking(false);
      if (session) {
        router.replace("/auth-v3/home");
      }
    }

    void restore();

    return () => {
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (checking) {
    return (
      <View style={[ss.flex, ss.center, ss.bg]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <View
      style={[
        ss.flex,
        ss.bg,
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
          onPress={() => router.push("/auth-v3/login")}
          accessibilityRole="button"
          accessibilityLabel="Login to existing account"
        >
          <Text style={ss.primaryBtnLabel}>Login</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [ss.outlineBtn, pressed && ss.outlineBtnActive]}
          onPress={() => router.push("/auth-v3/signup-form")}
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

const C = {
  primary: "#FF6B00",
  pressed: "#E55A00",
  bg:      "#FFFFFF",
  text:    "#111111",
  muted:   "#6B7280",
} as const;

const ss = StyleSheet.create({
  flex:             { flex: 1 },
  bg:               { backgroundColor: C.bg },
  center:           { alignItems: "center", justifyContent: "center" },

  hero:             { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  logoRing:         {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: C.primary + "22",
    alignItems: "center", justifyContent: "center",
    marginBottom: 24,
  },
  logoDot:          { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary },
  appName:          { fontSize: 32, fontWeight: "800", color: C.text, marginBottom: 8 },
  tagline:          { fontSize: 16, color: C.muted, textAlign: "center" },

  actions:          { gap: 12, paddingBottom: 8 },
  primaryBtn:       {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnActive: { backgroundColor: C.pressed },
  primaryBtnLabel:  { color: "#fff", fontSize: 17, fontWeight: "700" },
  outlineBtn:       {
    borderWidth: 1.5, borderColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnActive: { backgroundColor: "#FFF3EC" },
  outlineBtnLabel:  { color: C.primary, fontSize: 17, fontWeight: "600" },
  legal:            { textAlign: "center", fontSize: 12, color: C.muted, lineHeight: 18, marginTop: 4 },
});
