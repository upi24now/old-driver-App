/**
 * verify-otp-v2.tsx — V2 OTP Verification Screen
 *
 * Reads ?intent=login | forgot from URL params.
 *
 * TEMPORARILY DISABLED — OTP-only login during stabilization phase.
 * Both intents now establish a full session directly after OTP (no PIN screen).
 *
 * Original routing (re-enable when PIN is restored):
 *   intent=login  → verifyOtp → store token → /login-v2?phase=pin
 *   intent=forgot → verifyOtp → store token → /create-pin-v2?intent=reset
 *
 * Current routing:
 *   intent=login | forgot → verifyOtp → confirmOtpV2Direct → home/onboarding
 *
 * [V2_VERIFY_OTP] logs only. No authentication logic changes.
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

import { verifyOtpV2, sendOtpV2 } from "@/utils/auth-v2-api";
import { AuthV2Store } from "@/utils/auth-v2-store";
import { useDriver } from "@/contexts/DriverContext";

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

const OTP_LEN       = 6;
const RESEND_SEC    = 30;

export default function VerifyOtpV2() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { intent } = useLocalSearchParams<{ intent?: string }>();

  // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
  // confirmOtpV2Direct establishes a full session from the OTP token (no PIN).
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
    const id = setInterval(() => setTimer(t => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  const phone   = AuthV2Store.getPhone();
  const display = phone.length >= 12
    ? `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`
    : phone;

  // ── Verify OTP ───────────────────────────────────────────────────────────────
  async function handleVerify(code: string) {
    if (code.length !== OTP_LEN || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError("");
    console.log("[V2_VERIFY_OTP] verifyOtp — intent:", intent, "| phone:", phone.slice(0, 5) + "…");

    const result = await verifyOtpV2(phone, code);

    if (!result.ok) {
      setBusy(false);
      console.log("[V2_VERIFY_OTP] failed:", result.error);
      setError(result.error);
      setOtp("");
      inputRef.current?.focus();
      return;
    }

    // Store token + sessionId (kept so create-pin-v2 / set-pin paths can be re-enabled later)
    AuthV2Store.setPendingToken(result.token);
    AuthV2Store.setPendingSessionId(result.sessionId ?? null);
    console.log("[V2_VERIFY_OTP] success — token:", result.token ? "present" : "MISSING",
      "| sessionId:", result.sessionId ? "present" : "absent",
      "| intent:", intent);

    // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
    // Original PIN routing (restore when PIN is re-enabled):
    //   if (intent === "forgot") {
    //     console.log("[V2_VERIFY_OTP] intent=forgot → create-pin-v2?intent=reset");
    //     router.replace("/create-pin-v2?intent=reset" as never);
    //   } else {
    //     console.log("[V2_VERIFY_OTP] intent=login → login-v2?phase=pin");
    //     router.replace("/login-v2?phase=pin" as never);
    //   }

    // OTP-only login: establish full session directly from the OTP token.
    // confirmOtpV2Direct calls establishSession → fetches profile → navigates to home/onboarding.
    console.log("[OTP_ONLY] OTP verified — establishing session directly (PIN bypass active), intent:", intent);
    const sessionResult = await confirmOtpV2Direct(result.token, phone, result.sessionId ?? null);
    setBusy(false);
    if (!sessionResult.ok) {
      console.error("[OTP_ONLY] confirmOtpV2Direct failed:", sessionResult.error);
      setError(sessionResult.error ?? "Login failed. Please try again.");
    }
    // On success, confirmOtpV2Direct → establishSession calls router.replace internally.
  }

  function handleOtpChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, OTP_LEN);
    setOtp(digits);
    setError("");
    if (digits.length === OTP_LEN) handleVerify(digits);
  }

  // ── Resend OTP ───────────────────────────────────────────────────────────────
  async function handleResend() {
    if (timer > 0 || busy) return;
    setBusy(true);
    setOtp("");
    setError("");
    console.log("[V2_VERIFY_OTP] resend OTP");

    const result = await sendOtpV2(phone);
    setBusy(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    AuthV2Store.setOtpId(result.otpId);
    setTimer(RESEND_SEC);
    setResent(true);
    console.log("[V2_VERIFY_OTP] OTP resent");
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  return (
    <View style={[ss.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
      <View style={ss.content}>

        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backText}>← Back</Text>
        </Pressable>

        <Text style={ss.title}>Verify Your Number</Text>
        <Text style={ss.sub}>
          {intent === "forgot"
            ? "Enter the OTP sent to "
            : "Enter the OTP sent to "}
          <Text style={ss.phone}>{display}</Text>
        </Text>

        {resent && (
          <Text style={ss.resentText}>OTP resent successfully</Text>
        )}

        {/* OTP cells */}
        <View style={ss.otpRow}>
          {Array.from({ length: OTP_LEN }, (_, i) => (
            <View
              key={i}
              style={[
                ss.otpCell,
                otp[i] ? ss.otpFilled : null,
                i === otp.length ? ss.otpActive : null,
              ]}
            >
              <Text style={ss.otpChar}>{otp[i] ?? ""}</Text>
            </View>
          ))}
        </View>

        {/* Hidden input captures keypad */}
        <TextInput
          ref={inputRef}
          value={otp}
          onChangeText={handleOtpChange}
          keyboardType="number-pad"
          maxLength={OTP_LEN}
          style={ss.hidden}
          autoFocus
          editable={!busy}
        />

        {busy && <ActivityIndicator color={D.primary} style={ss.loader} />}
        {!!error && <Text style={ss.errText}>{error}</Text>}

        <Pressable
          style={[ss.btn, (busy || otp.length !== OTP_LEN) && ss.btnOff]}
          onPress={() => handleVerify(otp)}
          disabled={busy || otp.length !== OTP_LEN}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.btnText}>Verify OTP</Text>
          }
        </Pressable>

        <View style={ss.resendRow}>
          {timer > 0
            ? <Text style={ss.timerText}>Resend in {timer}s</Text>
            : (
              <Pressable onPress={handleResend} disabled={busy}>
                <Text style={ss.resendText}>Resend OTP</Text>
              </Pressable>
            )
          }
        </View>

      </View>
    </View>
  );
}

