/**
 * otp.tsx — V3 Phase 7: OTP Verification Screen
 *
 * Responsibility (ONE):
 *   Accept the 6-digit OTP, verify it with the backend, store the resulting
 *   custom-auth token, and navigate to the Create PIN screen.
 *
 * Receives: intent=signup|forgot (URL param)
 * Reads from store: phone
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { v3Store }    from "@/utils/auth-v3-store";
import { v3VerifyOtp, v3SendOtp } from "@/utils/auth-v3-api";

const OTP_LENGTH = 6;
type Intent = "signup" | "forgot";

export default function OtpScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const phone = v3Store.get().phone;

  const [otp,   setOtp]   = useState("");
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  const handleVerify = async (code: string) => {
    if (busy || code.length !== OTP_LENGTH) return;
    setBusy(true);
    setError("");

    const result = await v3VerifyOtp(phone, code);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setOtp("");
      return;
    }

    v3Store.setVerifyToken(result.token, result.sessionId);
    router.push(`/auth-v3/create-pin?intent=${intent}`);
  };

  const handleResend = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setOtp("");
    const result = await v3SendOtp(phone);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    v3Store.setOtpId(result.otpId);
  };

  const onChangeOtp = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setError("");
    setOtp(digits);
    if (digits.length === OTP_LENGTH) {
      setTimeout(() => handleVerify(digits), 80);
    }
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
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Enter OTP</Text>
        <Text style={ss.sub}>
          We sent a 6-digit code to{"\n"}
          <Text style={ss.phoneHighlight}>{phone}</Text>
        </Text>

        {/* OTP input */}
        <Pressable style={ss.otpInputWrap} onPress={() => inputRef.current?.focus()}>
          <TextInput
            ref={inputRef}
            style={ss.otpInput}
            value={otp}
            onChangeText={onChangeOtp}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            editable={!busy}
            autoFocus
          />
          {/* Visual OTP boxes */}
          <View style={ss.boxRow} pointerEvents="none">
            {Array.from({ length: OTP_LENGTH }).map((_, i) => (
              <View key={i} style={[ss.box, otp[i] != null && ss.boxFilled]}>
                <Text style={ss.boxDigit}>{otp[i] ?? ""}</Text>
              </View>
            ))}
          </View>
        </Pressable>

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (busy || otp.length !== OTP_LENGTH) && ss.btnDisabled]}
          onPress={() => handleVerify(otp)}
          disabled={busy || otp.length !== OTP_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Verify OTP</Text>}
        </Pressable>

        <View style={ss.resendRow}>
          <Text style={ss.resendLabel}>Didn't receive the code? </Text>
          <Pressable onPress={handleResend} disabled={busy}>
            <Text style={[ss.resendLink, busy && { opacity: 0.4 }]}>Resend</Text>
          </Pressable>
        </View>
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
  border:      "#E5E7EB",
  error:       "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:           { flex: 1 },
  bg:             { flex: 1, backgroundColor: C.bg },
  scroll:         { paddingHorizontal: 24 },
  backBtn:        { marginBottom: 24 },
  backLabel:      { fontSize: 15, color: C.muted },
  heading:        { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub:            { fontSize: 14, color: C.sub, marginBottom: 32, lineHeight: 22 },
  phoneHighlight: { fontWeight: "700", color: C.text },

  // OTP input (hidden real input + visible boxes overlay)
  otpInputWrap: { marginBottom: 24 },
  otpInput:     { position: "absolute", opacity: 0, width: "100%", height: 56 },
  boxRow:       { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box:          {
    flex: 1, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F9FAFB",
  },
  boxFilled:    { borderColor: C.primary, backgroundColor: "#FFF3EC" },
  boxDigit:     { fontSize: 22, fontWeight: "700", color: C.text },

  errorText:      { color: C.error, fontSize: 13, marginBottom: 12 },
  primaryBtn:     {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:    { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },

  resendRow:   { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  resendLabel: { fontSize: 14, color: C.muted },
  resendLink:  { fontSize: 14, color: C.primary, fontWeight: "600" },
});
