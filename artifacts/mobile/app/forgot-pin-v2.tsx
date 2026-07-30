/**
 * forgot-pin-v2.tsx — V2 Forgot PIN Screen
 *
 * Enter mobile number → send OTP → /verify-otp-v2?intent=forgot
 * Back → /login-v2
 *
 * [V2_FORGOT_PIN] logs only. No authentication logic changes.
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { sendOtpV2 } from "@/utils/auth-v2-api";
import { AuthV2Store } from "@/utils/auth-v2-store";

const D = {
  bg:      "#FFFFFF",
  primary: "#FF6A00",
  text:    "#172033",
  sub:     "#6B7280",
  muted:   "#9CA3AF",
  border:  "#E5E7EB",
  error:   "#DC2626",
} as const;

export default function ForgotPinV2() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phoneDigits, setPhoneDigits] = useState(
    AuthV2Store.getPhone().replace(/^\+91/, ""),
  );
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState("");

  async function handleSendOtp() {
    if (busy || phoneDigits.length !== 10) return;
    Keyboard.dismiss();
    setError("");
    setBusy(true);
    console.log("[V2_FORGOT_PIN] sendOtp — digits:", phoneDigits.length);

    const phone = `+91${phoneDigits}`;
    AuthV2Store.setPhone(phone);

    const result = await sendOtpV2(phone);
    setBusy(false);

    if (!result.ok) {
      console.log("[V2_FORGOT_PIN] sendOtp failed:", result.error);
      setError(result.error);
      return;
    }
    AuthV2Store.setOtpId(result.otpId);
    console.log("[V2_FORGOT_PIN] OTP sent → verify-otp-v2?intent=forgot");
    router.push("/verify-otp-v2?intent=forgot" as never);
  }

  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={ss.flex}
        contentContainerStyle={[
          ss.root,
          { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={ss.content}>

          <Pressable style={ss.backBtn} onPress={() => router.back()}>
            <Text style={ss.backText}>← Back</Text>
          </Pressable>

          <Text style={ss.title}>Reset Your PIN</Text>
          <Text style={ss.sub}>
            Enter your registered number. We'll send an OTP to verify your identity.
          </Text>

          <View style={ss.inputRow}>
            <View style={ss.prefix}>
              <Text style={ss.prefixText}>+91</Text>
            </View>
            <TextInput
              value={phoneDigits}
              onChangeText={(v) => {
                setError("");
                setPhoneDigits(v.replace(/\D/g, "").slice(0, 10));
              }}
              placeholder="10-digit number"
              placeholderTextColor={D.muted}
              keyboardType="number-pad"
              maxLength={10}
              style={ss.phoneInput}
              autoFocus
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={handleSendOtp}
            />
          </View>

          {!!error && <Text style={ss.errText}>{error}</Text>}

          <Pressable
            style={[ss.btn, (busy || phoneDigits.length !== 10) && ss.btnOff]}
            onPress={handleSendOtp}
            disabled={busy || phoneDigits.length !== 10}
          >
            {busy
              ? <ActivityIndicator color="#fff" />
              : <Text style={ss.btnText}>Send OTP</Text>
            }
          </Pressable>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  flex:       { flex: 1, backgroundColor: D.bg },
  root:       { flexGrow: 1 },
  content:    { paddingHorizontal: 24 },
  backBtn:    { marginBottom: 24, alignSelf: "flex-start" },
  backText:   { color: D.sub, fontSize: 15 },
  title:      { fontSize: 26, fontWeight: "700", color: D.text, marginBottom: 8 },
  sub:        { fontSize: 15, color: D.sub, marginBottom: 28, lineHeight: 22 },
  inputRow:   { flexDirection: "row", borderWidth: 1.5, borderColor: D.border, borderRadius: 12, overflow: "hidden", height: 56, marginBottom: 12 },
  prefix:     { width: 56, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: D.border, backgroundColor: "#F9FAFB" },
  prefixText: { fontSize: 15, fontWeight: "600", color: D.text },
  phoneInput: { flex: 1, fontSize: 16, color: D.text, paddingHorizontal: 14 },
  btn:        { height: 54, borderRadius: 12, backgroundColor: D.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnOff:     { opacity: 0.45 },
  btnText:    { color: "#fff", fontSize: 17, fontWeight: "700" },
  errText:    { color: D.error, fontSize: 14, marginBottom: 8, textAlign: "center" },
});
