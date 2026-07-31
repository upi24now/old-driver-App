/**
 * COMPARTMENT 8 — UI Layer: Confirm PIN Screen
 *
 * Single responsibility: verify the re-entered PIN matches the one stored in
 * FlowContext, then call the Engine to complete authentication.
 *
 * Imports only from:
 *   C2  Engine      — engineFinishAuth
 *   C8  FlowContext — flow, clearFlow
 *   C8  NumPad, PinDots
 *   C7  Validation  — pinsMatch
 *   C1  Navigation  — navToHome, navBack
 *   C10 Config      — PIN_LENGTH, COLORS
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

import { engineFinishAuth }       from "@/modules/auth-v3/engine";
import { useV3Flow }              from "@/modules/auth-v3/ui/context/FlowContext";
import { NumPad }                 from "@/modules/auth-v3/ui/components/NumPad";
import { PinDots }                from "@/modules/auth-v3/ui/components/PinDots";
import { pinsMatch }              from "@/modules/auth-v3/validation";
import { navToHome, navBack }     from "@/modules/auth-v3/navigation";
import { COLORS, PIN_LENGTH }     from "@/modules/auth-v3/config";

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

    // Validation is UI-only (no async) — handled here before calling the Engine.
    const matchResult = pinsMatch(flow.createdPin, confirmPin);
    if (!matchResult.valid) {
      setError(matchResult.message);
      setConfirm("");
      return;
    }

    setBusy(true);
    setError("");

    const result = await engineFinishAuth({
      verifyToken:     flow.verifyToken,
      verifySessionId: flow.verifySessionId,
      pin:             flow.createdPin,
      phone:           flow.phone,
      signupData: intent === "signup" && flow.signup
        ? {
            name:          flow.signup.name,
            city:          flow.signup.city,
            gender:        flow.signup.gender,
            vehicleId:     flow.signup.vehicleId,
            vehicleName:   flow.signup.vehicleName,
            licenseNumber: flow.signup.licenseNumber || undefined,
            vehicleNumber: flow.signup.vehicleNumber || undefined,
          }
        : undefined,
    });

    if (!mountedRef.current) return;

    if (!result.ok) {
      setBusy(false);
      setError(result.error.userMessage);
      setConfirm("");
      return;
    }

    clearFlow();
    navToHome(router);
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
        <Pressable style={ss.backBtn} onPress={() => navBack(router)} disabled={busy}>
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

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { backgroundColor: COLORS.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: COLORS.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: COLORS.sub, lineHeight: 20 },
  errorText:       { textAlign: "center", color: COLORS.error, fontSize: 13, marginVertical: 4 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24 },
  primaryBtn:      {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
