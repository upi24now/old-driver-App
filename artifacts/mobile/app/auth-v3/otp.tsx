/**
 * COMPARTMENT 8 — UI Layer: OTP Screen
 *
 * Single responsibility: verify the OTP, store result in FlowContext,
 * navigate to Create PIN.
 *
 * Imports only from:
 *   C2  Engine      — engineVerifyOtp, engineSendOtp
 *   C8  FlowContext — flow.phone, setVerifyResult
 *   C1  Navigation  — navToCreatePin, navBack
 *   C10 Config      — OTP_LENGTH, COLORS
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

import { engineVerifyOtp, engineSendOtp } from "@/modules/auth-v3/engine";
import { useV3Flow }                       from "@/modules/auth-v3/ui";
import { navToCreatePin, navBack }         from "@/modules/auth-v3/navigation";
import { COLORS, OTP_LENGTH }              from "@/modules/auth-v3/config";

type Intent = "signup" | "forgot";

export default function OtpScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const inputRef   = useRef<TextInput>(null);
  const mountedRef = useRef(true);

  const { flow, setVerifyResult } = useV3Flow();
  const params  = useLocalSearchParams<{ intent?: string }>();
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

    const result = await engineVerifyOtp(flow.phone, code);
    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.success) {
      setError(result.error.userMessage);
      setOtp("");
      return;
    }

    setVerifyResult(result.data.token, result.data.sessionId);
    navToCreatePin(router, intent);
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
    const result = await engineSendOtp(flow.phone);
    if (!mountedRef.current) return;
    setBusy(false);
    if (!result.success) setError(result.error.userMessage);
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

const ss = StyleSheet.create({
  flex:         { flex: 1 },
  bg:           { flex: 1, backgroundColor: COLORS.bg },
  scroll:       { paddingHorizontal: 24 },
  backBtn:      { marginBottom: 24 },
  backLabel:    { fontSize: 15, color: COLORS.muted },
  heading:      { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 8 },
  sub:          { fontSize: 14, color: COLORS.sub, marginBottom: 32, lineHeight: 22 },
  phoneBold:    { fontWeight: "700", color: COLORS.text },
  otpWrap:      { marginBottom: 24 },
  otpHidden:    { position: "absolute", opacity: 0, width: "100%", height: 56 },
  boxRow:       { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box:          {
    flex: 1, height: 56, borderRadius: 12,
    borderWidth: 1.5, borderColor: COLORS.border,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.inputBg,
  },
  boxFilled:    { borderColor: COLORS.primary, backgroundColor: COLORS.tint },
  boxDigit:     { fontSize: 22, fontWeight: "700", color: COLORS.text },
  errorText:    { color: COLORS.error, fontSize: 13, marginBottom: 12 },
  primaryBtn:   {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
  resendRow:    { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  resendLabel:  { fontSize: 14, color: COLORS.muted },
  resendLink:   { fontSize: 14, color: COLORS.primary, fontWeight: "600" },
});
