/**
 * login-v2.tsx — V2 Login Screen
 *
 * Phase "phone": Enter 10-digit mobile number → sendOtp → /verify-otp-v2?intent=login
 * Phase "pin":   Enter 6-digit PIN → DriverContext.confirmPin → home
 *                If PIN not found   → /create-pin-v2?intent=setup
 *
 * "Forgot PIN?" → /forgot-pin-v2
 *
 * [V2_LOGIN] logs only. No authentication logic changes.
 */

import React, { useEffect, useRef, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";

import { sendOtpV2 } from "@/utils/auth-v2-api";
import { AuthV2Store } from "@/utils/auth-v2-store";
// TEMPORARILY DISABLED — OTP-only login during stabilization phase.
// confirmPin removed from useDriver import; PIN phase bypassed entirely.
// import { useDriver } from "@/contexts/DriverContext";

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

const PIN_LEN = 6;

// ── Screen ────────────────────────────────────────────────────────────────────
export default function LoginV2() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { phase: phaseParam } = useLocalSearchParams<{ phase?: string }>();

  // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
  // confirmPin is unused while PIN phase is bypassed.
  // const { confirmPin } = useDriver();

  // phase is always "phone" — "pin" phase is unreachable while PIN bypass is active.
  // Kept for future re-enable; phaseParam is still read so the screen gracefully
  // ignores any stale ?phase=pin URL that might arrive.
  const [phase, setPhase] = useState<"phone" | "pin">("phone");
  const [phoneDigits, setPhoneDigits] = useState(
    AuthV2Store.getPhone().replace(/^\+91/, ""),
  );
  // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
  // PIN state kept for future re-enable.
  const [pin,   setPin]   = useState("");
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState("");

  const pinRef = useRef<TextInput>(null);

  // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
  // ?phase=pin navigation is commented out in verify-otp-v2.tsx; this effect
  // is kept but will never fire while PIN bypass is active.
  useEffect(() => {
    if (phaseParam === "pin") {
      // OTP-only login: ignore ?phase=pin — PIN phase is disabled.
      // setPhase("pin");
      // setPin("");
      // setError("");
      // setTimeout(() => pinRef.current?.focus(), 250);
      console.log("[OTP_ONLY] login-v2: ?phase=pin received but PIN phase is disabled (OTP-only mode)");
    }
  }, [phaseParam]);

  // ── Phone phase ──────────────────────────────────────────────────────────────
  async function handleSendOtp() {
    if (busy || phoneDigits.length !== 10) return;
    Keyboard.dismiss();
    setError("");
    setBusy(true);
    console.log("[V2_LOGIN] sendOtp — digits:", phoneDigits.length);

    const phone = `+91${phoneDigits}`;
    AuthV2Store.setPhone(phone);

    const result = await sendOtpV2(phone);
    setBusy(false);

    if (!result.ok) {
      console.log("[V2_LOGIN] sendOtp failed:", result.error);
      setError(result.error);
      return;
    }
    AuthV2Store.setOtpId(result.otpId);
    console.log("[V2_LOGIN] OTP sent → verify-otp-v2?intent=login");
    router.push("/verify-otp-v2?intent=login" as never);
  }

  // TEMPORARILY DISABLED — OTP-only login during stabilization phase.
  // PIN verify API (POST /api/v2/auth/verify-pin) is not called while PIN bypass is active.
  // Restore by uncommenting handleVerifyPin, handlePinChange, and the phase === "pin" UI block,
  // and by restoring the verify-otp-v2.tsx PIN routing and the confirmPin import above.
  //
  // async function handleVerifyPin(value: string) {
  //   if (value.length !== PIN_LEN || busy) return;
  //   Keyboard.dismiss();
  //   setBusy(true);
  //   setError("");
  //   console.log("[V2_LOGIN] verifying PIN for phone:", AuthV2Store.getPhone().slice(0, 5) + "…");
  //   const result = await confirmPin(AuthV2Store.getPhone(), value);
  //   setBusy(false);
  //   if (!result.ok) {
  //     setPin("");
  //     if (result.pinNotFound) {
  //       console.log("[V2_LOGIN] pinNotFound → create-pin-v2?intent=setup");
  //       router.replace("/create-pin-v2?intent=setup" as never);
  //       return;
  //     }
  //     console.log("[V2_LOGIN] PIN verify failed:", result.error);
  //     setError(result.error ?? "Invalid PIN. Please try again.");
  //     return;
  //   }
  //   console.log("[V2_LOGIN_SUCCESS] confirmPin OK — DriverContext navigating");
  // }
  //
  // function handlePinChange(v: string) {
  //   const digits = v.replace(/\D/g, "").slice(0, PIN_LEN);
  //   setPin(digits);
  //   setError("");
  //   if (digits.length === PIN_LEN) handleVerifyPin(digits);
  // }
  //
  // ── PIN phase UI (TEMPORARILY DISABLED) ──────────────────────────────────────
  // OTP-only login: phase is always "phone"; this block never renders.
  // if (phase === "pin") {
  //   const phone    = AuthV2Store.getPhone();
  //   const display  = phone.length >= 12
  //     ? `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`
  //     : phone;
  //   return (
  //     <KeyboardAvoidingView style={ss.flex} behavior={Platform.OS === "ios" ? "padding" : "height"}>
  //       <View style={[ss.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
  //         <View style={ss.content}>
  //           <Text style={ss.title}>Enter Your PIN</Text>
  //           <Text style={ss.sub}>{display}</Text>
  //           <View style={ss.pinRow}>
  //             {Array.from({ length: PIN_LEN }, (_, i) => (
  //               <View key={i} style={[ss.pinCell, pin[i] ? ss.pinFilled : null]}>
  //                 <Text style={ss.pinDot}>{pin[i] ? "●" : ""}</Text>
  //               </View>
  //             ))}
  //           </View>
  //           <TextInput ref={pinRef} value={pin} onChangeText={handlePinChange}
  //             keyboardType="number-pad" secureTextEntry maxLength={PIN_LEN}
  //             style={ss.hidden} autoFocus editable={!busy} />
  //           {busy && <ActivityIndicator color={D.primary} style={ss.loader} />}
  //           {!!error && <Text style={ss.errText}>{error}</Text>}
  //           <Pressable style={ss.forgotBtn} onPress={() => router.push("/forgot-pin-v2" as never)}>
  //             <Text style={ss.forgotText}>Forgot PIN?</Text>
  //           </Pressable>
  //           <Pressable style={ss.linkBtn} onPress={() => { setPhase("phone"); setPin(""); setError(""); }}>
  //             <Text style={ss.linkText}>← Change Number</Text>
  //           </Pressable>
  //         </View>
  //       </View>
  //     </KeyboardAvoidingView>
  //   );
  // }

  // ── Phone phase UI ────────────────────────────────────────────────────────────
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

          {/* ── BUILD PROOF (temporary) ── */}
          <View style={ss.proofRow}>
            <Text style={ss.proofIcon}>❌</Text>
            <Text style={ss.proofText}>BUILD_PROOF_X_20260730</Text>
          </View>

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

          <Pressable style={ss.forgotBtn} onPress={() => router.push("/forgot-pin-v2" as never)}>
            <Text style={ss.forgotText}>Forgot PIN?</Text>
          </Pressable>

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
  btn:         { height: 54, borderRadius: 12, backgroundColor: D.primary, alignItems: "center", justifyContent: "center", marginTop: 4 },
  btnOff:      { opacity: 0.45 },
  btnText:     { color: "#fff", fontSize: 17, fontWeight: "700" },

  // Errors & links
  errText:     { color: D.error, fontSize: 14, marginBottom: 8, textAlign: "center" },
  forgotBtn:   { alignSelf: "center", paddingVertical: 14 },
  forgotText:  { color: D.primary, fontSize: 15, fontWeight: "600" },
  linkBtn:     { alignSelf: "center", paddingVertical: 8 },
  linkText:    { color: D.sub, fontSize: 14 },
  loader:      { marginVertical: 12 },

  // PIN cells
  pinRow:      { flexDirection: "row", justifyContent: "center", gap: 10, marginVertical: 28 },
  pinCell:     { width: 46, height: 54, borderRadius: 10, borderWidth: 1.5, borderColor: D.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" },
  pinFilled:   { borderColor: D.primary, backgroundColor: D.soft },
  pinDot:      { fontSize: 22, color: D.text },
  hidden:      { position: "absolute", opacity: 0, width: 1, height: 1 },

  // Build proof
  proofRow:    { flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 6, marginBottom: 12 },
  proofIcon:   { fontSize: 22 },
  proofText:   { fontSize: 11, fontWeight: "700", color: "#FF0000", letterSpacing: 0.3 },
});
