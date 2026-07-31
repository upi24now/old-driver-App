/**
 * COMPARTMENT 8 — UI Layer: Login Screen
 *
 * Single responsibility: collect the driver's phone number, store it in
 * FlowContext, and navigate to the PIN screen.
 *
 * Imports only from:
 *   C8  FlowContext — setPhone
 *   C1  Navigation  — navToPin, navBack
 *   C10 Config      — colours, PHONE_DIGITS
 *
 * No async operations. No auth logic. No API calls.
 */

import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useV3Flow }        from "@/modules/auth-v3/ui";
import { navToPin, navBack } from "@/modules/auth-v3/navigation";
import { COLORS, PHONE_DIGITS, PHONE_PREFIX } from "@/modules/auth-v3/config";

export default function LoginScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { setPhone } = useV3Flow();
  const inputRef   = useRef<TextInput>(null);

  const [digits, setDigits] = useState("");

  const canContinue = digits.length === PHONE_DIGITS;

  const handleContinue = () => {
    if (!canContinue) return;
    setPhone(`${PHONE_PREFIX}${digits}`);
    navToPin(router);
  };

  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={ss.bg}
        contentContainerStyle={[
          ss.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={ss.backBtn} onPress={() => navBack(router)}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <View style={ss.brandRow}>
          <View style={ss.brandDot} />
          <Text style={ss.brandText}>Bike Courier</Text>
        </View>

        <Text style={ss.heading}>Welcome back</Text>
        <Text style={ss.sub}>Enter your registered mobile number to continue.</Text>

        <Text style={ss.label}>Mobile Number</Text>
        <Pressable style={ss.phoneRow} onPress={() => inputRef.current?.focus()}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>{PHONE_PREFIX}</Text>
          </View>
          <TextInput
            ref={inputRef}
            style={ss.phoneInput}
            value={digits}
            onChangeText={(v) => setDigits(v.replace(/\D/g, "").slice(0, PHONE_DIGITS))}
            placeholder={`${PHONE_DIGITS}-digit number`}
            placeholderTextColor={COLORS.placeholder}
            keyboardType="number-pad"
            maxLength={PHONE_DIGITS}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            autoFocus
          />
        </Pressable>

        <Pressable
          style={[ss.primaryBtn, !canContinue && ss.btnDisabled]}
          onPress={handleContinue}
          disabled={!canContinue}
        >
          <Text style={ss.primaryBtnLabel}>Continue</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { paddingHorizontal: 24 },
  backBtn:      { marginBottom: 24 },
  backLabel:    { fontSize: 15, color: COLORS.muted },
  brandRow:     { flexDirection: "row", alignItems: "center", marginBottom: 28 },
  brandDot:     { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary, marginRight: 8 },
  brandText:    { fontSize: 14, fontWeight: "600", color: COLORS.text },
  heading:      { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 8 },
  sub:          { fontSize: 14, color: COLORS.sub, marginBottom: 32, lineHeight: 20 },
  label:        { fontSize: 13, fontWeight: "600", color: COLORS.text, marginBottom: 8 },
  phoneRow:     {
    flexDirection: "row", borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 12, overflow: "hidden", marginBottom: 24, height: 52,
  },
  prefix:       {
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.inputBg, borderRightWidth: 1, borderRightColor: COLORS.border,
  },
  prefixText:   { fontSize: 15, fontWeight: "600", color: COLORS.text },
  phoneInput:   { flex: 1, paddingHorizontal: 14, fontSize: 16, color: COLORS.text },
  primaryBtn:   {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:  { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
