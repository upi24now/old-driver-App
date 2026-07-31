/**
 * verify-otp-v3.tsx — V3 OTP Verification Screen
 *
 * Reads ?phone=+91XXXXXXXXXX from URL params.
 * Intent is always "login" (PIN bypass — full session established from OTP).
 *
 * Flow:
 *   verifyOtpApi(phone, otp) → { token, sessionId }
 *   confirmOtpV2Direct(token, phone, sessionId) → { ok, nextRoute }
 *   router.replace(nextRoute)
 */

import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";

import { sendOtp, verifyOtpApi } from "@/utils/auth-api";
import { useDriver } from "@/contexts/DriverContext";
import { AuthV2Store } from "@/utils/auth-v2-store";

const D = {
  bg:      "#FFFFFF",
  primary: "#FF6A00",
  text:    "#172033",
  sub:     "#6B7280",
  muted:   "#9CA3AF",
  border:  "#E5E7EB",
  error:   "#DC2626",
  soft:    "#FFF3EC",
} as const;

const OTP_LEN    = 6;
const RESEND_SEC = 30;

export default function VerifyOtpV3() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const params  = useLocalSearchParams<{ phone?: string; intent?: string }>();

  // Phone is passed as URL search param from login-v3.tsx (intent=login)
  // or from forgot-pin-v2.tsx (intent=forgot).
  const phone  = params.phone ?? "";
  const intent = params.intent ?? "login"; // "login" | "forgot"
  const display = phone.length >= 12
    ? `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`
    : phone;

  const { confirmOtpV2Direct } = useDriver();

  const [otp,    setOtp]    = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState("");
  const [timer,  setTimer]  = useState(RESEND_SEC);
  const [resent, setResent] = useState(false);

  const inputRef = useRef<TextInput>(null);

  // Countdown timer
  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  // ── Verify OTP ───────────────────────────────────────────────────────────────
  async function handleVerify(code: string) {
    if (code.length !== OTP_LEN || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError("");

    console.log("[V3_VERIFY_OTP] handleVerify START phone:", phone.slice(0, 6) + "… intent:", intent);

    // Step 1: verify OTP with backend (same for all intents)
    const result = await verifyOtpApi(phone, code);

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setOtp("");
      inputRef.current?.focus();
      return;
    }

    // ── Forgot-PIN path ───────────────────────────────────────────────────────
    // OTP is used solely to authorize PIN reset. We store the token/session in
    // AuthV2Store so create-pin-v2.tsx can read them, then navigate there.
    // No Firebase sign-in or full session is established here.
    if (intent === "forgot") {
      console.log("[V3_VERIFY_OTP] intent=forgot → storing token/session in AuthV2Store → /create-pin-v2");
      AuthV2Store.setPendingToken(result.token);
      AuthV2Store.setPendingSessionId(result.sessionId ?? null);
      AuthV2Store.setPhone(phone);
      setBusy(false);
      router.replace("/create-pin-v2" as never);
      return;
    }

    // ── Login path (default) ──────────────────────────────────────────────────
    console.log("[V3_VERIFY_OTP] verifyOtpApi OK — calling confirmOtpV2Direct");

    // Step 2: establish full session via DriverContext
    // confirmOtpV2Direct → establishSession → authV3.beginVerify (synchronous ref guard)
    //   → signInWithCustomToken → profile fetch → authV3.endVerifySuccess
    const sessionResult = await confirmOtpV2Direct(result.token, phone, result.sessionId ?? null);

    setBusy(false);

    if (!sessionResult.ok) {
      console.error("[V3_VERIFY_OTP] confirmOtpV2Direct FAILED:", sessionResult.error);
      setError(sessionResult.error ?? "Login failed. Please try again.");
      return;
    }

    // Step 3: navigate to the driver's next screen
    const nextRoute = sessionResult.nextRoute ?? "/(tabs)";
    console.log("[V3_VERIFY_OTP] success → router.replace", nextRoute);
    router.replace(nextRoute as never);
  }

  function handleOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, OTP_LEN);
    setOtp(digits);
    setError("");
    if (digits.length === OTP_LEN) {
      void handleVerify(digits);
    }
  }

  async function handleResend() {
    if (timer > 0 || busy || !phone) return;
    setResent(false);
    setError("");
    setBusy(true);

    const res = await sendOtp(phone);
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    setOtp("");
    setTimer(RESEND_SEC);
    setResent(true);
    setTimeout(() => setResent(false), 4000);
    inputRef.current?.focus();
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <View
      style={[
        ss.root,
        { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
    >
      {/* Header */}
      <Pressable style={ss.backBtn} onPress={() => router.back()}>
        <Text style={ss.backText}>← Back</Text>
      </Pressable>

      <Text style={ss.title}>Verify OTP</Text>
      <Text style={ss.sub}>Enter the 6-digit code sent to{"\n"}{display}</Text>

      {/* OTP input */}
      <TextInput
        ref={inputRef}
        value={otp}
        onChangeText={handleOtpChange}
        keyboardType="number-pad"
        maxLength={OTP_LEN}
        style={ss.otpInput}
        placeholder="------"
        placeholderTextColor={D.muted}
        autoFocus
        editable={!busy}
        returnKeyType="done"
        onSubmitEditing={() => void handleVerify(otp)}
      />

      {!!error && <Text style={ss.errText}>{error}</Text>}

      {/* Verify button */}
      <Pressable
        style={[ss.btn, (busy || otp.length !== OTP_LEN) && ss.btnOff]}
        onPress={() => void handleVerify(otp)}
        disabled={busy || otp.length !== OTP_LEN}
      >
        {busy
          ? <ActivityIndicator color="#fff" />
          : <Text style={ss.btnText}>Verify</Text>
        }
      </Pressable>

      {/* Resend */}
      {resent ? (
        <Text style={ss.resentText}>OTP resent ✓</Text>
      ) : timer > 0 ? (
        <Text style={ss.timerText}>Resend in {timer}s</Text>
      ) : (
        <Pressable onPress={() => void handleResend()} disabled={busy}>
          <Text style={ss.resendLink}>Resend OTP</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  root:       { flex: 1, backgroundColor: D.bg, paddingHorizontal: 24 },

  backBtn:    { marginBottom: 20 },
  backText:   { fontSize: 15, color: D.primary, fontWeight: "600" },

  title:      { fontSize: 28, fontWeight: "700", color: D.text, marginBottom: 6 },
  sub:        { fontSize: 15, color: D.sub, marginBottom: 32, lineHeight: 22 },

  otpInput:   {
    height:          60,
    borderWidth:     1.5,
    borderColor:     D.border,
    borderRadius:    12,
    paddingHorizontal: 20,
    fontSize:        28,
    fontWeight:      "700",
    color:           D.text,
    letterSpacing:   10,
    marginBottom:    12,
    textAlign:       "center",
  },

  errText:    { color: D.error, fontSize: 14, marginBottom: 8, textAlign: "center" },

  btn:        { height: 54, borderRadius: 12, backgroundColor: D.primary, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnOff:     { opacity: 0.45 },
  btnText:    { color: "#fff", fontSize: 17, fontWeight: "700" },

  timerText:  { textAlign: "center", marginTop: 20, color: D.sub, fontSize: 14 },
  resendLink: { textAlign: "center", marginTop: 20, color: D.primary, fontSize: 14, fontWeight: "700" },
  resentText: { textAlign: "center", marginTop: 20, color: "#16A34A", fontSize: 14, fontWeight: "600" },
});
