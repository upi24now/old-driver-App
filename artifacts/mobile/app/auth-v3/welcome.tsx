/**
 * welcome.tsx — V3 Phase 3: Welcome / Entry Screen
 *
 * Responsibilities (ONE):
 *   Check for an existing V3 session. If valid → skip to home.
 *   Otherwise show the Welcome screen with Login + Create Account actions.
 *
 * No B2 dependencies.
 */

import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { checkV3Session } from "@/utils/auth-v3-session";
import { v3Store } from "@/utils/auth-v3-store";

export default function WelcomeScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const [checking, setChecking] = useState(true);

  // ── Phase 11: Session Restore ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    checkV3Session().then((session) => {
      if (cancelled) return;
      setChecking(false);
      if (session) {
        // Valid session found — go directly to home
        router.replace("/auth-v3/home");
      }
    });
    return () => { cancelled = true; };
  }, []);

  if (checking) {
    return (
      <View style={[ss.flex, ss.center, ss.bg]}>
        <ActivityIndicator size="large" color={C.primary} />
      </View>
    );
  }

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Hero */}
      <View style={ss.heroSection}>
        <View style={ss.logoMark}>
          <View style={ss.logoCircle} />
          <View style={ss.logoDot} />
        </View>
        <Text style={ss.appName}>Bike Courier</Text>
        <Text style={ss.tagline}>Deliver Smarter. Earn More.</Text>
      </View>

      {/* Actions */}
      <View style={[ss.actionsSection, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={({ pressed }) => [ss.primaryBtn, pressed && ss.primaryBtnPressed]}
          onPress={() => {
            v3Store.clear();
            router.push("/auth-v3/login");
          }}
          accessibilityRole="button"
          accessibilityLabel="Login to your account"
        >
          <Text style={ss.primaryBtnLabel}>Login</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [ss.outlineBtn, pressed && ss.outlineBtnPressed]}
          onPress={() => {
            v3Store.clear();
            router.push("/auth-v3/signup-form");
          }}
          accessibilityRole="button"
          accessibilityLabel="Create a new driver account"
        >
          <Text style={ss.outlineBtnLabel}>Create Account</Text>
        </Pressable>

        <Text style={ss.legalNote}>
          By continuing you agree to our Terms of Service and Privacy Policy.
        </Text>
      </View>
    </View>
  );
}

const C = {
  primary:  "#FF6B00",
  pressed:  "#E55A00",
  bg:       "#FFFFFF",
  text:     "#111111",
  muted:    "#6B7280",
  border:   "#E5E7EB",
} as const;

const ss = StyleSheet.create({
  flex:               { flex: 1 },
  bg:                 { backgroundColor: C.bg },
  center:             { alignItems: "center", justifyContent: "center" },

  heroSection:        {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logoMark:           { position: "relative", marginBottom: 24 },
  logoCircle:         {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: C.primary, opacity: 0.15,
  },
  logoDot:            {
    position: "absolute", width: 40, height: 40, borderRadius: 20,
    backgroundColor: C.primary,
    top: 20, left: 20,
  },
  appName:            { fontSize: 32, fontWeight: "800", color: C.text, marginBottom: 8 },
  tagline:            { fontSize: 16, color: C.muted, textAlign: "center" },

  actionsSection:     { paddingHorizontal: 24, gap: 12 },
  primaryBtn:         {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  primaryBtnPressed:  { backgroundColor: C.pressed },
  primaryBtnLabel:    { color: "#fff", fontSize: 17, fontWeight: "700" },
  outlineBtn:         {
    borderWidth: 1.5, borderColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnPressed:  { backgroundColor: "#FFF3EC" },
  outlineBtnLabel:    { color: C.primary, fontSize: 17, fontWeight: "600" },

  legalNote:          {
    textAlign: "center", fontSize: 12, color: C.muted,
    marginTop: 8, lineHeight: 18,
  },
});
