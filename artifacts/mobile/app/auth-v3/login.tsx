/**
 * login.tsx — V3 Phase 4: Login Screen (Mobile Number Entry)
 *
 * Responsibility (ONE):
 *   Collect the driver's 10-digit mobile number and navigate to the PIN screen.
 *
 * No B2 dependencies.
 */

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { v3Store } from "@/utils/auth-v3-store";

export default function LoginScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [phone, setPhone]   = useState("");
  const [error, setError]   = useState("");

  const canContinue = phone.length === 10;

  const handleContinue = () => {
    if (!canContinue) return;
    setError("");
    v3Store.setPhone(`+91${phone}`);
    router.push("/auth-v3/pin");
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
        {/* Back */}
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        {/* Brand mark */}
        <View style={ss.brandRow}>
          <View style={ss.brandDot} />
          <Text style={ss.brandText}>Bike Courier</Text>
        </View>

        <Text style={ss.heading}>Welcome back</Text>
        <Text style={ss.sub}>Enter your registered mobile number to continue.</Text>

        {/* Phone field */}
        <Text style={ss.fieldLabel}>Mobile Number</Text>
        <Pressable style={ss.phoneRow} onPress={() => inputRef.current?.focus()}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>+91</Text>
          </View>
          <TextInput
            ref={inputRef}
            style={ss.phoneInput}
            value={phone}
            onChangeText={(v) => {
              setError("");
              setPhone(v.replace(/\D/g, "").slice(0, 10));
            }}
            placeholder="10-digit number"
            placeholderTextColor={C.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            autoFocus
          />
        </Pressable>

        {!!error && <Text style={ss.errorText}>{error}</Text>}

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

const C = {
  primary:     "#FF6B00",
  bg:          "#FFFFFF",
  text:        "#111111",
  sub:         "#374151",
  muted:       "#6B7280",
  placeholder: "#9CA3AF",
  border:      "#E5E7EB",
  error:       "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { flex: 1, backgroundColor: C.bg },
  scroll:       { paddingHorizontal: 24 },

  backBtn:      { marginBottom: 24 },
  backLabel:    { fontSize: 15, color: C.muted },

  brandRow:     { flexDirection: "row", alignItems: "center", marginBottom: 28 },
  brandDot:     {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: C.primary, marginRight: 8,
  },
  brandText:    { fontSize: 14, fontWeight: "600", color: C.text },

  heading:      { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub:          { fontSize: 14, color: C.sub, marginBottom: 32, lineHeight: 20 },

  fieldLabel:   { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 8 },
  phoneRow:     {
    flexDirection: "row",
    borderWidth: 1.5,
    borderColor: C.border,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 24,
    height: 52,
  },
  prefix:       {
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F9FAFB",
    borderRightWidth: 1,
    borderRightColor: C.border,
  },
  prefixText:   { fontSize: 15, fontWeight: "600", color: C.text },
  phoneInput:   { flex: 1, paddingHorizontal: 14, fontSize: 16, color: C.text },

  errorText:    { fontSize: 13, color: C.error, marginBottom: 12 },

  primaryBtn:   {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 4,
  },
  btnDisabled:  { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
