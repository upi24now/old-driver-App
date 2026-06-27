/**
 * create-pin.tsx — post-OTP "Create 6-digit PIN" step.
 *
 * Shown ONLY to drivers who have just verified OTP and do not yet have a PIN.
 * This screen never replaces OTP login; it is injected by login.tsx between a
 * successful OTP verification and the existing onboarding/Home routing.
 *
 * Flow:
 *   Enter 6-digit PIN → Confirm 6-digit PIN → POST /auth/set-pin → continue.
 * The intended destination is passed in via the `next` route param and is the
 * exact route the existing flow would have used (no routing logic changes here).
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { setPin as setPinApi, verifyPinApi } from "@/utils/auth-api";
import { setSessionId } from "@/utils/session";
import { useDriver } from "@/contexts/DriverContext";

// ─── Design tokens (mirror login.tsx) ───────────────────────────────────────────
const D = {
  bg:            "#F8FAFC",
  primary:       "#FF6B00",
  primarySoft:   "#FFF3EC",
  text:          "#111827",
  textSecondary: "#6B7280",
  textMuted:     "#9CA3AF",
  border:        "#E5E7EB",
  white:         "#FFFFFF",
  error:         "#DC2626",
  navy:          "#111827",
  cardBorder:    "#E5E7EB",
} as const;

const PIN_LENGTH = 6;

const WIN_W  = Dimensions.get("window").width;
const CELL_W = Math.floor((WIN_W - 40 - 40) / 6);

const FALLBACK_ROUTE = "/(tabs)";

// ─── 6-cell PIN row ─────────────────────────────────────────────────────────────
function PinCells({
  value,
  active,
  hasError,
}: {
  value: string;
  active: boolean;
  hasError: boolean;
}) {
  const cells = value.split("").concat(Array(PIN_LENGTH - value.length).fill(""));
  return (
    <View style={ss.cellsRow}>
      {cells.map((d, i) => {
        const isFilled = i < value.length;
        const isActive = active && i === value.length;
        return (
          <View
            key={i}
            style={[
              ss.cellShell,
              {
                borderColor:     hasError ? D.error : isActive ? D.primary : isFilled ? D.navy + "60" : D.cardBorder,
                borderWidth:     isActive || hasError ? 2 : 1,
                backgroundColor: isActive ? D.primarySoft : D.white,
              },
            ]}
          >
            {/* Mask the entered PIN for privacy */}
            <Text style={ss.cellText}>{isFilled ? "•" : ""}</Text>
          </View>
        );
      })}
    </View>
  );
}

