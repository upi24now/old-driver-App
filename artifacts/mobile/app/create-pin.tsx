/**
 * create-pin.tsx — post-OTP "Create 6-digit PIN" step.
 *
 * Shown ONLY to drivers who have just verified OTP and do not yet have a PIN.
 * This screen never replaces OTP login; it is injected by login.tsx between a
 * successful OTP verification and the existing onboarding/Home routing.
 *
 * Flow:
 *   Enter 6-digit PIN → Confirm 6-digit PIN → POST /auth/set-pin → confirmPin.
 * OTP only authorizes PIN setup; no full session exists yet (isOtpVerified is
 * false and /drivers/me has NOT been called). Only AFTER set-pin succeeds
 * (drivers.pin_hash true) does this screen call confirmPin to establish the full
 * session, fetch the profile, and route into the existing onboarding/Home flow.
 */

import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { setPin as setPinApi } from "@/utils/auth-api";
import { beginSessionRotation, endSessionRotation } from "@/utils/session";
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
  const { phone, confirmPin } = useDriver();

  // intent=create → brand-new PIN  (new driver, existing driver without PIN)
  // intent=reset  → replacing a PIN (forgot-PIN OTP flow)
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const isReset = intent === "reset";

  const pinRef     = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [step,    setStep]    = useState<"create" | "confirm">("create");
  const [pin,     setPin]     = useState("");
  const [confirm, setConfirm] = useState("");
  const [error,   setError]   = useState("");
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    console.log("[BUILD_SENTINEL] create-pin = ORDER-FIX build — set-pin runs BEFORE confirmPin/(drivers/me)");
    console.log("[FLOW] create-pin: screen mounted — phone:", phone ? "present" : "ABSENT");
  }, []);

  // Auto-focus the active field as the step changes.
  useEffect(() => {
    const t = setTimeout(() => {
      if (step === "create") pinRef.current?.focus();
      else confirmRef.current?.focus();
    }, 250);
    return () => clearTimeout(t);
  }, [step]);

  // NOTE: no auto-advance / auto-submit. Each step requires an explicit button
  // tap (Continue → Save) — matching the Customer App and the user requirement.
  function handlePinChange(t: string) {
    if (saving) return;
    setError("");
    const cleaned = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(cleaned);
  }

  function handleConfirmChange(t: string) {
    if (saving) return;
    setError("");
    const cleaned = t.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setConfirm(cleaned);
  }

  // Explicit primary action: on the "create" step it advances to "confirm";
  // on the "confirm" step it saves. Never fires automatically on the 6th digit.
  function handlePrimaryPress() {
    if (saving) return;
    if (step === "create") {
      if (pin.length !== PIN_LENGTH) return;
      setError("");
      setStep("confirm");
      return;
    }
    void handleSave(confirm);
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

    console.log("[FLOW] create-pin: set-pin request start");
    setSaving(true);
    // Suppress self-inflicted SESSION_REPLACED while set-pin rotates OUR session.
    // A background request (profile hydration / account-status poll) still in
    // flight with the OLD id would otherwise 401 → signOut → bounce to /login
    // mid-flow. We keep the guard up briefly AFTER adopting the new id so any
    // already-dispatched request resolving late is absorbed silently too.
    beginSessionRotation();
    try {
      const result = await setPinApi(pin);
      setSaving(false);
      console.log("[FLOW] create-pin: set-pin result — ok:", result.ok, "| sessionId returned:", result.ok ? !!result.sessionId : false, "| error:", result.ok ? "none" : result.error);

      if (!result.ok) {
        setError(result.error ?? "Could not save PIN. Please try again.");
        setConfirm("");
        setTimeout(() => confirmRef.current?.focus(), 100);
        return;
      }

      // ── set-pin succeeded → drivers.pin_hash is now true ────────────────────
      // ONLY NOW do we establish the full session: log in with the PIN we just
      // set. confirmPin runs verify-pin → adopts the freshly-minted single-device
      // session → fetches the driver profile (/drivers/me, the FIRST such call in
      // this flow) → computes the onboarding/Home route → sets isOtpVerified=true
      // (releasing the layout route-guard). This guarantees the required order:
      // verify-otp → set-pin → pin_hash true → /drivers/me.
      if (!phone) {
        // Phone is set during the OTP sign-in step; if it is somehow missing we
        // cannot re-login. Surface a retryable error rather than navigate into a
        // session that would 401 on the next request.
        setError("Couldn't finish setting up your PIN. Please try again.");
        setConfirm("");
        setTimeout(() => confirmRef.current?.focus(), 100);
        return;
      }

      console.log("[FLOW] create-pin: set-pin OK — establishing session via confirmPin (pin_hash now true)");
      const login = await confirmPin(phone, pin);
      console.log("[FLOW] create-pin: confirmPin result — ok:", login.ok, "| nextRoute:", login.nextRoute ?? "(derived)", "| error:", login.ok ? "none" : login.error);

      // Fail-safe: if the post-set-pin login could not complete, keep the driver
      // on this screen with a retryable error. The PIN is already saved, so they
      // can also simply return to login and sign in with it.
      if (!login.ok) {
        setError(login.error ?? "Couldn't finish setting up your PIN. Please try again.");
        setConfirm("");
        setTimeout(() => confirmRef.current?.focus(), 100);
        return;
      }

      // PIN saved + full session established — continue the EXISTING onboarding/
      // Home routing using the route confirmPin derived from the live profile.
      const next = login.nextRoute ?? (login.profileComplete ? "/(tabs)" : FALLBACK_ROUTE);
      console.log("[create-pin] navigating forward to:", next);
      router.replace(next as never);
    } finally {
      // Hold the suppression ~3 s past completion so late-arriving stale requests
      // (e.g. the in-flight account-status poll) don't bounce us after we leave.
      setTimeout(() => { endSessionRotation(); }, 3000);
    }
  }

  // Primary button is enabled only when the active step's 6 digits are entered.
  // It NEVER fires on its own — the driver must tap it (Continue → Save).
  const primaryEnabled = !saving && (
    step === "create"
      ? pin.length === PIN_LENGTH
      : confirm.length === PIN_LENGTH
  );

  return (
    <KeyboardAwareScrollViewCompat
      style={ss.root}
      contentContainerStyle={[
        ss.scroll,
        { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 },
      ]}
      bottomOffset={24}
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
            {step === "create"
              ? (isReset ? "Reset your PIN" : "Create a 6-digit PIN")
              : "Confirm your PIN"}
          </Text>
          <Text style={ss.subline}>
            {step === "create"
              ? (isReset
                  ? "Set a new 6-digit PIN to replace your existing one."
                  : "Set a PIN for faster, secure logins next time.")
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
          style={[ss.saveBtn, !primaryEnabled && ss.saveBtnDisabled]}
          onPress={handlePrimaryPress}
          activeOpacity={0.85}
          disabled={!primaryEnabled}
        >
          {saving ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator size="small" color={D.white} />
              <Text style={ss.saveBtnText}>Saving PIN...</Text>
            </View>
          ) : (
            <Text style={[ss.saveBtnText, !primaryEnabled && ss.saveBtnTextDisabled]}>
              {step === "create"
                ? "Continue"
                : (isReset ? "Reset PIN & Continue" : "Save PIN & Continue")}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={ss.note}>
          Your PIN is encrypted and stored securely. You can still log in with OTP anytime.
        </Text>
    </KeyboardAwareScrollViewCompat>
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
