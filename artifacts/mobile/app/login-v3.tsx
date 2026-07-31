/**
 * login-v3.tsx — Authentication V3: PIN-First Multi-Step Auth
 *
 * ╔══════════════════════════════════════════════════════╗
 * ║  AUTHENTICATION RULE (V3)                           ║
 * ║  Daily login = Mobile Number + PIN                  ║
 * ║  OTP is ONLY for: (1) New signup, (2) Forgot PIN    ║
 * ║  OTP is NEVER used for normal/returning driver login ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * Self-contained: zero B2 dependencies.
 * B2 integration happens only after V3 is fully tested.
 *
 * Steps handled in this single screen:
 *   PHONE_ENTRY       → enter phone; choose Login or Create Account
 *   PIN_ENTRY         → existing driver daily login via PIN
 *   FORGOT_PHONE      → confirm phone for PIN reset
 *   FORGOT_OTP        → OTP for PIN reset
 *   FORGOT_NEW_PIN    → enter new PIN
 *   FORGOT_CONFIRM    → confirm new PIN → login
 *   SIGNUP_FORM       → new driver details
 *   SIGNUP_OTP        → OTP for signup
 *   SIGNUP_NEW_PIN    → create PIN
 *   SIGNUP_CONFIRM    → confirm PIN → create account → login
 */

import React, { useRef, useState } from "react";
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
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { signInWithCustomToken } from "firebase/auth";

import { useAuthV3 } from "@/contexts/AuthV3Context";
import { callV3SessionRestoreHandler } from "@/utils/auth-v3-bridge";
import { setSessionId } from "@/utils/session";
import { firebaseAuth } from "@/utils/firebase";
import {
  v3SendOtp,
  v3VerifyOtp,
  v3VerifyPin,
  v3SetPin,
  v3CreateDriverAccount,
  V3_VEHICLES,
} from "@/utils/auth-v3-api";

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSION_KEY = "@bike_courier/session_verified_uid";
const PIN_LENGTH  = 6;
const OTP_LENGTH  = 6;

const C = {
  primary:    "#FF6B00",
  primarySoft: "#FFF3EC",
  pressed:    "#E55A00",
  bg:         "#FFFFFF",
  pageBg:     "#F5F4F2",
  text:       "#111111",
  sub:        "#374151",
  muted:      "#6B7280",
  placeholder:"#9CA3AF",
  border:     "#E5E7EB",
  error:      "#DC2626",
  success:    "#059669",
} as const;

const GENDERS = ["Male", "Female", "Other"] as const;
type Gender = (typeof GENDERS)[number] | "";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthStep =
  | "PHONE_ENTRY"
  | "PIN_ENTRY"
  | "FORGOT_PHONE"
  | "FORGOT_OTP"
  | "FORGOT_NEW_PIN"
  | "FORGOT_CONFIRM"
  | "SIGNUP_FORM"
  | "SIGNUP_OTP"
  | "SIGNUP_NEW_PIN"
  | "SIGNUP_CONFIRM";

interface FlowState {
  // ── Phone ────────────────────────────────────────────────────────
  phoneDigits:      string;   // 10 digits, no +91 prefix

  // ── PIN input (shared across login, forgot, signup) ───────────────
  pin:              string;   // digits 0–6 entered so far
  confirmPin:       string;   // for confirm step

  // ── OTP ──────────────────────────────────────────────────────────
  otpCode:          string;
  otpId:            string;

  // ── From OTP verify result ────────────────────────────────────────
  verifyToken:      string;
  verifySessionId:  string | null;

  // ── Signup form ───────────────────────────────────────────────────
  signupName:          string;
  signupCity:          string;
  signupGender:        Gender;
  signupVehicleId:     string;
  signupVehicleName:   string;
  signupLicenseNumber: string;
  signupVehicleNumber: string;
}

