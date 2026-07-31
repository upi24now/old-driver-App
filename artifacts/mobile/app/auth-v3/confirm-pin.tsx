/**
 * confirm-pin.tsx — V3 Phase 9: Confirm New PIN
 *
 * Responsibility (ONE):
 *   Verify the confirmation PIN matches the one set in create-pin.tsx,
 *   then complete the flow:
 *     • signup  → sign in via Firebase + set PIN + create account → Home
 *     • forgot  → sign in via Firebase + set PIN → Home
 *
 * Reads from store: createdPin, verifyToken, verifySessionId, phone, signup
 *
 * No B2 dependencies.
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInWithCustomToken } from "firebase/auth";

import { NumPad }          from "@/components/auth-v3/NumPad";
import { PinDots }         from "@/components/auth-v3/PinDots";
import { v3Store }         from "@/utils/auth-v3-store";
import { v3SetPin, v3CreateDriverAccount } from "@/utils/auth-v3-api";
import { saveV3Session }   from "@/utils/auth-v3-session";
import { firebaseAuth }    from "@/utils/firebase";

const PIN_LENGTH = 6;
type Intent = "signup" | "forgot";

export default function ConfirmPinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const params = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [busy,    setBusy]    = useState(false);

  const onDigit = (d: string) => {
    if (busy || confirm.length >= PIN_LENGTH) return;
    setError("");
    const next = confirm + d;
    setConfirm(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => handleSubmit(next), 80);
    }
  };

  const onDelete = () => {
    if (busy) return;
    setError("");
    setConfirm((p) => p.slice(0, -1));
  };

  const handleSubmit = async (confirmPin: string) => {
    if (busy || confirmPin.length !== PIN_LENGTH) return;

    const store = v3Store.get();

    if (confirmPin !== store.createdPin) {
      setError("PINs don't match. Please try again.");
      setConfirm("");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const cred    = await signInWithCustomToken(firebaseAuth, store.verifyToken);
      const idToken = await cred.user.getIdToken();

      // Save PIN via backend
      const pinResult = await v3SetPin(store.createdPin, idToken, store.verifySessionId);
      if (!pinResult.ok) {
        setBusy(false);
        setError(pinResult.error);
        return;
      }

      if (intent === "signup") {
        // Create the driver account
        if (!store.signup) {
          setBusy(false);
          setError("Signup data missing. Please start again.");
          return;
        }
        const signupResult = await v3CreateDriverAccount({
          phone:         store.phone,
          name:          store.signup.name,
          city:          store.signup.city,
          gender:        store.signup.gender,
          vehicleId:     store.signup.vehicleId,
          vehicleName:   store.signup.vehicleName,
          licenseNumber: store.signup.licenseNumber || undefined,
          vehicleNumber: store.signup.vehicleNumber || undefined,
        });
        if (!signupResult.ok) {
          setBusy(false);
          setError(signupResult.error);
          return;
        }
      }

      await saveV3Session(cred.user.uid, store.phone);
      v3Store.clear();
      router.replace("/auth-v3/home");
    } catch (err) {
      setBusy(false);
      setError("Something went wrong. Please try again.");
      setConfirm("");
    }
  };

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => router.back()} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Confirm PIN</Text>
        <Text style={ss.sub}>Re-enter your 6-digit PIN to confirm.</Text>
      </View>

      {/* PIN dots */}
      <PinDots length={PIN_LENGTH} filled={confirm.length} error={!!error} />

      {!!error && <Text style={ss.errorText}>{error}</Text>}

      {/* Numpad */}
      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={busy || confirm.length >= PIN_LENGTH}
        />
      </View>

      {/* Submit */}
      <View style={[ss.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={[ss.primaryBtn, (busy || confirm.length !== PIN_LENGTH) && ss.btnDisabled]}
          onPress={() => handleSubmit(confirm)}
          disabled={busy || confirm.length !== PIN_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>
                {intent === "signup" ? "Create Account" : "Save PIN"}
              </Text>}
        </Pressable>
      </View>
    </View>
  );
}

const C = {
  primary: "#FF6B00",
  bg:      "#FFFFFF",
  text:    "#111111",
  sub:     "#374151",
  muted:   "#6B7280",
  error:   "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:           { flex: 1 },
  bg:             { backgroundColor: C.bg },
  header:         { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:        { marginBottom: 20 },
  backLabel:      { fontSize: 15, color: C.muted },
  heading:        { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 4 },
  sub:            { fontSize: 14, color: C.sub, lineHeight: 20 },
  errorText:      { textAlign: "center", color: C.error, fontSize: 13, marginTop: -8 },
  padWrap:        { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:         { paddingHorizontal: 24 },
  primaryBtn:     {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:    { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
