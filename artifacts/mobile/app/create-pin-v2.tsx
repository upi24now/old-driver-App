/**
 * create-pin-v2.tsx — V2 Create / Reset PIN Screen
 *
 * Reads ?intent=setup | reset from URL params.
 *
 * Flow:
 *   Sub-phase "enter"   : Driver types a new 6-digit PIN
 *   Sub-phase "confirm" : Driver types the same PIN again to confirm
 *   On match: signInWithCustomToken → setPinV2 → DriverContext.confirmPin
 *   confirmPin handles navigation to home / onboarding automatically.
 *
 * [V2_CREATE_PIN] / [V2_SAVE_PIN] / [V2_LOGIN_SUCCESS] logs only.
 * No authentication logic changes.
 */

import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { signInWithCustomToken } from "firebase/auth";

import { setPinV2 } from "@/utils/auth-v2-api";
import { AuthV2Store } from "@/utils/auth-v2-store";
import { firebaseAuth } from "@/utils/firebase";
import { useDriver } from "@/contexts/DriverContext";

const D = {
  bg:      "#FFFFFF",
  primary: "#FF6A00",
  soft:    "#FFF3EC",
  text:    "#172033",
  sub:     "#6B7280",
  muted:   "#9CA3AF",
  border:  "#E5E7EB",
  error:   "#DC2626",
  success: "#16A34A",
} as const;

const PIN_LEN = 6;

type SubPhase = "enter" | "confirm";

