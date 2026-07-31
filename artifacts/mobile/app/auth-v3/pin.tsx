/**
 * pin.tsx — V3 Phase 5: PIN Entry Screen
 *
 * Responsibility (ONE):
 *   Accept the driver's 6-digit PIN, verify it against the backend,
 *   sign in with Firebase, save the V3 session, and navigate to Home.
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
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInWithCustomToken } from "firebase/auth";

import { NumPad }       from "@/components/auth-v3/NumPad";
import { PinDots }      from "@/components/auth-v3/PinDots";
import { v3Store }      from "@/utils/auth-v3-store";
import { v3VerifyPin }  from "@/utils/auth-v3-api";
import { saveV3Session } from "@/utils/auth-v3-session";
import { firebaseAuth } from "@/utils/firebase";

const PIN_LENGTH = 6;

export default function PinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [pin,   setPin]   = useState("");
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  const phone = v3Store.get().phone; // set by login.tsx

  // Auto-submit when PIN is complete. `nextPin` passed directly to avoid
  // stale-closure on the state update.
  const handleLogin = async (completedPin: string) => {
    if (busy || completedPin.length !== PIN_LENGTH) return;
    setBusy(true);
    setError("");

    const result = await v3VerifyPin(phone, completedPin);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setPin("");
      return;
    }

    try {
      const cred = await signInWithCustomToken(firebaseAuth, result.token);
      await saveV3Session(cred.user.uid, phone);
      v3Store.clear();
      router.replace("/auth-v3/home");
    } catch {
      setBusy(false);
      setError("Sign-in failed. Please try again.");
      setPin("");
    }
  };

  const onDigit = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setError("");
    setPin(next);
    if (next.length === PIN_LENGTH) {
      setTimeout(() => handleLogin(next), 80);
    }
  };

  const onDelete = () => {
    if (busy) return;
    setError("");
    setPin((p) => p.slice(0, -1));
  };

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Enter PIN</Text>
        <Text style={ss.sub}>{phone}</Text>
      </View>

      {/* PIN dots */}
      <PinDots length={PIN_LENGTH} filled={pin.length} error={!!error} />

      {/* Error */}
      {!!error && <Text style={ss.errorText}>{error}</Text>}

      {/* Numpad */}
      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={busy || pin.length >= PIN_LENGTH}
        />
      </View>

      {/* Submit + Forgot PIN */}
      <View style={[ss.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={ss.forgotLink}
          onPress={() => {
            v3Store.setPhone(phone); // ensure phone is in store
            router.push("/auth-v3/forgot-pin");
          }}
        >
          <Text style={ss.forgotLabel}>Forgot PIN?</Text>
        </Pressable>

        <Pressable
          style={[ss.primaryBtn, (busy || pin.length !== PIN_LENGTH) && ss.btnDisabled]}
          onPress={() => handleLogin(pin)}
          disabled={busy || pin.length !== PIN_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Login</Text>}
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
  sub:            { fontSize: 14, color: C.sub },
  errorText:      { textAlign: "center", color: C.error, fontSize: 13, marginTop: -8, marginBottom: 8 },
  padWrap:        { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:         { paddingHorizontal: 24, gap: 12 },
  forgotLink:     { alignSelf: "center", paddingVertical: 4 },
  forgotLabel:    { color: C.primary, fontSize: 14, fontWeight: "600" },
  primaryBtn:     {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:    { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
