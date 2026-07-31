/**
 * login-v3.tsx — V3 Login Screen
 *
 * Enter 10-digit mobile number → sendOtp → /verify-otp-v3?phone=+91XXXXXXXXXX
 *
 * Authentication V3: uses auth-api.ts sendOtp directly (no AuthV2Store).
 * Phone is passed to the next screen via URL search param.
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

import { sendOtp } from "@/utils/auth-api";

// ── Design tokens ─────────────────────────────────────────────────────────────
const D = {
  bg:      "#FFFFFF",
  primary: "#FF6A00",
  soft:    "#FFF3EC",
  text:    "#172033",
  sub:     "#6B7280",
  muted:   "#9CA3AF",
  border:  "#E5E7EB",
  error:   "#DC2626",
} as const;

// ── Screen ────────────────────────────────────────────────────────────────────
export default function LoginV3() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phoneDigits, setPhoneDigits] = useState("");
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState("");

  async function handleSendOtp() {
    if (busy || phoneDigits.length !== 10) return;
    Keyboard.dismiss();
    setError("");
    setBusy(true);

    const phone = `+91${phoneDigits}`;
    console.log("[V3_LOGIN] sendOtp — phone:", phone.slice(0, 6) + "…");

    const result = await sendOtp(phone);
    setBusy(false);

    if (!result.ok) {
      console.log("[V3_LOGIN] sendOtp failed:", result.error);
      setError(result.error);
      return;
    }

    console.log("[V3_LOGIN] OTP sent → /verify-otp-v3 phone =", phone.slice(0, 6) + "…");
    // Pass phone as a URL-encoded search param so verify-otp-v3 can read it
    // without relying on module-level state that could be stale across reloads.
    router.push((`/verify-otp-v3?phone=${encodeURIComponent(phone)}`) as never);
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

          <Text style={ss.title}>Welcome Back</Text>
          <Text style={ss.sub}>Enter your registered mobile number</Text>

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
              : <Text style={ss.btnText}>Continue</Text>
            }
          </Pressable>

          {/* ── Terms & Privacy ── */}
          <View style={ss.termsRow}>
            <Text style={ss.termsText}>By continuing, you agree to our </Text>
            <Pressable hitSlop={6} onPress={() => router.push("/terms-and-conditions" as never)}>
              <Text style={ss.termsLink}>Terms</Text>
            </Pressable>
            <Text style={ss.termsText}> & </Text>
            <Pressable hitSlop={6} onPress={() => router.push("/privacy-policy" as never)}>
              <Text style={ss.termsLink}>Privacy Policy</Text>
            </Pressable>
          </View>

        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  flex:        { flex: 1, backgroundColor: D.bg },
  root:        { flexGrow: 1 },
  content:     { paddingHorizontal: 24 },
  title:       { fontSize: 28, fontWeight: "700", color: D.text, marginBottom: 6 },
  sub:         { fontSize: 15, color: D.sub, marginBottom: 28 },

  // Phone input
  inputRow:    { flexDirection: "row", borderWidth: 1.5, borderColor: D.border, borderRadius: 12, overflow: "hidden", height: 56, marginBottom: 12 },
  prefix:      { width: 56, alignItems: "center", justifyContent: "center", borderRightWidth: 1, borderRightColor: D.border, backgroundColor: "#F9FAFB" },
  prefixText:  { fontSize: 15, fontWeight: "600", color: D.text },
  phoneInput:  { flex: 1, fontSize: 16, color: D.text, paddingHorizontal: 14 },

  // Primary button
  btn:         { height: 54, borderRadius: 12, backgroundColor: D.primary, alignItems: "center", justifyContent: "center", marginTop: 16 },
  btnOff:      { opacity: 0.45 },
  btnText:     { color: "#fff", fontSize: 17, fontWeight: "700" },

  // Errors
  errText:     { color: D.error, fontSize: 14, marginBottom: 8, textAlign: "center" },

  // Terms & Privacy
  termsRow:    { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", marginTop: 20, gap: 1 },
  termsText:   { fontSize: 12, color: D.sub },
  termsLink:   { fontSize: 12, fontWeight: "700", color: D.primary },
});
