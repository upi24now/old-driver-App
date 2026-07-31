/**
 * otp.tsx — V3 Phase 11: OTP Verification
 *
 * Responsibility (ONE):
 *   Accept the 6-digit OTP, verify it, store the resulting custom-auth
 *   token in the flow context, and navigate to Create PIN.
 *
 * Receives: intent=signup|forgot (URL param)
 * Reads from flow context: phone
 * Writes to flow context: verifyToken + verifySessionId
 *
 * Auto-submit triggers immediately when the 6th digit is typed.
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useV3Flow }               from "@/contexts/auth-v3/FlowContext";
import { v3VerifyOtp, v3SendOtp }  from "@/utils/auth-v3-api";

const OTP_LENGTH = 6;
type Intent = "signup" | "forgot";

export default function OtpScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const inputRef   = useRef<TextInput>(null);
  const mountedRef = useRef(true);

  const { flow, setVerifyResult } = useV3Flow();
  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const [otp,   setOtp]   = useState("");
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const doVerify = async (code: string) => {
    if (busy || code.length !== OTP_LENGTH) return;
    setBusy(true);
    setError("");

    const result = await v3VerifyOtp(flow.phone, code);
    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      setOtp("");
      return;
    }

    setVerifyResult(result.token, result.sessionId);
    router.push(`/auth-v3/create-pin?intent=${intent}`);
  };

  const onChangeOtp = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setError("");
    setOtp(digits);
    if (digits.length === OTP_LENGTH) void doVerify(digits);
  };

  const handleResend = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    setOtp("");
    const result = await v3SendOtp(flow.phone);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!result.ok) setError(result.error);
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

        <Text style={ss.heading}>Enter OTP</Text>
        <Text style={ss.sub}>
          We sent a 6-digit code to{"\n"}
          <Text style={ss.phoneBold}>{flow.phone}</Text>
        </Text>

        {/* Hidden real input + visible box overlay */}
        <Pressable style={ss.otpWrap} onPress={() => inputRef.current?.focus()}>
          <TextInput
            ref={inputRef}
            style={ss.otpHidden}
            value={otp}
            onChangeText={onChangeOtp}
            keyboardType="number-pad"
            maxLength={OTP_LENGTH}
            editable={!busy}
            autoFocus
          />
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
          onPress={() => void doVerify(otp)}
          disabled={busy || otp.length !== OTP_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Verify OTP</Text>}
        </Pressable>

        <View style={ss.resendRow}>
          <Text style={ss.resendLabel}>Didn't receive it? </Text>
          <Pressable onPress={() => void handleResend()} disabled={busy}>
            <Text style={[ss.resendLink, busy && { opacity: 0.4 }]}>Resend</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const C = {
  primary: "#FF6B00",
  bg:      "#FFFFFF",
  text:    "#111111",
  sub:     "#374151",
  muted:   "#6B7280",
  border:  "#E5E7EB",
  error:   "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { flex: 1, backgroundColor: C.bg },
  scroll:          { paddingHorizontal: 24 },
  backBtn:         { marginBottom: 24 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub:             { fontSize: 14, color: C.sub, marginBottom: 32, lineHeight: 22 },
  phoneBold:       { fontWeight: "700", color: C.text },
  otpWrap:         { marginBottom: 24 },
  otpHidden:       { position: "absolute", opacity: 0, width: "100%", height: 56 },
  boxRow:          { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box:             {
    flex: 1, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#F9FAFB",
  },
  boxFilled:       { borderColor: C.primary, backgroundColor: "#FFF3EC" },
  boxDigit:        { fontSize: 22, fontWeight: "700", color: C.text },
  errorText:       { color: C.error, fontSize: 13, marginBottom: 12 },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
  resendRow:       { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  resendLabel:     { fontSize: 14, color: C.muted },
  resendLink:      { fontSize: 14, color: C.primary, fontWeight: "600" },
});
