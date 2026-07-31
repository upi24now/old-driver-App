/**
 * create-pin.tsx — V3 Phase 12: Create New PIN
 *
 * Responsibility (ONE):
 *   Let the driver choose a 6-digit PIN, store it in the flow context,
 *   and navigate to Confirm PIN.
 *
 * Auto-submit: navigates immediately when the 6th digit is entered.
 * No async operations. No API calls. No session management.
 *
 * No B2 dependencies.
 */

import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { NumPad }       from "@/components/auth-v3/NumPad";
import { PinDots }      from "@/components/auth-v3/PinDots";
import { useV3Flow }    from "@/contexts/auth-v3/FlowContext";

const PIN_LENGTH = 6;
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
    router.push(`/auth-v3/confirm-pin?intent=${intent}`);
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
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
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

const C = {
  primary: "#FF6B00",
  bg:      "#FFFFFF",
  text:    "#111111",
  sub:     "#374151",
  muted:   "#6B7280",
} as const;

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { backgroundColor: C.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: C.sub, lineHeight: 20 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24 },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
