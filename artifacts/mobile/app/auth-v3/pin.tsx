/**
 * COMPARTMENT 8 — UI Layer: PIN Screen
 *
 * Single responsibility: accept the 6-digit PIN and trigger login.
 * Delegates all auth logic to the Engine; calls Navigation for routing.
 *
 * Imports only from:
 *   C2  Engine      — engineLogin
 *   C8  FlowContext — flow.phone
 *   C8  NumPad, PinDots
 *   C1  Navigation  — navToHome, navToForgotPin, navBack
 *   C10 Config      — PIN_LENGTH, colours
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

import { engineLogin }              from "@/modules/auth-v3/engine";
import { useV3Flow }                from "@/modules/auth-v3/ui/context/FlowContext";
import { NumPad }                   from "@/modules/auth-v3/ui/components/NumPad";
import { PinDots }                  from "@/modules/auth-v3/ui/components/PinDots";
import { navToHome, navToForgotPin, navBack } from "@/modules/auth-v3/navigation";
import { COLORS, PIN_LENGTH }       from "@/modules/auth-v3/config";

export default function PinScreen() {
  const router     = useRouter();
  const insets     = useSafeAreaInsets();
  const { flow }   = useV3Flow();
  const mountedRef = useRef(true);

  const [pin,   setPin]   = useState("");
  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Accepts the completed PIN as a direct argument — no stale-closure risk.
  const doLogin = async (completedPin: string) => {
    if (busy) return;
    setBusy(true);
    setError("");

    const result = await engineLogin(flow.phone, completedPin);
    if (!mountedRef.current) return;

    if (!result.success) {
      setBusy(false);
      setError(result.error.userMessage);
      setPin("");
      return;
    }

    navToHome(router);
  };

  const onDigit = (d: string) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    setError("");
    const next = pin + d;
    setPin(next);
    if (next.length === PIN_LENGTH) void doLogin(next);
  };

  const onDelete = () => {
    if (busy) return;
    setError("");
    setPin((p) => p.slice(0, -1));
  };

  return (
    <View style={[ss.flex, ss.bg, { paddingTop: insets.top }]}>
      <View style={ss.header}>
        <Pressable style={ss.backBtn} onPress={() => navBack(router)} disabled={busy}>
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
          onPress={() => navToForgotPin(router)}
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

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { backgroundColor: COLORS.bg },
  header:          { paddingHorizontal: 24, paddingBottom: 8 },
  backBtn:         { marginBottom: 20 },
  backLabel:       { fontSize: 15, color: COLORS.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 4 },
  sub:             { fontSize: 14, color: COLORS.sub },
  errorText:       { textAlign: "center", color: COLORS.error, fontSize: 13, marginVertical: 4 },
  padWrap:         { flex: 1, justifyContent: "center", paddingVertical: 8 },
  footer:          { paddingHorizontal: 24, gap: 12 },
  forgotLink:      { alignSelf: "center", paddingVertical: 4 },
  forgotLabel:     { color: COLORS.primary, fontSize: 14, fontWeight: "600" },
  primaryBtn:      {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center",
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
