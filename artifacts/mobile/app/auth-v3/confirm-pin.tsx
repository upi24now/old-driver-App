/**
 * confirm-pin.tsx — V3 Phase 13: Confirm PIN
 *
 * Responsibility (ONE):
 *   Verify the re-entered PIN matches the one stored in flow context,
 *   then complete the auth flow:
 *
 *   signup path  → signInWithCustomToken + v3SetPin + v3CreateDriverAccount
 *                  → saveV3Session → /auth-v3/home
 *
 *   forgot path  → signInWithCustomToken + v3SetPin
 *                  → saveV3Session → /auth-v3/home
 *
 * Auto-submit: triggers immediately when 6th digit is entered and PINs match.
 * Unmount-safe: mountedRef prevents state updates after navigation.
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
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { signInWithCustomToken } from "firebase/auth";

import { NumPad }        from "@/components/auth-v3/NumPad";
import { PinDots }       from "@/components/auth-v3/PinDots";
import { useV3Flow }     from "@/contexts/auth-v3/FlowContext";
import { v3SetPin, v3CreateDriverAccount } from "@/utils/auth-v3-api";
import { saveV3Session } from "@/utils/auth-v3-session";
import { firebaseAuth }  from "@/utils/firebase";

const PIN_LENGTH = 6;
type Intent = "signup" | "forgot";

export default function ConfirmPinScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const mountedRef = useRef(true);

  const { flow, clearFlow } = useV3Flow();
  const params  = useLocalSearchParams<{ intent?: string }>();
  const intent: Intent = params.intent === "forgot" ? "forgot" : "signup";

  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [busy,    setBusy]    = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const doSubmit = async (confirmPin: string) => {
    if (busy || confirmPin.length !== PIN_LENGTH) return;

    if (confirmPin !== flow.createdPin) {
      setError("PINs don't match. Please try again.");
      setConfirm("");
      return;
    }

    setBusy(true);
    setError("");

    try {
      const cred    = await signInWithCustomToken(firebaseAuth, flow.verifyToken);
      if (!mountedRef.current) return;
      const idToken = await cred.user.getIdToken();

      const pinResult = await v3SetPin(flow.createdPin, idToken, flow.verifySessionId);
      if (!mountedRef.current) return;
      if (!pinResult.ok) {
        setBusy(false);
        setError(pinResult.error);
        return;
      }

      if (intent === "signup") {
        if (!flow.signup) {
          setBusy(false);
          setError("Signup data missing. Please start again.");
          return;
        }
        const signupResult = await v3CreateDriverAccount({
          phone:         flow.phone,
          name:          flow.signup.name,
          city:          flow.signup.city,
          gender:        flow.signup.gender,
          vehicleId:     flow.signup.vehicleId,
          vehicleName:   flow.signup.vehicleName,
          licenseNumber: flow.signup.licenseNumber || undefined,
          vehicleNumber: flow.signup.vehicleNumber || undefined,
        });
        if (!mountedRef.current) return;
        if (!signupResult.ok) {
          setBusy(false);
          setError(signupResult.error);
          return;
        }
      }

      await saveV3Session(cred.user.uid, flow.phone);
      clearFlow();
      router.replace("/auth-v3/home");
    } catch {
      if (!mountedRef.current) return;
      setBusy(false);
      setError("Something went wrong. Please try again.");
      setConfirm("");
    }
  };

  const onDigit = (d: string) => {
    if (busy || confirm.length >= PIN_LENGTH) return;
    setError("");
    const next = confirm + d;
    setConfirm(next);
    if (next.length === PIN_LENGTH) void doSubmit(next);
  };

  const onDelete = () => {
    if (busy) return;
    setError("");
    setConfirm((p) => p.slice(0, -1));
  };

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => router.back()} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>Confirm PIN</Text>
        <Text style={ss.sub}>Re-enter your 6-digit PIN to confirm.</Text>
      </View>

      <PinDots length={PIN_LENGTH} filled={confirm.length} error={!!error} />

      {!!error && <Text style={ss.errorText}>{error}</Text>}

      <View style={ss.padWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={busy || confirm.length >= PIN_LENGTH}
        />
      </View>

      <View style={[ss.footer, { paddingBottom: Math.max(insets.bottom, 24) }]}>
        <Pressable
          style={[ss.primaryBtn, (busy || confirm.length !== PIN_LENGTH) && ss.btnDisabled]}
          onPress={() => void doSubmit(confirm)}
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
  flex:            { flex: 1 },
  bg:              { backgroundColor: C.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: C.sub, lineHeight: 20 },
  errorText:       { textAlign: "center", color: C.error, fontSize: 13, marginVertical: 4 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24 },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