export default function CreatePinV2() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const { confirmPin } = useDriver();

  const [subPhase,  setSubPhase]  = useState<SubPhase>("enter");
  const [firstPin,  setFirstPin]  = useState("");
  const [confirmP,  setConfirmP]  = useState("");
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState("");

  const confirmRef = useRef<TextInput>(null);

  const isReset = intent === "reset";
  const title   = isReset ? "Create New PIN" : "Set Up Your PIN";
  const sub     = isReset
    ? "Enter a new 6-digit PIN for your account"
    : "Create a 6-digit PIN to log in quickly";

  // ── Enter sub-phase ──────────────────────────────────────────────────────────
  function handleFirstPinChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, PIN_LEN);
    setFirstPin(digits);
    setError("");
    if (digits.length === PIN_LEN) {
      Keyboard.dismiss();
      console.log("[V2_CREATE_PIN] first PIN entered — moving to confirm phase");
      setSubPhase("confirm");
      setTimeout(() => confirmRef.current?.focus(), 200);
    }
  }

  // ── Confirm sub-phase ────────────────────────────────────────────────────────
  function handleConfirmChange(v: string) {
    const digits = v.replace(/\D/g, "").slice(0, PIN_LEN);
    setConfirmP(digits);
    setError("");
    if (digits.length === PIN_LEN) {
      Keyboard.dismiss();
      handleSavePin(digits);
    }
  }

  // ── Save PIN ─────────────────────────────────────────────────────────────────
  async function handleSavePin(confirmed: string) {
    if (confirmed !== firstPin) {
      console.log("[V2_CREATE_PIN] PIN mismatch — resetting to enter phase");
      setError("PINs do not match. Please try again.");
      setConfirmP("");
      setFirstPin("");
      setSubPhase("enter");
      return;
    }

    const pendingToken    = AuthV2Store.getPendingToken();
    const pendingSession  = AuthV2Store.getPendingSessionId();
    const phone           = AuthV2Store.getPhone();

    if (!pendingToken) {
      console.error("[V2_CREATE_PIN] no pendingToken in store — session expired");
      setError("Session expired. Please restart the flow.");
      return;
    }

    setBusy(true);
    setError("");
    console.log("[V2_CREATE_PIN] saving PIN — phone:", phone.slice(0, 5) + "…", "| intent:", intent);

    try {
      // Step 1: Sign in to Firebase to get ID token (needed for set-pin API)
      console.log("[V2_CREATE_PIN] signInWithCustomToken — start");
      const userCred = await signInWithCustomToken(firebaseAuth, pendingToken);
      const idToken  = await userCred.user.getIdToken();
      console.log("[V2_CREATE_PIN] got ID token — calling setPinV2");

      // Step 2: Save PIN via API using explicit idToken (no React state dependency)
      const setResult = await setPinV2(confirmed, idToken, pendingSession);
      if (!setResult.ok) {
        console.error("[V2_CREATE_PIN] setPinV2 failed:", setResult.error);
        setBusy(false);
        setError(setResult.error);
        return;
      }
      console.log("[V2_SAVE_PIN] PIN saved successfully");

      // Step 3: Full login via DriverContext.confirmPin
      // confirmPin: verifies PIN → establishSession → sets isOtpVerified=true → navigates
      console.log("[V2_CREATE_PIN] calling confirmPin to establish session");
      const loginResult = await confirmPin(phone, confirmed);
      setBusy(false);

      if (!loginResult.ok) {
        console.error("[V2_CREATE_PIN] confirmPin failed:", loginResult.error);
        setError(loginResult.error ?? "Login failed after PIN creation. Please try logging in.");
        return;
      }
      // confirmPin navigates automatically on success (calls router.replace internally)
      console.log("[V2_LOGIN_SUCCESS] PIN created + session established — DriverContext navigating");
      AuthV2Store.clear();
    } catch (e) {
      setBusy(false);
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[V2_CREATE_PIN] unexpected error:", msg);
      setError(`An error occurred: ${msg}`);
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────────
  const activePin  = subPhase === "enter" ? firstPin : confirmP;
  const subTitle   = subPhase === "enter"
    ? sub
    : "Re-enter your PIN to confirm";

  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View style={[ss.root, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
        <View style={ss.content}>

          {/* Back only if not busy */}
          {!busy && (
            <Pressable
              style={ss.backBtn}
              onPress={() => {
                if (subPhase === "confirm") {
                  setSubPhase("enter");
                  setConfirmP("");
                  setError("");
                } else {
                  router.back();
                }
              }}
            >
              <Text style={ss.backText}>← Back</Text>
            </Pressable>
          )}

          <Text style={ss.title}>{title}</Text>
          <Text style={ss.sub}>{subTitle}</Text>

          {/* Step indicator */}
          <View style={ss.stepRow}>
            <View style={[ss.stepDot, ss.stepActive]} />
            <View style={[ss.stepLine, subPhase === "confirm" && ss.stepLineFilled]} />
            <View style={[ss.stepDot, subPhase === "confirm" && ss.stepActive]} />
          </View>
          <View style={ss.stepLabelRow}>
            <Text style={[ss.stepLabel, ss.stepLabelActive]}>Enter</Text>
            <Text style={[ss.stepLabel, subPhase === "confirm" && ss.stepLabelActive]}>Confirm</Text>
          </View>

          {/* PIN dots */}
          <View style={ss.pinRow}>
            {Array.from({ length: PIN_LEN }, (_, i) => (
              <View
                key={i}
                style={[ss.pinCell, activePin[i] ? ss.pinFilled : null]}
              >
                <Text style={ss.pinDot}>{activePin[i] ? "●" : ""}</Text>
              </View>
            ))}
          </View>

          {/* Hidden inputs */}
          {subPhase === "enter" ? (
            <TextInput
              value={firstPin}
              onChangeText={handleFirstPinChange}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_LEN}
              style={ss.hidden}
              autoFocus
              editable={!busy}
            />
          ) : (
            <TextInput
              ref={confirmRef}
              value={confirmP}
              onChangeText={handleConfirmChange}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={PIN_LEN}
              style={ss.hidden}
              autoFocus
              editable={!busy}
            />
          )}

          {busy && (
            <View style={ss.busyRow}>
              <ActivityIndicator color={D.primary} />
              <Text style={ss.busyText}>Saving PIN…</Text>
            </View>
          )}
          {!!error && <Text style={ss.errText}>{error}</Text>}

        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  flex:            { flex: 1, backgroundColor: D.bg },
  root:            { flex: 1 },
  content:         { paddingHorizontal: 24 },
  backBtn:         { marginBottom: 24, alignSelf: "flex-start" },
  backText:        { color: D.sub, fontSize: 15 },
  title:           { fontSize: 26, fontWeight: "700", color: D.text, marginBottom: 8 },
  sub:             { fontSize: 15, color: D.sub, marginBottom: 28, lineHeight: 22 },

  // Step indicator
  stepRow:         { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  stepDot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: D.border },
  stepActive:      { backgroundColor: D.primary },
  stepLine:        { flex: 1, height: 2, backgroundColor: D.border, marginHorizontal: 4 },
  stepLineFilled:  { backgroundColor: D.primary },
  stepLabelRow:    { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  stepLabel:       { fontSize: 12, color: D.muted },
  stepLabelActive: { color: D.primary, fontWeight: "600" },

  // PIN cells
  pinRow:   { flexDirection: "row", justifyContent: "center", gap: 10, marginBottom: 28 },
  pinCell:  { width: 46, height: 56, borderRadius: 10, borderWidth: 1.5, borderColor: D.border, alignItems: "center", justifyContent: "center", backgroundColor: "#FAFAFA" },
  pinFilled:{ borderColor: D.primary, backgroundColor: D.soft },
  pinDot:   { fontSize: 22, color: D.text },
  hidden:   { position: "absolute", opacity: 0, width: 1, height: 1 },

  busyRow:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginVertical: 12 },
  busyText: { color: D.sub, fontSize: 15 },
  errText:  { color: D.error, fontSize: 14, textAlign: "center", marginTop: 8 },
});
