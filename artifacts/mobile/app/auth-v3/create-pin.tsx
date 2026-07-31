/**
 * COMPARTMENT 8 — UI Layer: Create PIN Screen
 *
 * Single responsibility: let the driver choose a 6-digit PIN, store it in
 * FlowContext, and navigate to Confirm PIN.
 *
 * No async operations. No auth logic. No API calls.
 *
 * Imports only from:
 *   C8  FlowContext — setCreatedPin
 *   C8  NumPad, PinDots
 *   C1  Navigation  — navToConfirmPin, navBack
 *   C10 Config      — PIN_LENGTH, COLORS
 */

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useV3Flow, NumPad, PinDots } from "@/modules/auth-v3/ui";
import { navToConfirmPin, navBack } from "@/modules/auth-v3/navigation";
import { COLORS, PIN_LENGTH }   from "@/modules/auth-v3/config";

type Intent = "signup" | "forgot";

export default function CreatePinScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { setCreatedPin } = useV3Flow();

  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const [pin, setPin] = useState("");

  const proceed = (completedPin: string) => {
    setCreatedPin(completedPin);
    navToConfirmPin(router, intent);
  };

  const onDigit = (d: string) => {
    if (pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) proceed(next);
  };

  const onDelete = () => setPin((p) => p.slice(0, -1));

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => navBack(router)}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Create PIN</Text>
        <Text style={ss.sub}>Choose a 6-digit PIN to secure your account.</Text>
      </View>

      <PinDots length={PIN_LENGTH} filled={pin.length} />

      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={pin.length >= PIN_LENGTH}
        />
      </View>

      <View style={[ss.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={[ss.primaryBtn, pin.length !== PIN_LENGTH && ss.btnDisabled]}
          onPress={() => proceed(pin)}
          disabled={pin.length !== PIN_LENGTH}
        >
          <Text style={ss.primaryBtnLabel}>Next</Text>
        </Pressable>
      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { backgroundColor: COLORS.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: COLORS.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: COLORS.sub, lineHeight: 20 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24 },
  primaryBtn:      {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
