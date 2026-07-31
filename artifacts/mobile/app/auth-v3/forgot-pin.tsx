/**
 * COMPARTMENT 8 — UI Layer: Forgot PIN Screen
 *
 * Single responsibility: accept the driver's mobile number, send an OTP,
 * store the phone in FlowContext, navigate to OTP screen with intent=forgot.
 *
 * Imports only from:
 *   C2  Engine      — engineSendOtp
 *   C8  FlowContext — flow.phone, setPhone
 *   C1  Navigation  — navToOtp, navBack
 *   C10 Config      — COLORS, PHONE_DIGITS, PHONE_PREFIX
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

import { engineSendOtp }         from "@/modules/auth-v3/engine";
import { useV3Flow }             from "@/modules/auth-v3/ui/context/FlowContext";
import { navToOtp, navBack }     from "@/modules/auth-v3/navigation";
import { COLORS, PHONE_DIGITS, PHONE_PREFIX } from "@/modules/auth-v3/config";

export default function ForgotPinScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const inputRef   = useRef<TextInput>(null);
  const mountedRef = useRef(true);

  const { flow, setPhone } = useV3Flow();

  // Pre-fill from flow context if driver arrived from the PIN screen.
  const existingDigits = flow.phone.startsWith(PHONE_PREFIX)
    ? flow.phone.slice(PHONE_PREFIX.length)
    : "";
  const [digits, setDigits] = useState(existingDigits);
  const [error,  setError]  = useState("");
  const [busy,   setBusy]   = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canContinue = digits.length === PHONE_DIGITS;

  const handleContinue = async () => {
    if (!canContinue || busy) return;
    setBusy(true);
    setError("");

    const fullPhone = `${PHONE_PREFIX}${digits}`;
    const result = await engineSendOtp(fullPhone);

    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.ok) {
      setError(result.error.userMessage);
      return;
    }

    setPhone(fullPhone);
    navToOtp(router, "forgot");
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
        <Pressable style={ss.backBtn} onPress={() => navBack(router)} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Forgot PIN</Text>
        <Text style={ss.sub}>
          Enter your registered mobile number. We'll send you an OTP to reset your PIN.
        </Text>

        <Text style={ss.label}>Mobile Number</Text>
        <Pressable style={ss.phoneRow} onPress={() => inputRef.current?.focus()}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>{PHONE_PREFIX}</Text>
          </View>
          <TextInput
            ref={inputRef}
            style={ss.phoneInput}
            value={digits}
            onChangeText={(v) => {
              setError("");
              setDigits(v.replace(/\D/g, "").slice(0, PHONE_DIGITS));
            }}
            placeholder={`${PHONE_DIGITS}-digit number`}
            placeholderTextColor={COLORS.placeholder}
            keyboardType="number-pad"
            maxLength={PHONE_DIGITS}
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

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { paddingHorizontal: 24 },
  backBtn:      { marginBottom: 24 },
  backLabel:    { fontSize: 15, color: COLORS.muted },
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
  errorText:    { fontSize: 13, color: COLORS.error, marginBottom: 12 },
  primaryBtn:   {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
