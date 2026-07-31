/**
 * create-pin.tsx — V3 Phase 8: Create New PIN
 *
 * Responsibility (ONE):
 *   Let the driver choose a new 6-digit PIN and navigate to Confirm PIN.
 *
 * Receives: intent=signup|forgot (URL param)
 * Writes to store: createdPin
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

import { NumPad }    from "@/components/auth-v3/NumPad";
import { PinDots }   from "@/components/auth-v3/PinDots";
import { v3Store }   from "@/utils/auth-v3-store";

const PIN_LENGTH = 6;
type Intent = "signup" | "forgot";

export default function CreatePinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const [pin,   setPin]   = useState("");
  const [error, setError] = useState("");

  const onDigit = (d: string) => {
    if (pin.length >= PIN_LENGTH) return;
    setError("");
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => proceed(next), 80);
    }
  };

  const onDelete = () => {
    setError("");
    setPin((p) => p.slice(0, -1));
  };

  const proceed = (completedPin: string) => {
    if (completedPin.length !== PIN_LENGTH) return;
    v3Store.setCreatedPin(completedPin);
    router.push(`/auth-v3/confirm-pin?intent=${intent}`);
  };

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Create PIN</Text>
        <Text style={ss.sub}>Choose a 6-digit PIN to secure your account.</Text>
      </View>

      {/* PIN dots */}
      <PinDots length={PIN_LENGTH} filled={pin.length} error={!!error} />

      {!!error && <Text style={ss.errorText}>{error}</Text>}

      {/* Numpad */}
      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={pin.length >= PIN_LENGTH}
        />
      </View>

      {/* Next button */}
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
  error:   "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:           { flex: 1 },
  bg:             { backgroundColor: C.bg },
  header:         { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:        { marginBottom: 20 },
  backLabel:      { fontSize: 15, color: C.muted },
  heading:        { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 4 },
  sub:            { fontSize: 14, color: C.sub, lineHeight: 20 },
  errorText:      { textAlign: "center", color: C.error, fontSize: 13, marginTop: -8 },
  padWrap:        { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:         { paddingHorizontal: 24 },
  primaryBtn:     {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:    { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