const INITIAL_FLOW: FlowState = {
  phoneDigits: "", pin: "", confirmPin: "",
  otpCode: "", otpId: "",
  verifyToken: "", verifySessionId: null,
  signupName: "", signupCity: "", signupGender: "",
  signupVehicleId: "", signupVehicleName: "",
  signupLicenseNumber: "", signupVehicleNumber: "",
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function LoginV3Screen() {
  const [step, setStep]   = useState<AuthStep>("PHONE_ENTRY");
  const [flow, setFlow]   = useState<FlowState>(INITIAL_FLOW);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState("");

  const authV3  = useAuthV3();
  const router  = useRouter();
  const insets  = useSafeAreaInsets();

  // ── Navigation helpers ─────────────────────────────────────────────────────

  const goTo = (s: AuthStep, patch?: Partial<FlowState>) => {
    setError("");
    setBusy(false);
    setFlow((f) => ({
      ...f,
      // clear pin fields when entering any PIN step
      pin:        ["PIN_ENTRY","FORGOT_NEW_PIN","SIGNUP_NEW_PIN"].includes(s) ? "" : f.pin,
      confirmPin: ["FORGOT_CONFIRM","SIGNUP_CONFIRM"].includes(s) ? "" : f.confirmPin,
      // clear OTP when entering OTP step
      otpCode:    ["FORGOT_OTP","SIGNUP_OTP"].includes(s) ? "" : f.otpCode,
      ...patch,
    }));
    setStep(s);
  };

  const goBack = () => {
    const prev: Partial<Record<AuthStep, AuthStep>> = {
      PIN_ENTRY:      "PHONE_ENTRY",
      FORGOT_PHONE:   "PIN_ENTRY",
      FORGOT_OTP:     "FORGOT_PHONE",
      FORGOT_NEW_PIN: "FORGOT_OTP",
      FORGOT_CONFIRM: "FORGOT_NEW_PIN",
      SIGNUP_FORM:    "PHONE_ENTRY",
      SIGNUP_OTP:     "SIGNUP_FORM",
      SIGNUP_NEW_PIN: "SIGNUP_OTP",
      SIGNUP_CONFIRM: "SIGNUP_NEW_PIN",
    };
    const p = prev[step];
    if (p) goTo(p);
  };

  // ── Session completion (shared by all flows) ───────────────────────────────

  const finishAuth = async (uid: string, phone: string, sessionId: string | null) => {
    if (sessionId) await setSessionId(sessionId);
    await AsyncStorage.setItem(SESSION_KEY, uid);
    authV3.endVerifySuccess(uid, phone);
    try {
      await callV3SessionRestoreHandler(uid, phone);
    } catch {
      // Bridge failed — fall back to tab navigation
      router.replace("/(tabs)" as never);
    }
  };

  // ── Action: existing driver PIN login ──────────────────────────────────────
  // `pinOverride` avoids stale-closure issues when called from an onDigit
  // callback before React has flushed the new flow.pin state update.

  const handlePinLogin = async (pinOverride?: string) => {
    const pin = pinOverride ?? flow.pin;
    if (busy || pin.length !== PIN_LENGTH) return;
    Keyboard.dismiss();
    setBusy(true);
    setError("");

    const phone = `+91${flow.phoneDigits}`;

    // Verify PIN via backend API (use the param, not flow.pin — avoids stale closure)
    const result = await v3VerifyPin(phone, pin);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      setFlow((f) => ({ ...f, pin: "" }));
      return;
    }

    // Guard Firebase from firing onAuthStateChanged into B2 during sign-in
    authV3.beginVerify();
    try {
      const cred = await signInWithCustomToken(firebaseAuth, result.token);
      await finishAuth(cred.user.uid, phone, result.sessionId);
    } catch {
      authV3.endVerifyFailure();
      setBusy(false);
      setError("Sign-in failed. Please try again.");
      setFlow((f) => ({ ...f, pin: "" }));
    }
  };

  // ── Action: send OTP (shared for forgot + signup) ──────────────────────────

  const handleSendOtp = async (phone: string, nextStep: AuthStep) => {
    if (busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError("");

    const result = await v3SendOtp(phone);
    setBusy(false);
    if (!result.ok) { setError(result.error); return; }
    goTo(nextStep, { otpId: result.otpId });
  };

  // ── Action: verify OTP (shared for forgot + signup) ───────────────────────

  const handleVerifyOtp = async (nextStep: AuthStep) => {
    if (busy || flow.otpCode.length !== OTP_LENGTH) return;
    Keyboard.dismiss();
    setBusy(true);
    setError("");

    const phone = `+91${flow.phoneDigits}`;
    const result = await v3VerifyOtp(phone, flow.otpCode);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      setFlow((f) => ({ ...f, otpCode: "" }));
      return;
    }
    goTo(nextStep, { verifyToken: result.token, verifySessionId: result.sessionId });
  };

  // ── Action: save PIN + complete login (forgot PIN path) ───────────────────

  const handleForgotPinComplete = async (pinOverride?: string, confirmOverride?: string) => {
    const pin        = pinOverride     ?? flow.pin;
    const confirmPin = confirmOverride ?? flow.confirmPin;
    if (busy || pin.length !== PIN_LENGTH) return;
    if (pin !== confirmPin) {
      setError("PINs don't match. Please try again.");
      setFlow((f) => ({ ...f, confirmPin: "" }));
      return;
    }
    setBusy(true);
    setError("");

    const phone = `+91${flow.phoneDigits}`;
    authV3.beginVerify();
    try {
      const cred    = await signInWithCustomToken(firebaseAuth, flow.verifyToken);
      const idToken = await cred.user.getIdToken();

      const pinResult = await v3SetPin(pin, idToken, flow.verifySessionId);
      if (!pinResult.ok) {
        authV3.endVerifyFailure();
        setBusy(false);
        setError(pinResult.error);
        return;
      }
      await finishAuth(cred.user.uid, phone, flow.verifySessionId);
    } catch {
      authV3.endVerifyFailure();
      setBusy(false);
      setError("Could not save PIN. Please try again.");
    }
  };

  // ── Action: save PIN + create account + login (signup path) ───────────────

  const handleSignupComplete = async (pinOverride?: string, confirmOverride?: string) => {
    const pin        = pinOverride     ?? flow.pin;
    const confirmPin = confirmOverride ?? flow.confirmPin;
    if (busy || pin.length !== PIN_LENGTH) return;
    if (pin !== confirmPin) {
      setError("PINs don't match. Please try again.");
      setFlow((f) => ({ ...f, confirmPin: "" }));
      return;
    }
    setBusy(true);
    setError("");

    const phone = `+91${flow.phoneDigits}`;
    authV3.beginVerify();
    try {
      const cred    = await signInWithCustomToken(firebaseAuth, flow.verifyToken);
      const idToken = await cred.user.getIdToken();

      // Save PIN
      const pinResult = await v3SetPin(pin, idToken, flow.verifySessionId);
      if (!pinResult.ok) {
        authV3.endVerifyFailure();
        setBusy(false);
        setError(pinResult.error);
        return;
      }

      // Create driver account
      const signupResult = await v3CreateDriverAccount({
        phone,
        name:          flow.signupName.trim(),
        city:          flow.signupCity.trim(),
        gender:        flow.signupGender,
        vehicleId:     flow.signupVehicleId,
        vehicleName:   flow.signupVehicleName,
        licenseNumber: flow.signupLicenseNumber.trim() || undefined,
        vehicleNumber: flow.signupVehicleNumber.trim() || undefined,
      });
      if (!signupResult.ok) {
        authV3.endVerifyFailure();
        setBusy(false);
        setError(signupResult.error ?? "Account creation failed. Please try again.");
        return;
      }

      await finishAuth(cred.user.uid, phone, flow.verifySessionId);
    } catch {
      authV3.endVerifyFailure();
      setBusy(false);
      setError("Sign-up failed. Please try again.");
    }
  };

  // ── Keypad input helper ────────────────────────────────────────────────────

  const appendPin = (digit: string, field: "pin" | "confirmPin") => {
    setError("");
    setFlow((f) => {
      const current = f[field];
      if (current.length >= PIN_LENGTH) return f;
      return { ...f, [field]: current + digit };
    });
  };

  const deletePin = (field: "pin" | "confirmPin") => {
    setFlow((f) => ({ ...f, [field]: f[field].slice(0, -1) }));
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const padTop    = insets.top + 16;
  const padBottom = insets.bottom + 16;

  switch (step) {

    // ── Phone entry ─────────────────────────────────────────────────────────
    case "PHONE_ENTRY":
      return (
        <PhoneEntryView
          phoneDigits={flow.phoneDigits}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onChangePhone={(v) => {
            setError("");
            setFlow((f) => ({ ...f, phoneDigits: v.replace(/\D/g, "").slice(0, 10) }));
          }}
          onLogin={() => {
            if (flow.phoneDigits.length !== 10) { setError("Enter a valid 10-digit mobile number."); return; }
            goTo("PIN_ENTRY");
          }}
          onCreateAccount={() => {
            if (flow.phoneDigits.length !== 10) { setError("Enter a valid 10-digit mobile number."); return; }
            goTo("SIGNUP_FORM");
          }}
        />
      );

    // ── PIN entry (daily login) ──────────────────────────────────────────────
    case "PIN_ENTRY":
      return (
        <PinFlowView
          title="Enter PIN"
          subtitle={`+91 ${flow.phoneDigits}`}
          pinValue={flow.pin}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onDigit={(d) => {
            // Compute next value locally to avoid stale-closure on auto-submit
            const next = (flow.pin + d).slice(0, PIN_LENGTH);
            setError("");
            setFlow((f) => ({ ...f, pin: next }));
            if (next.length === PIN_LENGTH) setTimeout(() => handlePinLogin(next), 80);
          }}
          onDelete={() => deletePin("pin")}
          onSubmit={() => handlePinLogin()}
          submitLabel="Login"
          footerNode={
            <Pressable
              style={ss.textLink}
              onPress={() => goTo("FORGOT_PHONE", { phoneDigits: flow.phoneDigits })}
            >
              <Text style={ss.textLinkLabel}>Forgot PIN?</Text>
            </Pressable>
          }
        />
      );

    // ── Forgot PIN: phone confirmation ───────────────────────────────────────
    case "FORGOT_PHONE":
      return (
        <PhoneEntryView
          title="Reset PIN"
          subtitle="Enter your registered number to receive an OTP."
          phoneDigits={flow.phoneDigits}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          showBack
          onBack={goBack}
          onChangePhone={(v) => {
            setError("");
            setFlow((f) => ({ ...f, phoneDigits: v.replace(/\D/g, "").slice(0, 10) }));
          }}
          onLogin={() => {
            const phone = `+91${flow.phoneDigits}`;
            handleSendOtp(phone, "FORGOT_OTP");
          }}
          loginLabel="Send OTP"
          hideCreateAccount
        />
      );

    // ── Forgot PIN: OTP verify ───────────────────────────────────────────────
    case "FORGOT_OTP":
      return (
        <OtpView
          title="Verify OTP"
          subtitle={`Code sent to +91 ${flow.phoneDigits}`}
          otpValue={flow.otpCode}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onChange={(v) => {
            setError("");
            setFlow((f) => ({ ...f, otpCode: v.replace(/\D/g, "").slice(0, OTP_LENGTH) }));
            if (v.length === OTP_LENGTH) handleVerifyOtp("FORGOT_NEW_PIN");
          }}
          onVerify={() => handleVerifyOtp("FORGOT_NEW_PIN")}
          onResend={() => handleSendOtp(`+91${flow.phoneDigits}`, "FORGOT_OTP")}
        />
      );

    // ── Forgot PIN: new PIN ──────────────────────────────────────────────────
    case "FORGOT_NEW_PIN":
      return (
        <PinFlowView
          title="Create New PIN"
          subtitle="Set a 6-digit PIN to secure your account."
          pinValue={flow.pin}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onDigit={(d) => {
            const next = (flow.pin + d).slice(0, PIN_LENGTH);
            setError("");
            setFlow((f) => ({ ...f, pin: next }));
            if (next.length === PIN_LENGTH) setTimeout(() => goTo("FORGOT_CONFIRM"), 120);
          }}
          onDelete={() => deletePin("pin")}
          onSubmit={() => { if (flow.pin.length === PIN_LENGTH) goTo("FORGOT_CONFIRM"); }}
          submitLabel="Next"
        />
      );

    // ── Forgot PIN: confirm PIN ──────────────────────────────────────────────
    case "FORGOT_CONFIRM":
      return (
        <PinFlowView
          title="Confirm PIN"
          subtitle="Re-enter your new 6-digit PIN."
          pinValue={flow.confirmPin}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onDigit={(d) => {
            const next = (flow.confirmPin + d).slice(0, PIN_LENGTH);
            setError("");
            setFlow((f) => ({ ...f, confirmPin: next }));
            // Pass both current pin + new confirmPin to avoid stale closure
            if (next.length === PIN_LENGTH) setTimeout(() => handleForgotPinComplete(flow.pin, next), 80);
          }}
          onDelete={() => deletePin("confirmPin")}
          onSubmit={() => handleForgotPinComplete()}
          submitLabel="Save PIN"
        />
      );

    // ── Signup: form ─────────────────────────────────────────────────────────
    case "SIGNUP_FORM":
      return (
        <SignupFormView
          flow={flow}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onChange={(patch) => { setError(""); setFlow((f) => ({ ...f, ...patch })); }}
          onSubmit={() => {
            const { signupName, signupCity, signupGender, signupVehicleId, phoneDigits } = flow;
            if (!signupName.trim())    { setError("Please enter your full name."); return; }
            if (!signupCity.trim())    { setError("Please enter your city."); return; }
            if (phoneDigits.length !== 10) { setError("Enter a valid 10-digit mobile number."); return; }
            if (!signupGender)         { setError("Please select your gender."); return; }
            if (!signupVehicleId)      { setError("Please select your vehicle type."); return; }
            handleSendOtp(`+91${phoneDigits}`, "SIGNUP_OTP");
          }}
        />
      );

    // ── Signup: OTP verify ───────────────────────────────────────────────────
    case "SIGNUP_OTP":
      return (
        <OtpView
          title="Verify OTP"
          subtitle={`Code sent to +91 ${flow.phoneDigits}`}
          otpValue={flow.otpCode}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onChange={(v) => {
            setError("");
            setFlow((f) => ({ ...f, otpCode: v.replace(/\D/g, "").slice(0, OTP_LENGTH) }));
            if (v.length === OTP_LENGTH) handleVerifyOtp("SIGNUP_NEW_PIN");
          }}
          onVerify={() => handleVerifyOtp("SIGNUP_NEW_PIN")}
          onResend={() => handleSendOtp(`+91${flow.phoneDigits}`, "SIGNUP_OTP")}
        />
      );

    // ── Signup: create PIN ───────────────────────────────────────────────────
    case "SIGNUP_NEW_PIN":
      return (
        <PinFlowView
          title="Create PIN"
          subtitle="Set a 6-digit PIN to secure your account."
          pinValue={flow.pin}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onDigit={(d) => {
            const next = (flow.pin + d).slice(0, PIN_LENGTH);
            setError("");
            setFlow((f) => ({ ...f, pin: next }));
            if (next.length === PIN_LENGTH) setTimeout(() => goTo("SIGNUP_CONFIRM"), 120);
          }}
          onDelete={() => deletePin("pin")}
          onSubmit={() => { if (flow.pin.length === PIN_LENGTH) goTo("SIGNUP_CONFIRM"); }}
          submitLabel="Next"
        />
      );

    // ── Signup: confirm PIN ──────────────────────────────────────────────────
    case "SIGNUP_CONFIRM":
      return (
        <PinFlowView
          title="Confirm PIN"
          subtitle="Re-enter your 6-digit PIN."
          pinValue={flow.confirmPin}
          busy={busy}
          error={error}
          padTop={padTop}
          padBottom={padBottom}
          onBack={goBack}
          onDigit={(d) => {
            const next = (flow.confirmPin + d).slice(0, PIN_LENGTH);
            setError("");
            setFlow((f) => ({ ...f, confirmPin: next }));
            if (next.length === PIN_LENGTH) setTimeout(() => handleSignupComplete(flow.pin, next), 80);
          }}
          onDelete={() => deletePin("confirmPin")}
          onSubmit={() => handleSignupComplete()}
          submitLabel="Create Account"
        />
      );
  }
}

// ─── Sub-view: Phone Entry ────────────────────────────────────────────────────

interface PhoneEntryProps {
  title?: string;
  subtitle?: string;
  phoneDigits: string;
  busy: boolean;
  error: string;
  padTop: number;
  padBottom: number;
  showBack?: boolean;
  onBack?: () => void;
  onChangePhone: (v: string) => void;
  onLogin: () => void;
  loginLabel?: string;
  hideCreateAccount?: boolean;
  onCreateAccount?: () => void;
}

function PhoneEntryView({
  title = "Welcome Back",
  subtitle = "Enter your mobile number to continue.",
  phoneDigits, busy, error, padTop, padBottom,
  showBack, onBack, onChangePhone, onLogin,
  loginLabel = "Login", hideCreateAccount, onCreateAccount,
}: PhoneEntryProps) {
  const inputRef = useRef<TextInput>(null);
  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[ss.flex, ss.bgWhite]}
        contentContainerStyle={[ss.scrollContent, { paddingTop: padTop, paddingBottom: padBottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {showBack && (
          <Pressable style={ss.backBtn} onPress={onBack}>
            <Text style={ss.backLabel}>← Back</Text>
          </Pressable>
        )}

        {/* Brand mark */}
        <View style={ss.brandRow}>
          <View style={ss.brandDot} />
          <Text style={ss.brandText}>Bike Courier</Text>
        </View>

        <Text style={ss.heading}>{title}</Text>
        <Text style={ss.subText}>{subtitle}</Text>

        {/* Phone input */}
        <Text style={ss.fieldLabel}>Mobile Number</Text>
        <Pressable style={ss.phoneRow} onPress={() => inputRef.current?.focus()}>
          <View style={ss.prefix}><Text style={ss.prefixText}>+91</Text></View>
          <TextInput
            ref={inputRef}
            style={ss.phoneInput}
            value={phoneDigits}
            onChangeText={onChangePhone}
            placeholder="10-digit number"
            placeholderTextColor={C.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={onLogin}
            autoFocus
          />
        </Pressable>

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (busy || phoneDigits.length !== 10) && ss.btnDisabled]}
          onPress={onLogin}
          disabled={busy || phoneDigits.length !== 10}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>{loginLabel}</Text>}
        </Pressable>

        {!hideCreateAccount && onCreateAccount && (
          <>
            <View style={ss.divider}>
              <View style={ss.dividerLine} />
              <Text style={ss.dividerLabel}>or</Text>
              <View style={ss.dividerLine} />
            </View>
            <Pressable
              style={[ss.outlineBtn, busy && ss.btnDisabled]}
              onPress={onCreateAccount}
              disabled={busy}
            >
              <Text style={ss.outlineBtnLabel}>Create New Account</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-view: PIN Flow (entry + create + confirm) ────────────────────────────

interface PinFlowProps {
  title: string;
  subtitle?: string;
  pinValue: string;
  busy: boolean;
  error: string;
  padTop: number;
  padBottom: number;
  onBack: () => void;
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSubmit: () => void;
  submitLabel: string;
  footerNode?: React.ReactNode;
}

function PinFlowView({
  title, subtitle, pinValue, busy, error, padTop, padBottom,
  onBack, onDigit, onDelete, onSubmit, submitLabel, footerNode,
}: PinFlowProps) {
  return (
    <View style={[ss.flex, ss.bgWhite]}>
      {/* Header */}
      <View style={[ss.pinHeader, { paddingTop: padTop }]}>
        <Pressable style={ss.backBtn} onPress={onBack}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>
        <Text style={ss.heading}>{title}</Text>
        {!!subtitle && <Text style={ss.subText}>{subtitle}</Text>}
      </View>

      {/* PIN dots */}
      <View style={ss.dotsRow}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[ss.dot, i < pinValue.length ? ss.dotFilled : ss.dotEmpty]}
          />
        ))}
      </View>

      {!!error && <Text style={[ss.errorText, ss.errorCenter]}>{error}</Text>}

      {/* Numeric keypad */}
      <View style={ss.keypadWrap}>
        <NumPad
          onDigit={onDigit}
          onDelete={onDelete}
          disabled={busy || pinValue.length >= PIN_LENGTH}
        />
      </View>

      {/* Submit button */}
      <View style={[ss.pinFooter, { paddingBottom: padBottom }]}>
        {footerNode}
        <Pressable
          style={[ss.primaryBtn, (busy || pinValue.length !== PIN_LENGTH) && ss.btnDisabled]}
          onPress={onSubmit}
          disabled={busy || pinValue.length !== PIN_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>{submitLabel}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ─── Sub-view: OTP Verify ─────────────────────────────────────────────────────

interface OtpViewProps {
  title: string;
  subtitle: string;
  otpValue: string;
  busy: boolean;
  error: string;
  padTop: number;
  padBottom: number;
  onBack: () => void;
  onChange: (v: string) => void;
  onVerify: () => void;
  onResend: () => void;
}

function OtpView({
  title, subtitle, otpValue, busy, error, padTop, padBottom,
  onBack, onChange, onVerify, onResend,
}: OtpViewProps) {
  const inputRef = useRef<TextInput>(null);
  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[ss.flex, ss.bgWhite]}
        contentContainerStyle={[ss.scrollContent, { paddingTop: padTop, paddingBottom: padBottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={ss.backBtn} onPress={onBack}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>{title}</Text>
        <Text style={ss.subText}>{subtitle}</Text>

        {/* OTP boxes */}
        <Pressable style={ss.otpRow} onPress={() => inputRef.current?.focus()}>
          {Array.from({ length: OTP_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                ss.otpBox,
                i < otpValue.length && ss.otpBoxFilled,
                i === otpValue.length && ss.otpBoxActive,
              ]}
            >
              <Text style={ss.otpChar}>{otpValue[i] ?? ""}</Text>
            </View>
          ))}
        </Pressable>

        {/* Hidden input to trigger keyboard */}
        <TextInput
          ref={inputRef}
          style={ss.hiddenInput}
          value={otpValue}
          onChangeText={onChange}
          keyboardType="number-pad"
          maxLength={OTP_LENGTH}
          editable={!busy}
          autoFocus
          caretHidden
        />

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (busy || otpValue.length !== OTP_LENGTH) && ss.btnDisabled]}
          onPress={onVerify}
          disabled={busy || otpValue.length !== OTP_LENGTH}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Verify OTP</Text>}
        </Pressable>

        <View style={ss.resendRow}>
          <Text style={ss.resendLabel}>Didn't receive the code? </Text>
          <Pressable onPress={onResend} disabled={busy}>
            <Text style={[ss.textLinkLabel, busy && { opacity: 0.4 }]}>Resend</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-view: Signup Form ────────────────────────────────────────────────────

interface SignupFormProps {
  flow: FlowState;
  busy: boolean;
  error: string;
  padTop: number;
  padBottom: number;
  onBack: () => void;
  onChange: (patch: Partial<FlowState>) => void;
  onSubmit: () => void;
}

function SignupFormView({ flow, busy, error, padTop, padBottom, onBack, onChange, onSubmit }: SignupFormProps) {
  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={[ss.flex, ss.bgWhite]}
        contentContainerStyle={[ss.scrollContent, { paddingTop: padTop, paddingBottom: padBottom }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={ss.backBtn} onPress={onBack}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Create Account</Text>
        <Text style={ss.subText}>Fill in your details to get started.</Text>

        {/* Name */}
        <Text style={ss.fieldLabel}>Full Name</Text>
        <TextInput
          style={ss.textInput}
          value={flow.signupName}
          onChangeText={(v) => onChange({ signupName: v })}
          placeholder="Your full name"
          placeholderTextColor={C.placeholder}
          editable={!busy}
          autoCapitalize="words"
        />

        {/* City */}
        <Text style={ss.fieldLabel}>City</Text>
        <TextInput
          style={ss.textInput}
          value={flow.signupCity}
          onChangeText={(v) => onChange({ signupCity: v })}
          placeholder="Your city"
          placeholderTextColor={C.placeholder}
          editable={!busy}
          autoCapitalize="words"
        />

        {/* Phone */}
        <Text style={ss.fieldLabel}>Mobile Number</Text>
        <View style={ss.phoneRow}>
          <View style={ss.prefix}><Text style={ss.prefixText}>+91</Text></View>
          <TextInput
            style={ss.phoneInput}
            value={flow.phoneDigits}
            onChangeText={(v) => onChange({ phoneDigits: v.replace(/\D/g, "").slice(0, 10) })}
            placeholder="10-digit number"
            placeholderTextColor={C.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            editable={!busy}
          />
        </View>

        {/* Gender */}
        <Text style={ss.fieldLabel}>Gender</Text>
        <View style={ss.chipRow}>
          {GENDERS.map((g) => (
            <Pressable
              key={g}
              style={[ss.chip, flow.signupGender === g && ss.chipSelected]}
              onPress={() => onChange({ signupGender: g })}
              disabled={busy}
            >
              <Text style={[ss.chipLabel, flow.signupGender === g && ss.chipLabelSelected]}>{g}</Text>
            </Pressable>
          ))}
        </View>

        {/* Vehicle type */}
        <Text style={ss.fieldLabel}>Vehicle Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={ss.vehicleScroll}>
          {V3_VEHICLES.map((v) => (
            <Pressable
              key={v.id}
              style={[ss.chip, flow.signupVehicleId === v.id && ss.chipSelected, { marginRight: 8 }]}
              onPress={() => onChange({ signupVehicleId: v.id, signupVehicleName: v.name })}
              disabled={busy}
            >
              <Text style={[ss.chipLabel, flow.signupVehicleId === v.id && ss.chipLabelSelected]}>{v.name}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Optional fields */}
        <Text style={ss.fieldLabel}>License Number <Text style={ss.optional}>(optional)</Text></Text>
        <TextInput
          style={ss.textInput}
          value={flow.signupLicenseNumber}
          onChangeText={(v) => onChange({ signupLicenseNumber: v.toUpperCase() })}
          placeholder="e.g. KA01 20230012345"
          placeholderTextColor={C.placeholder}
          editable={!busy}
          autoCapitalize="characters"
        />

        <Text style={ss.fieldLabel}>Vehicle Number <Text style={ss.optional}>(optional)</Text></Text>
        <TextInput
          style={ss.textInput}
          value={flow.signupVehicleNumber}
          onChangeText={(v) => onChange({ signupVehicleNumber: v.toUpperCase() })}
          placeholder="e.g. KA01AB1234"
          placeholderTextColor={C.placeholder}
          editable={!busy}
          autoCapitalize="characters"
        />

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, busy && ss.btnDisabled]}
          onPress={onSubmit}
          disabled={busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Send OTP →</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// ─── Sub-component: Numeric Keypad ────────────────────────────────────────────

interface NumPadProps {
  onDigit: (d: string) => void;
  onDelete: () => void;
  disabled?: boolean;
}

const NUMPAD_ROWS = [["1","2","3"],["4","5","6"],["7","8","9"],["","0","⌫"]];

function NumPad({ onDigit, onDelete, disabled }: NumPadProps) {
  return (
    <View style={ss.numpad}>
      {NUMPAD_ROWS.map((row, ri) => (
        <View key={ri} style={ss.numpadRow}>
          {row.map((key, ki) => {
            if (!key) return <View key={ki} style={ss.numpadKeyEmpty} />;
            const isDelete = key === "⌫";
            return (
              <Pressable
                key={ki}
                style={({ pressed }) => [
                  ss.numpadKey,
                  pressed && !disabled && ss.numpadKeyPressed,
                  disabled && ss.numpadKeyDisabled,
                ]}
                onPress={() => isDelete ? onDelete() : onDigit(key)}
                disabled={disabled}
              >
                <Text style={[ss.numpadLabel, isDelete && ss.numpadDelete]}>{key}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  flex:           { flex: 1 },
  bgWhite:        { backgroundColor: C.bg },

  // Scroll layouts
  scrollContent:  { flexGrow: 1, paddingHorizontal: 24 },

  // Back button
  backBtn:        { alignSelf: "flex-start", marginBottom: 24 },
  backLabel:      { color: C.muted, fontSize: 15, fontWeight: "500" },

  // Brand mark
  brandRow:       { flexDirection: "row", alignItems: "center", marginBottom: 32, gap: 8 },
  brandDot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary },
  brandText:      { fontSize: 14, fontWeight: "700", color: C.primary, letterSpacing: 0.5 },

  // Typography
  heading:        { fontSize: 28, fontWeight: "700", color: C.text, marginBottom: 8 },
  subText:        { fontSize: 15, color: C.muted, marginBottom: 28, lineHeight: 22 },
  fieldLabel:     { fontSize: 14, fontWeight: "600", color: C.sub, marginBottom: 8 },
  optional:       { fontWeight: "400", color: C.muted },

  // Phone input
  phoneRow:       {
    flexDirection: "row", borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, overflow: "hidden", height: 54, marginBottom: 20,
  },
  prefix:         {
    width: 60, alignItems: "center", justifyContent: "center",
    borderRightWidth: 1, borderRightColor: C.border, backgroundColor: "#F9FAFB",
  },
  prefixText:     { fontSize: 15, fontWeight: "600", color: C.text },
  phoneInput:     { flex: 1, fontSize: 16, color: C.text, paddingHorizontal: 14 },

  // Text input (generic)
  textInput:      {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    height: 54, paddingHorizontal: 16, fontSize: 15, color: C.text, marginBottom: 16,
  },

  // Buttons
  primaryBtn:     {
    height: 54, borderRadius: 14, backgroundColor: C.primary,
    alignItems: "center", justifyContent: "center", marginTop: 8,
  },
  primaryBtnLabel: { color: "#fff", fontSize: 16, fontWeight: "700" },
  outlineBtn:     {
    height: 54, borderRadius: 14, borderWidth: 1.5, borderColor: C.primary,
    alignItems: "center", justifyContent: "center",
  },
  outlineBtnLabel: { color: C.primary, fontSize: 16, fontWeight: "700" },
  btnDisabled:    { opacity: 0.45 },

  // Divider
  divider:        { flexDirection: "row", alignItems: "center", marginVertical: 20, gap: 10 },
  dividerLine:    { flex: 1, height: 1, backgroundColor: C.border },
  dividerLabel:   { color: C.muted, fontSize: 14, fontWeight: "500" },

  // Error
  errorText:      { color: C.error, fontSize: 14, marginBottom: 12 },
  errorCenter:    { textAlign: "center" },

  // Text link
  textLink:       { alignSelf: "center", paddingVertical: 12 },
  textLinkLabel:  { color: C.primary, fontSize: 15, fontWeight: "600" },

  // PIN screen layout
  pinHeader:      { paddingHorizontal: 24, paddingBottom: 8 },
  dotsRow:        { flexDirection: "row", justifyContent: "center", gap: 16, marginVertical: 36 },
  dot:            { width: 18, height: 18, borderRadius: 9 },
  dotEmpty:       { backgroundColor: C.border },
  dotFilled:      { backgroundColor: C.primary },
  keypadWrap:     { flex: 1, justifyContent: "center" },
  pinFooter:      { paddingHorizontal: 24, gap: 4 },

  // Numeric keypad
  numpad:         { paddingHorizontal: 32, gap: 12 },
  numpadRow:      { flexDirection: "row", justifyContent: "space-between" },
  numpadKey:      {
    width: 72, height: 72, borderRadius: 36, backgroundColor: "#F5F4F2",
    alignItems: "center", justifyContent: "center",
  },
  numpadKeyEmpty: { width: 72, height: 72 },
  numpadKeyPressed:  { backgroundColor: "#E5E7EB" },
  numpadKeyDisabled: { opacity: 0.4 },
  numpadLabel:    { fontSize: 22, fontWeight: "600", color: C.text },
  numpadDelete:   { fontSize: 20, color: C.muted },

  // OTP boxes
  otpRow:         { flexDirection: "row", justifyContent: "space-between", marginVertical: 28 },
  otpBox:         {
    width: 46, height: 56, borderRadius: 10, borderWidth: 1.5,
    borderColor: C.border, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F9FAFB",
  },
  otpBoxFilled:   { borderColor: C.primary, backgroundColor: C.primarySoft },
  otpBoxActive:   { borderColor: C.primary },
  otpChar:        { fontSize: 22, fontWeight: "700", color: C.text },
  hiddenInput:    { position: "absolute", opacity: 0, height: 0, width: 0 },

  // Resend OTP
  resendRow:      { flexDirection: "row", justifyContent: "center", marginTop: 20, alignItems: "center" },
  resendLabel:    { color: C.muted, fontSize: 14 },

  // Gender / vehicle chips
  chipRow:        { flexDirection: "row", gap: 10, marginBottom: 20, flexWrap: "wrap" },
  vehicleScroll:  { marginBottom: 16 },
  chip:           {
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: "#F9FAFB",
  },
  chipSelected:   { borderColor: C.primary, backgroundColor: C.primarySoft },
  chipLabel:      { fontSize: 14, fontWeight: "500", color: C.sub },
  chipLabelSelected: { color: C.primary, fontWeight: "700" },
});
