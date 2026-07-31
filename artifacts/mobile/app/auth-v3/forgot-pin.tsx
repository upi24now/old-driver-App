/**
 * forgot-pin.tsx — V3 Phase 14: Forgot PIN — Phone Entry
 *
 * Responsibility (ONE):
 *   Accept the driver's mobile number, send an OTP, store the phone in
 *   the flow context, and navigate to OTP verification with intent=forgot.
 *
 * Pre-fills the phone field from the flow context if the driver arrived
 * here from the PIN screen (phone was already entered on login.tsx).
 *
 * Unmount-safe: mountedRef prevents state updates after navigation.
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

import { useV3Flow }  from "@/contexts/auth-v3/FlowContext";
import { v3SendOtp }  from "@/utils/auth-v3-api";

export default function ForgotPinScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const inputRef   = useRef<TextInput>(null);
  const mountedRef = useRef(true);

  const { flow, setPhone } = useV3Flow();

  // Pre-fill with the phone already in the flow context (from login.tsx).
  const existingDigits = flow.phone.startsWith("+91") ? flow.phone.slice(3) : "";
  const [digits, setDigits] = useState(existingDigits);
  const [error,  setError]  = useState("");
  const [busy,   setBusy]   = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canContinue = digits.length === 10;

  const handleContinue = async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    setError("");

    const fullPhone = `+91${digits}`;
    const result = await v3SendOtp(fullPhone);

    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setPhone(fullPhone);
    router.push("/auth-v3/otp?intent=forgot");
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
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={ss.backBtn} onPress={() => router.back()} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Forgot PIN</Text>
        <Text style={ss.sub}>
          Enter your registered mobile number. We'll send you an OTP to reset your PIN.
        </Text>

        <Text style={ss.label}>Mobile Number</Text>
        <Pressable style={ss.phoneRow} onPress={() => inputRef.current?.focus()}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>+91</Text>
          </View>
          <TextInput
            ref={inputRef}
            style={ss.phoneInput}
            value={digits}
            onChangeText={(v) => {
              setError("");
              setDigits(v.replace(/\D/g, "").slice(0, 10));
            }}
            placeholder="10-digit number"
            placeholderTextColor={C.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={() => void handleContinue()}
            autoFocus={!existingDigits}
          />
        </Pressable>

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (!canContinue || busy) && ss.btnDisabled]}
          onPress={() => void handleContinue()}
          disabled={!canContinue || busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Send OTP</Text>}
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
  flex:            { flex: 1 },
  bg:              { flex: 1, backgroundColor: C.bg },
  scroll:          { paddingHorizontal: 24 },
  backBtn:         { marginBottom: 24 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub:             { fontSize: 14, color: C.sub, marginBottom: 32, lineHeight: 20 },
  label:           { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 8 },
  phoneRow:        {
    flexDirection: "row", borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, overflow: "hidden", marginBottom: 24, height: 52,
  },
  prefix:          {
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F9FAFB", borderRightWidth: 1, borderRightColor: C.border,
  },
  prefixText:      { fontSize: 15, fontWeight: "600", color: C.text },
  phoneInput:      { flex: 1, paddingHorizontal: 14, fontSize: 16, color: C.text },
  errorText:       { fontSize: 13, color: C.error, marginBottom: 12 },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