const ss = StyleSheet.create({
  root:       { flex: 1, backgroundColor: D.bg },
  content:    { paddingHorizontal: 24 },
  backBtn:    { marginBottom: 24, alignSelf: "flex-start" },
  backText:   { color: D.sub, fontSize: 15 },
  title:      { fontSize: 26, fontWeight: "700", color: D.text, marginBottom: 8 },
  sub:        { fontSize: 15, color: D.sub, marginBottom: 28, lineHeight: 22 },
  phone:      { fontWeight: "700", color: D.text },
  resentText: { color: "#16A34A", fontSize: 14, marginBottom: 8, textAlign: "center" },

  // OTP cells
  otpRow:     { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 28 },
  otpCell:    { width: 46, height: 56, borderRadius: 10, borderWidth: 1.5, borderColor: D.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" },
  otpFilled:  { borderColor: D.primary, backgroundColor: D.soft },
  otpActive:  { borderColor: D.primary },
  otpChar:    { fontSize: 22, fontWeight: "700", color: D.text },
  hidden:     { position: "absolute", opacity: 0, width: 1, height: 1 },

  // Button
  btn:        { height: 54, borderRadius: 12, backgroundColor: D.primary, alignItems: "center", justifyContent: "center" },
  btnOff:     { opacity: 0.45 },
  btnText:    { color: "#fff", fontSize: 17, fontWeight: "700" },

  loader:     { marginVertical: 12 },
  errText:    { color: D.error, fontSize: 14, marginBottom: 8, textAlign: "center" },
  resendRow:  { alignItems: "center", marginTop: 20 },
  timerText:  { color: D.muted, fontSize: 14 },
  resendText: { color: D.primary, fontSize: 15, fontWeight: "600" },
});