export default function CreatePinScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { phone } = useDriver();
  const params = useLocalSearchParams<{ next?: string }>();
  const nextRoute = typeof params.next === "string" && params.next.length > 0
    ? params.next
    : FALLBACK_ROUTE;

  const pinRef     = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [step,    setStep]    = useState<"create" | "confirm">("create");
  const [pin,     setPin]     = useState("");
  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [saving,  setSaving]  = useState(false);

  // Auto-focus the active field as the step changes.
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === "create") pinRef.current?.focus();
      else confirmRef.current?.focus();
    }, 250);
    return () => clearTimeout(t);
  }, [step]);

  function handlePinChange(t: string) {
    if (saving) return;
    setError("");
    const cleaned = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(cleaned);
    if (cleaned.length === PIN_LENGTH) setStep("confirm");
  }

  function handleConfirmChange(t: string) {
    if (saving) return;
    setError("");
    const cleaned = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setConfirm(cleaned);
    if (cleaned.length === PIN_LENGTH) void handleSave(cleaned);
  }

  function resetToCreate() {
    setPin("");
    setConfirm("");
    setError("");
    setStep("create");
  }

  async function handleSave(confirmValue: string) {
    if (saving) return;
    if (pin.length !== PIN_LENGTH) {
      setError("Please enter a 6-digit PIN.");
      resetToCreate();
      return;
    }
    if (confirmValue !== pin) {
      setError("PINs do not match. Try again.");
      setConfirm("");
      setTimeout(() => confirmRef.current?.focus(), 100);
      return;
    }

    setSaving(true);
    const result = await setPinApi(pin);
    setSaving(false);

    if (!result.ok) {
      setError(result.error ?? "Could not save PIN. Please try again.");
      setConfirm("");
      setTimeout(() => confirmRef.current?.focus(), 100);
      return;
    }

    // Single-device login — set-pin mints a NEW active session on the server,
    // superseding the one from verify-otp. This device MUST adopt the new session
    // id or the very next authenticated request 401s SESSION_REPLACED against
    // itself → the app auto-signs-out → bounces back to the OTP/login screen.
    let sessionAdopted = false;
    if (result.sessionId) {
      console.log("[create-pin] set-pin returned sessionId — adopting it");
      await setSessionId(result.sessionId);
      sessionAdopted = true;
    } else if (phone) {
      // Some backend builds return set-pin success WITHOUT the rotated session id.
      // The server session is now ahead of ours, so re-login with the PIN we just
      // set to obtain and adopt the current active session before navigating.
      console.warn("[create-pin] set-pin returned NO sessionId — re-syncing via verify-pin");
      const reSync = await verifyPinApi(phone, pin);
      if (reSync.ok && reSync.sessionId) {
        console.log("[create-pin] re-sync OK — adopted fresh session from verify-pin");
        await setSessionId(reSync.sessionId);
        sessionAdopted = true;
      } else {
        console.error("[create-pin] re-sync FAILED:", reSync.ok ? "no sessionId" : reSync.error);
      }
    }

    // Fail-safe: if we could not establish a current session, navigating forward
    // would 401 SESSION_REPLACED on the next request and bounce back to login.
    // Keep the driver on this screen with a retryable error instead of looping.
    if (!sessionAdopted) {
      setError("Couldn't finish setting up your PIN. Please try again.");
      setConfirm("");
      setTimeout(() => confirmRef.current?.focus(), 100);
      return;
    }

    // PIN saved + session in lockstep — continue the EXISTING onboarding/Home
    // routing unchanged.
    console.log("[create-pin] navigating forward to:", nextRoute);
    router.replace(nextRoute as never);
  }

  const canConfirmManually = step === "confirm" && confirm.length === PIN_LENGTH && !saving;

  return (
    <KeyboardAvoidingView
      style={ss.root}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          ss.scroll,
          { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
        overScrollMode="never"
      >
        {/* ── Branding ── */}
        <View style={ss.branding}>
          <View style={ss.logoCircle}>
            <Text style={ss.logoText}>BC</Text>
          </View>
          <Text style={ss.brandName}>
            <Text style={{ color: D.text }}>Bike</Text>
            <Text style={{ color: D.primary }}>Courier</Text>
          </Text>
          <Text style={ss.partnerLabel}>PARTNER</Text>
        </View>

        {/* ── Heading ── */}
        <View style={ss.header}>
          <View style={ss.lockBadge}>
            <Feather name="lock" size={22} color={D.primary} />
          </View>
          <Text style={ss.headline}>
            {step === "create" ? "Create a 6-digit PIN" : "Confirm your PIN"}
          </Text>
          <Text style={ss.subline}>
            {step === "create"
              ? "Set a PIN for faster, secure logins next time."
              : "Re-enter the 6-digit PIN to confirm."}
          </Text>
        </View>

        {/* ── PIN cells ── */}
        <Pressable
          onPress={() =>
            (step === "create" ? pinRef : confirmRef).current?.focus()
          }
        >
          <PinCells
            value={step === "create" ? pin : confirm}
            active={!saving}
            hasError={!!error}
          />
        </Pressable>

        {/* Hidden create input */}
        <TextInput
          ref={pinRef}
          value={pin}
          onChangeText={handlePinChange}
          keyboardType="number-pad"
          maxLength={PIN_LENGTH}
          style={ss.hiddenInput}
          caretHidden
          selectionColor="transparent"
          underlineColorAndroid="transparent"
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          autoCorrect={false}
          secureTextEntry
        />
        {/* Hidden confirm input */}
        <TextInput
          ref={confirmRef}
          value={confirm}
          onChangeText={handleConfirmChange}
          keyboardType="number-pad"
          maxLength={PIN_LENGTH}
          style={ss.hiddenInput}
          caretHidden
          selectionColor="transparent"
          underlineColorAndroid="transparent"
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
          autoCorrect={false}
          secureTextEntry
        />

        {/* Error */}
        {!!error && (
          <View style={ss.errRow}>
            <Feather name="alert-circle" size={13} color={D.error} />
            <Text style={ss.errText}>{error}</Text>
          </View>
        )}

        {/* Step actions */}
        {step === "confirm" && !saving && (
          <TouchableOpacity style={ss.changeBtn} onPress={resetToCreate} activeOpacity={0.7}>
            <Feather name="edit-2" size={13} color={D.textSecondary} />
            <Text style={ss.changeText}>Re-enter PIN</Text>
          </TouchableOpacity>
        )}

        {/* Primary button */}
        <TouchableOpacity
          style={[ss.saveBtn, !canConfirmManually && ss.saveBtnDisabled]}
          onPress={() => void handleSave(confirm)}
          activeOpacity={0.85}
          disabled={!canConfirmManually}
        >
          {saving ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator size="small" color={D.white} />
              <Text style={ss.saveBtnText}>Saving PIN...</Text>
            </View>
          ) : (
            <Text style={[ss.saveBtnText, !canConfirmManually && ss.saveBtnTextDisabled]}>
              {step === "create" ? "Enter PIN to continue" : "Save PIN & Continue"}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={ss.note}>
          Your PIN is encrypted and stored securely. You can still log in with OTP anytime.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const ss = StyleSheet.create({
  root:   { flex: 1, backgroundColor: D.bg },
  scroll: { flexGrow: 1, paddingHorizontal: 20 },

  branding:     { alignItems: "center", marginBottom: 24 },
  logoCircle:   {
    width: 64, height: 64, borderRadius: 32, backgroundColor: D.primary,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  logoText:     { color: D.white, fontSize: 22, fontWeight: "800", fontFamily: "Inter_700Bold" },
  brandName:    { fontSize: 20, fontWeight: "800", fontFamily: "Inter_700Bold" },
  partnerLabel: {
    fontSize: 11, letterSpacing: 3, color: D.textMuted, fontWeight: "700",
    fontFamily: "Inter_700Bold", marginTop: 2,
  },

  header:   { alignItems: "center", marginBottom: 28 },
  lockBadge: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: D.primarySoft,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
  },
  headline: {
    fontSize: 24, fontWeight: "800", color: D.text, fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  subline:  {
    fontSize: 14, color: D.textSecondary, fontFamily: "Inter_400Regular",
    textAlign: "center", marginTop: 8, paddingHorizontal: 16,
  },

  cellsRow:  { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 8 },
  cellShell: {
    width: CELL_W, height: CELL_W + 6, borderRadius: 14,
    alignItems: "center", justifyContent: "center",
  },
  cellText:  { fontSize: 28, fontWeight: "800", color: D.text, fontFamily: "Inter_700Bold" },

  hiddenInput: { position: "absolute", width: 1, height: 1, opacity: 0 },

  errRow:  { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "center", marginTop: 12 },
  errText: { color: D.error, fontSize: 13, fontFamily: "Inter_500Medium" },

  changeBtn:  { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginTop: 16, padding: 6 },
  changeText: { color: D.textSecondary, fontSize: 13, fontFamily: "Inter_500Medium" },

  saveBtn: {
    marginTop: 24, height: 56, borderRadius: 16, backgroundColor: D.primary,
    alignItems: "center", justifyContent: "center",
  },
  saveBtnDisabled:     { backgroundColor: D.border },
  saveBtnText:         { color: D.white, fontSize: 16, fontWeight: "700", fontFamily: "Inter_700Bold" },
  saveBtnTextDisabled: { color: D.textMuted },

  note: {
    fontSize: 12, color: D.textMuted, fontFamily: "Inter_400Regular",
    textAlign: "center", marginTop: 18, paddingHorizontal: 12, lineHeight: 18,
  },
});
