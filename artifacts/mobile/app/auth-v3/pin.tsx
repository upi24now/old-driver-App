/**
 * pin.tsx — V3 Phase 9: PIN Entry Screen
 *
 * Responsibility (ONE):
 *   Accept the 6-digit PIN, verify it against the backend, sign in with
 *   Firebase, save the V3 session, and navigate to Home.
 *
 * Auto-submit: when the 6th digit is entered, doLogin() is called immediately
 * with the completed PIN passed as a direct argument (no stale-closure risk,
 * no arbitrary setTimeout).
 *
 * Unmount-safe: the busy flag prevents double-submission; the mountedRef
 * prevents state updates after the component has unmounted.
 *
 * No B2 dependencies.
 */

import React, { useRef, useState } from "react";
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

import { NumPad }        from "@/components/auth-v3/NumPad";
import { PinDots }       from "@/components/auth-v3/PinDots";
import { useV3Flow }     from "@/contexts/auth-v3/FlowContext";
import { v3VerifyPin }   from "@/utils/auth-v3-api";
import { saveV3Session } from "@/utils/auth-v3-session";
import { firebaseAuth }  from "@/utils/firebase";

const PIN_LENGTH = 6;

export default function PinScreen() {
  const router      = useRouter();
  const insets      = useSafeAreaInsets();
  const { flow }    = useV3Flow();
  const mountedRef  = useRef(true);

  const [pin,   setPin]   = useState("");
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  // Passed as a direct argument from onDigit so we never read stale `pin` state.
  const doLogin = async (completedPin: string) => {
    if (busy) return;
    setBusy(true);
    setError("");

    const result = await v3VerifyPin(flow.phone, completedPin);

    if (!mountedRef.current) return;

    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setPin("");
      return;
    }

    try {
      const cred = await signInWithCustomToken(firebaseAuth, result.token);
      if (!mountedRef.current) return;
      await saveV3Session(cred.user.uid, flow.phone);
      router.replace("/auth-v3/home");
    } catch {
      if (!mountedRef.current) return;
      setBusy(false);
      setError("Sign-in failed. Please try again.");
      setPin("");
    }
  };

  const onDigit = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError("");
    const next = pin + d;
    setPin(next);
    // Call directly with the computed value — no setTimeout, no stale closure.
    if (next.length === PIN_LENGTH) void doLogin(next);
  };

  const onDelete = () => {
    if (busy) return;
    setError("");
    setPin((p) => p.slice(0, -1));
  };

  // Cleanup on unmount
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => router.back()} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Enter PIN</Text>
        <Text style={ss.sub}>{flow.phone}</Text>
      </View>

      <PinDots length={PIN_LENGTH} filled={pin.length} error={!!error} />

      {!!error && <Text style={ss.errorText}>{error}</Text>}

      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={busy || pin.length >= PIN_LENGTH}
        />
      </View>

      <View style={[ss.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={ss.forgotLink}
          onPress={() => router.push("/auth-v3/forgot-pin")}
          disabled={busy}
        >
          <Text style={ss.forgotLabel}>Forgot PIN?</Text>
        </Pressable>

        <Pressable
          style={[ss.primaryBtn, (busy || pin.length !== PIN_LENGTH) && ss.btnDisabled]}
          onPress={() => void doLogin(pin)}
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
  flex:            { flex: 1 },
  bg:              { backgroundColor: C.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: C.sub },
  errorText:       { textAlign: "center", color: C.error, fontSize: 13, marginVertical: 4 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24, gap: 12 },
  forgotLink:      { alignSelf: "center", paddingVertical: 4 },
  forgotLabel:     { color: C.primary, fontSize: 14, fontWeight: "600" },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
