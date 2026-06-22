/**
 * registration.tsx — Driver Registration (Screen 2 of 3)
 *
 * Single scrollable form: Profile · Vehicle · Documents · Payment
 * Flow: /otp → /registration → /verification-pending
 *
 * APIs called on submit (in order):
 *   1. uploadDocumentImage × N   — upload local images to VPS
 *   2. registerDriverKeys        — duplicate key check
 *   3. patchDriverVehicle        — persist vehicle selection
 *   4. patchDriverProfile        — persist profile fields
 *   5. submitDocumentsToPostgres — submit KYC docs + mark pending
 *   6. (if fee) create-order     — Razorpay order
 *   7. (if fee) verify-payment   — verify Razorpay HMAC → /verification-pending
 *
 * DO NOT TOUCH: OTP auth logic, verification status polling,
 *               profile-api / driver-api / storage internals.
 */

import { SafeInlineIcon, type SafeIconName } from "@/components/SafeIcon";
import { RazorpayWebCheckout, type RazorpayCheckoutParams } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { registerDriverKeys, submitDocumentsToPostgres } from "@/utils/driver-api";
import { firebaseAuth } from "@/utils/firebase";
import { getOnboardingFeeConfig } from "@/utils/firestore";
import { patchDriverProfile, patchDriverVehicle } from "@/utils/profile-api";
import { uploadDocumentImage, isRemoteUrl } from "@/utils/storage";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// ─── Design tokens ────────────────────────────────────────────────────────────
const D = {
  bg:          "#F8F9FA",
  white:       "#FFFFFF",
  primary:     "#F59E0B",
  primarySoft: "#FFFBEB",
  primaryBold: "#D97706",
  success:     "#10B981",
  successSoft: "#D1FAE5",
  error:       "#EF4444",
  errorSoft:   "#FEE2E2",
  textDark:    "#111827",
  textMid:     "#374151",
  textMuted:   "#6B7280",
  border:      "#E5E7EB",
  muted:       "#F3F4F6",
  placeholder: "#9CA3AF",
} as const;

const REGISTRATION_FEE = 10;
const API_BASE = (() => {
  const d = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
  return d ? `https://${d}/api` : "/api";
})();

// ─── Data constants ───────────────────────────────────────────────────────────
const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Surat",
];

const GENDERS = ["Male", "Female", "Other"] as const;

type VehicleOption = { id: string; name: string; icon: SafeIconName };
const VEHICLES: VehicleOption[] = [
  { id: "bike",        name: "Bike",         icon: "bike"    },
  { id: "scooter",     name: "Scooter",      icon: "scooter" },
  { id: "auto-pass",   name: "Auto (Pass)",  icon: "auto"    },
  { id: "auto-cargo",  name: "Auto (Cargo)", icon: "auto"    },
  { id: "mini-car",    name: "Mini Car",     icon: "car"     },
  { id: "sedan",       name: "Sedan",        icon: "car"     },
  { id: "suv",         name: "SUV",          icon: "car"     },
  { id: "tata-ace",    name: "Tata Ace",     icon: "truck"   },
  { id: "pickup",      name: "Pickup",       icon: "truck"   },
  { id: "mini-truck",  name: "Mini Truck",   icon: "truck"   },
  { id: "eicher",      name: "Eicher",       icon: "truck"   },
  { id: "truck-14ft",  name: "14ft Truck",   icon: "truck"   },
];

// ─── Validation ───────────────────────────────────────────────────────────────
function validateAadhaar(s: string): string | null {
  const clean = s.replace(/\s/g, "");
  if (!clean) return "Aadhaar number is required";
  if (!/^\d{12}$/.test(clean)) return "Must be exactly 12 digits";
  return null;
}
function validatePAN(s: string): string | null {
  const clean = s.trim().toUpperCase();
  if (!clean) return "PAN number is required";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean)) return "Format: ABCDE1234F";
  return null;
}

// ─── DOB formatter ────────────────────────────────────────────────────────────
function formatDob(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} / ${d.slice(2)}`;
  return `${d.slice(0, 2)} / ${d.slice(2, 4)} / ${d.slice(4)}`;
}

// ─── Image picker helper ──────────────────────────────────────────────────────
async function requestCamera(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  Alert.alert(
    "Camera permission required",
    canAskAgain
      ? "Please allow camera access."
      : "Camera access is blocked. Open Settings → App → Permissions → Camera.",
    [{ text: "OK" }],
  );
  return false;
}
async function requestGallery(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status === "granted") return true;
  Alert.alert(
    "Photos permission required",
    canAskAgain
      ? "Please allow photo library access."
      : "Photo access is blocked. Open Settings → App → Permissions → Photos.",
    [{ text: "OK" }],
  );
  return false;
}

function pickImage(front = false): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.alert(
      "Add Photo",
      "Choose source",
      [
        {
          text: front ? "Take Selfie (Front Camera)" : "Take Photo (Camera)",
          onPress: async () => {
            if (!(await requestCamera())) { resolve(null); return; }
            try {
              const r = await ImagePicker.launchCameraAsync({
                cameraType: front ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.85,
              });
              resolve(r.canceled || !r.assets?.length ? null : (r.assets[0]?.uri ?? null));
            } catch { resolve(null); }
          },
        },
        {
          text: "Choose from Gallery",
          onPress: async () => {
            if (!(await requestGallery())) { resolve(null); return; }
            try {
              const r = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ["images"],
                allowsEditing: false,
                quality: 0.85,
              });
              resolve(r.canceled || !r.assets?.length ? null : (r.assets[0]?.uri ?? null));
            } catch { resolve(null); }
          },
        },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

// ─── DocSlot — compact document upload tile ───────────────────────────────────
function DocSlot({
  label, uri, loading, onPress,
}: {
  label:   string;
  uri:     string | null;
  loading?: boolean;
  onPress: () => void;
}) {
  const uploaded = !!uri;
  return (
    <TouchableOpacity
      style={[
        ss.docSlot,
        uploaded
          ? { borderColor: D.success, backgroundColor: D.successSoft }
          : { borderColor: D.border, backgroundColor: D.muted },
      ]}
      onPress={onPress}
      activeOpacity={0.75}
      disabled={loading}
    >
      {loading ? (
        <ActivityIndicator size="small" color={D.primary} />
      ) : uri ? (
        <Image source={{ uri }} style={ss.docThumb} contentFit="cover" transition={150} />
      ) : (
        <SafeInlineIcon name="camera" size={20} color={D.textMuted} />
      )}
      <Text
        style={[ss.docLabel, { color: uploaded ? D.success : D.textMuted }]}
        numberOfLines={2}
      >
        {uploaded ? "✓ " : ""}{label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── SectionHeader ────────────────────────────────────────────────────────────
function SectionHeader({
  step, title, complete, total,
}: {
  step:     number;
  title:    string;
  complete: number;
  total:    number;
}) {
  const done = complete >= total;
  return (
    <View style={ss.sectionHeader}>
      <View style={[ss.stepBadge, { backgroundColor: done ? D.success : D.primary }]}>
        <Text style={ss.stepBadgeText}>{step}</Text>
      </View>
      <Text style={ss.sectionTitle}>{title}</Text>
      <View style={[ss.sectionPill, { backgroundColor: done ? D.successSoft : D.primarySoft }]}>
        <Text style={[ss.sectionPillText, { color: done ? D.success : D.primary }]}>
          {complete}/{total}
        </Text>
      </View>
    </View>
  );
}

// ─── FieldInput ───────────────────────────────────────────────────────────────
function FieldInput({
  label, value, onChangeText, placeholder,
  keyboardType, autoCapitalize, maxLength, required, error,
}: {
  label:           string;
  value:           string;
  onChangeText:    (t: string) => void;
  placeholder:     string;
  keyboardType?:   "default" | "numeric" | "email-address";
  autoCapitalize?: "none" | "words" | "characters";
  maxLength?:      number;
  required?:       boolean;
  error?:          string | null;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={ss.fieldGroup}>
      <Text style={ss.fieldLabel}>
        {label}
        {required && <Text style={{ color: D.error }}> *</Text>}
      </Text>
      <TextInput
        style={[
          ss.textInput,
          {
            borderColor:     error ? D.error : focused ? D.primary : D.border,
            backgroundColor: focused ? D.primarySoft : D.muted,
            color:           D.textDark,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={D.placeholder}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        maxLength={maxLength}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {error ? <Text style={ss.fieldError}>{error}</Text> : null}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function RegistrationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    driverUid,
    phone,
    vehicle:                ctxVehicle,
    profile:                ctxProfile,
    setVehicle,
    setProfile,
    onboardingFeeApplies,
    onboardingFeeAmount,
    markOnboardingFeePaidLocally,
  } = useDriver();

  // ── Profile ────────────────────────────────────────────────────────────────
  const [selfie,     setSelfie]     = useState<string | null>(null);
  const [selfieLoad, setSelfieLoad] = useState(false);
  const [name,       setName]       = useState(ctxProfile?.name   ?? "");
  const [city,       setCity]       = useState(ctxProfile?.city   ?? "");
  const [cityOpen,   setCityOpen]   = useState(false);
  const [dob,        setDob]        = useState("");
  const [gender,     setGender]     = useState(ctxProfile?.gender ?? "");

  // ── Vehicle ────────────────────────────────────────────────────────────────
  const [vehicleId,   setVehicleId]   = useState(ctxVehicle?.id   ?? "");
  const [vehicleName, setVehicleName] = useState(ctxVehicle?.name ?? "");
  const [vehicleNum,  setVehicleNum]  = useState(ctxProfile?.vehicleNumber  ?? "");
  const [dlNumber,    setDlNumber]    = useState(ctxProfile?.licenseNumber  ?? "");

  // ── Documents ──────────────────────────────────────────────────────────────
  const [aadhaarFront, setAadhaarFront] = useState<string | null>(null);
  const [aadhaarBack,  setAadhaarBack]  = useState<string | null>(null);
  const [aadhaarNum,   setAadhaarNum]   = useState("");
  const [pan,          setPan]          = useState<string | null>(null);
  const [panNum,       setPanNum]       = useState("");
  const [licenseFront, setLicenseFront] = useState<string | null>(null);
  const [rcFront,      setRcFront]      = useState<string | null>(null);
  const [rcBack,       setRcBack]       = useState<string | null>(null);
  const [docLoading,   setDocLoading]   = useState<Record<string, boolean>>({});

  // ── Payment ────────────────────────────────────────────────────────────────
  const [feeAmount,       setFeeAmount]       = useState(REGISTRATION_FEE);
  const [checkoutParams,  setCheckoutParams]  = useState<RazorpayCheckoutParams | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);
  const [paymentSuccessVisible, setPaymentSuccessVisible] = useState(false);
  const successScale   = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  function showPaymentSuccess() {
    setPaymentSuccessVisible(true);
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    ]).start();
    setTimeout(() => {
      router.replace("/verification-pending");
    }, 1600);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState("");

  // ── Load Razorpay fee config ───────────────────────────────────────────────
  useEffect(() => {
    getOnboardingFeeConfig()
      .then((cfg) => setFeeAmount(Math.max(cfg.amount, REGISTRATION_FEE)))
      .catch(() => setFeeAmount(Math.max(onboardingFeeAmount ?? 0, REGISTRATION_FEE)));
  }, [onboardingFeeAmount]);

  // ── Completion tracking ────────────────────────────────────────────────────
  const profileDone = [!!selfie, !!name.trim(), !!city, !!dob, !!gender].filter(Boolean).length;
  const vehicleDone = [!!vehicleId, !!vehicleNum.trim(), !!dlNumber.trim()].filter(Boolean).length;
  const docsDone = [
    !!aadhaarFront, !!aadhaarBack, validateAadhaar(aadhaarNum) === null,
    !!pan,          validatePAN(panNum) === null,
    !!licenseFront, !!rcFront, !!rcBack,
  ].filter(Boolean).length;

  const TOTAL = 16;
  const totalDone = profileDone + vehicleDone + docsDone;
  const allDone   = totalDone >= TOTAL;
  const pct       = Math.round((totalDone / TOTAL) * 100);

  // ── Pick document image ────────────────────────────────────────────────────
  async function handlePickDoc(
    setter: (uri: string | null) => void,
    id:     string,
    front = false,
  ) {
    setDocLoading((p) => ({ ...p, [id]: true }));
    const uri = await pickImage(front);
    setDocLoading((p) => ({ ...p, [id]: false }));
    if (uri) setter(uri);
  }

  // ── Submit handler ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!allDone || !driverUid) return;
    setSubmitting(true);
    let goingToCheckout = false;

    try {
      // 1. Upload all document images in parallel
      setSubmitStep("Uploading documents…");
      const uploads: Record<string, string> = {};
      const toUpload: Array<{ key: string; uri: string }> = [
        { key: "selfie",       uri: selfie!       },
        { key: "aadhaarFront", uri: aadhaarFront! },
        { key: "aadhaarBack",  uri: aadhaarBack!  },
        { key: "pan",          uri: pan!          },
        { key: "licenseFront", uri: licenseFront! },
        { key: "rcFront",      uri: rcFront!      },
        { key: "rcBack",       uri: rcBack!       },
      ];
      await Promise.all(
        toUpload.map(async ({ key, uri }) => {
          uploads[key] = isRemoteUrl(uri)
            ? uri
            : await uploadDocumentImage(driverUid, key, uri);
        }),
      );

      // 2. Duplicate key check
      setSubmitStep("Checking registration…");
      const keysResult = await registerDriverKeys({
        driverUid,
        phone,
        licenseNumber: dlNumber.trim() || undefined,
        vehicleNumber: vehicleNum.trim() || undefined,
      });
      if (!keysResult.ok) {
        Alert.alert("Registration failed", keysResult.message);
        return;
      }

      // 3. Save vehicle + profile to server
      setSubmitStep("Saving profile…");
      const [vehicleRes, profileRes] = await Promise.all([
        patchDriverVehicle({ id: vehicleId, name: vehicleName }),
        patchDriverProfile({
          name:          name.trim(),
          city,
          gender,
          licenseNumber: dlNumber.trim(),
          vehicleNumber: vehicleNum.trim(),
        }),
      ]);
      if (!vehicleRes.ok || !profileRes.ok) {
        Alert.alert("Error", "Could not save your profile. Please try again.");
        return;
      }
      setVehicle({ id: vehicleId, name: vehicleName });
      setProfile({ name: name.trim(), city, gender, licenseNumber: dlNumber.trim(), vehicleNumber: vehicleNum.trim() });

      // 4. Submit KYC documents
      setSubmitStep("Submitting documents…");
      const docsResult = await submitDocumentsToPostgres(uploads, {
        aadhaar: aadhaarNum.replace(/\s/g, ""),
        pan:     panNum.trim().toUpperCase(),
        license: dlNumber.trim(),
      });
      if (!docsResult.ok) {
        Alert.alert("Submission failed", docsResult.message);
        return;
      }

      // 5a. No fee — show success animation then navigate
      if (onboardingFeeApplies !== true) {
        showPaymentSuccess();
        return;
      }

      // 5b. Fee required — create Razorpay order
      setSubmitStep("Starting payment…");
      const user = firebaseAuth.currentUser;
      if (!user) {
        Alert.alert("Error", "Not logged in. Please restart the app.");
        return;
      }
      const token = await user.getIdToken();
      const orderRes = await fetch(`${API_BASE}/driver-plans/onboarding-fee/create-order`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ driverUid }),
      });
      const orderData = (await orderRes.json()) as {
        razorpayOrderId?: string;
        amount?:          number;
        currency?:        string;
        keyId?:           string;
        error?:           string;
      };
      if (!orderRes.ok || !orderData.razorpayOrderId || orderData.amount == null || !orderData.keyId) {
        Alert.alert("Payment error", orderData.error ?? "Could not start payment. Please try again.");
        return;
      }
      goingToCheckout = true;
      setCheckoutParams({
        razorpayOrderId: orderData.razorpayOrderId,
        amount:          orderData.amount,
        currency:        orderData.currency ?? "INR",
        keyId:           orderData.keyId,
        planName:        "Registration",
        driverPhone:     phone ?? "",
      });
      setCheckoutVisible(true);

    } catch (err) {
      const e = err as Error;
      Alert.alert("Error", e.message || "Something went wrong. Please try again.");
    } finally {
      if (!goingToCheckout) setSubmitting(false);
    }
  }, [
    allDone, driverUid, phone, selfie, aadhaarFront, aadhaarBack, aadhaarNum,
    pan, panNum, licenseFront, rcFront, rcBack,
    vehicleId, vehicleName, vehicleNum, dlNumber, name, city, gender,
    onboardingFeeApplies, router, setVehicle, setProfile,
  ]);

  // ── Payment success handler ────────────────────────────────────────────────
  const handlePaymentSuccess = useCallback(async (
    paymentId: string,
    orderId:   string,
    signature: string,
  ) => {
    setCheckoutVisible(false);
    if (!driverUid) return;
    try {
      setSubmitStep("Verifying payment…");
      const user = firebaseAuth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const res = await fetch(`${API_BASE}/driver-plans/onboarding-fee/verify-payment`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          driverUid,
          razorpayOrderId:   orderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: signature,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        Alert.alert("Verification failed", data.error ?? "Payment could not be verified. Please contact support.");
        return;
      }
      markOnboardingFeePaidLocally();
      showPaymentSuccess();
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setSubmitting(false);
    }
  }, [driverUid, markOnboardingFeePaidLocally, router]);

  const feeRequired  = onboardingFeeApplies === true;
  const submitLabel  = feeRequired ? `Submit & Pay ₹${feeAmount}` : "Submit Application";
  const remaining    = TOTAL - totalDone;

  return (
    <KeyboardAvoidingView
      style={[ss.root, { backgroundColor: D.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* ── Sticky header ── */}
      <View style={[ss.header, { paddingTop: insets.top + 12 }]}>
        <View style={ss.headerTopRow}>
          <View style={{ flex: 1 }}>
            <Text style={ss.headerTitle}>Driver Registration</Text>
            <Text style={ss.headerSub}>Complete all sections to submit your application</Text>
          </View>
          <View style={[ss.progressCircle, {
            borderColor: allDone ? D.success : D.primary,
          }]}>
            <Text style={[ss.progressPct, { color: allDone ? D.success : D.primary }]}>
              {pct}%
            </Text>
          </View>
        </View>

        <View style={ss.progressTrack}>
          <View style={[ss.progressFill, {
            width:           `${Math.max(pct, 2)}%` as `${number}%`,
            backgroundColor: allDone ? D.success : D.primary,
          }]} />
        </View>
        <Text style={ss.progressLabel}>
          {totalDone} of {TOTAL} fields complete
        </Text>
      </View>

      {/* ── Scrollable form ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[ss.scroll, { paddingBottom: insets.bottom + 120 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ══════ SECTION 1: PROFILE ══════ */}
        <View style={ss.card}>
          <SectionHeader step={1} title="Profile" complete={profileDone} total={5} />

          {/* Selfie */}
          <View style={ss.selfieRow}>
            <TouchableOpacity
              style={ss.selfieWrap}
              onPress={() => handlePickDoc(setSelfie, "selfie", true)}
              activeOpacity={0.8}
              disabled={selfieLoad}
            >
              {selfieLoad ? (
                <View style={ss.selfieCircle}>
                  <ActivityIndicator color={D.primary} />
                </View>
              ) : selfie ? (
                <Image source={{ uri: selfie }} style={ss.selfieImg} contentFit="cover" transition={200} />
              ) : (
                <View style={ss.selfieCircle}>
                  <SafeInlineIcon name="camera" size={28} color={D.primary} />
                </View>
              )}
              <View style={ss.selfieBadge}>
                <SafeInlineIcon name="camera" size={11} color="#fff" />
              </View>
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={ss.selfieLabel}>{selfie ? "Selfie added ✓" : "Upload Selfie *"}</Text>
              <Text style={ss.selfieHint}>Clear face photo · Neutral background</Text>
            </View>
          </View>

          <FieldInput
            label="Full Name" required
            value={name} onChangeText={setName}
            placeholder="Enter your full name"
            autoCapitalize="words"
          />

          {/* City dropdown */}
          <View style={ss.fieldGroup}>
            <Text style={ss.fieldLabel}>
              City <Text style={{ color: D.error }}>*</Text>
            </Text>
            <TouchableOpacity
              style={[ss.textInput, ss.selectRow, {
                borderColor:     cityOpen ? D.primary : D.border,
                backgroundColor: cityOpen ? D.primarySoft : D.muted,
              }]}
              onPress={() => setCityOpen((o) => !o)}
              activeOpacity={0.8}
            >
              <Text style={[ss.selectText, { color: city ? D.textDark : D.placeholder }]}>
                {city || "Select your city"}
              </Text>
              <Text style={{ fontSize: 12, color: D.textMuted }}>{cityOpen ? "▲" : "▼"}</Text>
            </TouchableOpacity>
            {cityOpen && (
              <View style={ss.dropdown}>
                {CITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[ss.dropdownItem, c === city && { backgroundColor: D.primarySoft }]}
                    onPress={() => { setCity(c); setCityOpen(false); }}
                  >
                    <Text style={[ss.dropdownText, {
                      color:      c === city ? D.primary : D.textDark,
                      fontWeight: c === city ? "700" : "400",
                    }]}>
                      {c}
                    </Text>
                    {c === city && <SafeInlineIcon name="check" size={13} color={D.primary} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* Date of birth */}
          <View style={ss.fieldGroup}>
            <Text style={ss.fieldLabel}>Date of Birth</Text>
            <TextInput
              style={[ss.textInput, {
                borderColor:     D.border,
                backgroundColor: D.muted,
                color:           D.textDark,
                letterSpacing:   0.5,
              }]}
              value={dob}
              onChangeText={(t) => setDob(formatDob(t))}
              placeholder="DD / MM / YYYY"
              placeholderTextColor={D.placeholder}
              keyboardType="numeric"
              maxLength={14}
            />
          </View>

          {/* Gender */}
          <View style={ss.fieldGroup}>
            <Text style={ss.fieldLabel}>Gender</Text>
            <View style={ss.genderRow}>
              {GENDERS.map((g) => (
                <TouchableOpacity
                  key={g}
                  style={[ss.genderChip, {
                    backgroundColor: gender === g ? D.primary : D.muted,
                    borderColor:     gender === g ? D.primary : D.border,
                  }]}
                  onPress={() => setGender(g)}
                  activeOpacity={0.75}
                >
                  <Text style={[ss.genderText, { color: gender === g ? "#fff" : D.textMuted }]}>
                    {g}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* ══════ SECTION 2: VEHICLE ══════ */}
        <View style={ss.card}>
          <SectionHeader step={2} title="Vehicle" complete={vehicleDone} total={3} />

          {/* Vehicle type grid */}
          <View style={ss.fieldGroup}>
            <Text style={ss.fieldLabel}>
              Vehicle Type <Text style={{ color: D.error }}>*</Text>
            </Text>
            <View style={ss.vehicleGrid}>
              {VEHICLES.map((v) => {
                const sel = vehicleId === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[ss.vehicleTile, {
                      borderColor:     sel ? D.primary : D.border,
                      backgroundColor: sel ? D.primarySoft : D.white,
                    }]}
                    onPress={() => { setVehicleId(v.id); setVehicleName(v.name); }}
                    activeOpacity={0.75}
                  >
                    <SafeInlineIcon name={v.icon} size={18} color={sel ? D.primary : D.textMuted} />
                    <Text style={[ss.vehicleText, { color: sel ? D.primaryBold : D.textMid }]} numberOfLines={2}>
                      {v.name}
                    </Text>
                    {sel && (
                      <View style={ss.vehicleCheck}>
                        <SafeInlineIcon name="check" size={9} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <FieldInput
            label="Vehicle Registration Number" required
            value={vehicleNum}
            onChangeText={(t) => setVehicleNum(t.toUpperCase())}
            placeholder="e.g. MH 01 AB 1234"
            autoCapitalize="characters"
            maxLength={13}
          />

          <FieldInput
            label="Driving Licence Number" required
            value={dlNumber}
            onChangeText={(t) => setDlNumber(t.toUpperCase())}
            placeholder="e.g. MH0120240001234"
            autoCapitalize="characters"
            maxLength={20}
          />
        </View>

        {/* ══════ SECTION 3: DOCUMENTS ══════ */}
        <View style={ss.card}>
          <SectionHeader step={3} title="Documents" complete={docsDone} total={8} />

          {/* Aadhaar */}
          <Text style={ss.docGroup}>Aadhaar Card</Text>
          <View style={ss.docRow}>
            <DocSlot
              label="Front Side"
              uri={aadhaarFront}
              loading={docLoading["aadhaarFront"]}
              onPress={() => handlePickDoc(setAadhaarFront, "aadhaarFront")}
            />
            <DocSlot
              label="Back Side"
              uri={aadhaarBack}
              loading={docLoading["aadhaarBack"]}
              onPress={() => handlePickDoc(setAadhaarBack, "aadhaarBack")}
            />
          </View>
          {aadhaarFront && aadhaarBack && (
            <FieldInput
              label="Aadhaar Number" required
              value={aadhaarNum}
              onChangeText={(t) => setAadhaarNum(t.replace(/[^\d]/g, ""))}
              placeholder="12-digit Aadhaar number"
              keyboardType="numeric"
              maxLength={12}
              autoCapitalize="none"
              error={aadhaarNum.length > 0 ? validateAadhaar(aadhaarNum) : null}
            />
          )}

          <View style={ss.divider} />

          {/* PAN */}
          <Text style={ss.docGroup}>PAN Card</Text>
          <View style={ss.docRow}>
            <DocSlot
              label="PAN Card"
              uri={pan}
              loading={docLoading["pan"]}
              onPress={() => handlePickDoc(setPan, "pan")}
            />
            <View style={{ flex: 1 }} />
          </View>
          {pan && (
            <FieldInput
              label="PAN Number" required
              value={panNum}
              onChangeText={(t) => setPanNum(t.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="e.g. ABCDE1234F"
              autoCapitalize="characters"
              maxLength={10}
              error={panNum.length > 0 ? validatePAN(panNum) : null}
            />
          )}

          <View style={ss.divider} />

          {/* Driving Licence */}
          <Text style={ss.docGroup}>Driving Licence</Text>
          <View style={ss.docRow}>
            <DocSlot
              label="Licence Photo"
              uri={licenseFront}
              loading={docLoading["licenseFront"]}
              onPress={() => handlePickDoc(setLicenseFront, "licenseFront")}
            />
            <View style={{ flex: 1 }} />
          </View>

          <View style={ss.divider} />

          {/* RC */}
          <Text style={ss.docGroup}>Registration Certificate (RC)</Text>
          <View style={ss.docRow}>
            <DocSlot
              label="Front Side"
              uri={rcFront}
              loading={docLoading["rcFront"]}
              onPress={() => handlePickDoc(setRcFront, "rcFront")}
            />
            <DocSlot
              label="Back Side"
              uri={rcBack}
              loading={docLoading["rcBack"]}
              onPress={() => handlePickDoc(setRcBack, "rcBack")}
            />
          </View>

          {/* Security note */}
          <View style={ss.secureNote}>
            <SafeInlineIcon name="shield" size={13} color={D.primary} />
            <Text style={ss.secureNoteText}>
              End-to-end encrypted · Used only for driver verification
            </Text>
          </View>
        </View>

        {/* ══════ SECTION 4: PAYMENT ══════ */}
        <View style={ss.card}>
          <SectionHeader step={4} title="Registration Fee" complete={feeRequired ? 0 : 1} total={1} />

          <View style={ss.feeRow}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
                <Text style={ss.feeAmount}>₹{feeRequired ? feeAmount : 0}</Text>
                <Text style={ss.feeOnce}>{feeRequired ? "one-time" : "no fee required"}</Text>
              </View>
              <Text style={ss.feeSub}>
                {feeRequired ? "Charged via Razorpay on submit" : "No registration fee for your account"}
              </Text>
            </View>
            <SafeInlineIcon name="shield" size={30} color={D.primary} />
          </View>

          {feeRequired && (
            <View style={ss.feeList}>
              {["Document verification", "Verified driver badge", "Unlimited order access"].map((item) => (
                <View key={item} style={ss.feeItem}>
                  <SafeInlineIcon name="check" size={13} color={D.success} />
                  <Text style={ss.feeItemText}>{item}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>

      {/* ── Sticky footer ── */}
      <View style={[ss.footer, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[ss.submitBtn, { opacity: allDone && !submitting ? 1 : 0.45 }]}
          onPress={handleSubmit}
          disabled={!allDone || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <View style={ss.submitRow}>
              <ActivityIndicator color="#fff" size="small" />
              <Text style={ss.submitText}>{submitStep || "Processing…"}</Text>
            </View>
          ) : (
            <Text style={ss.submitText}>{submitLabel}</Text>
          )}
        </TouchableOpacity>

        {!allDone && (
          <Text style={ss.footerHint}>
            {remaining} more field{remaining !== 1 ? "s" : ""} required to submit
          </Text>
        )}
      </View>

      {/* ── Razorpay checkout ── */}
      {checkoutParams && (
        <RazorpayWebCheckout
          visible={checkoutVisible}
          params={checkoutParams}
          onSuccess={handlePaymentSuccess}
          onClose={() => {
            setCheckoutVisible(false);
            setSubmitting(false);
          }}
          onCancel={() => {
            setCheckoutVisible(false);
            setSubmitting(false);
            Alert.alert(
              "Payment cancelled",
              "Your documents were saved. Tap Submit to try payment again.",
            );
          }}
          onFailure={(err) => {
            setCheckoutVisible(false);
            setSubmitting(false);
            Alert.alert("Payment failed", err || "Please try again.");
          }}
        />
      )}

      {/* ── Payment Success Overlay ── */}
      <Modal
        visible={paymentSuccessVisible}
        transparent
        animationType="none"
        statusBarTranslucent
      >
        <View style={ss.successBackdrop}>
          <Animated.View
            style={[
              ss.successCard,
              { opacity: successOpacity, transform: [{ scale: successScale }] },
            ]}
          >
            <View style={ss.successIconWrap}>
              <Text style={ss.successCheckmark}>✓</Text>
            </View>
            <Text style={ss.successTitle}>Payment Successful!</Text>
            <Text style={ss.successSub}>Redirecting to verification…</Text>
          </Animated.View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const ss = StyleSheet.create({
  root: { flex: 1 },

  // ── Header ─────────────────────────────────────────────────────────────────
  header: {
    backgroundColor:  D.white,
    paddingHorizontal: 20,
    paddingBottom:    14,
    borderBottomWidth: 1,
    borderBottomColor: D.border,
  },
  headerTopRow: {
    flexDirection:  "row",
    alignItems:     "flex-start",
    justifyContent: "space-between",
    marginBottom:   12,
    gap:            12,
  },
  headerTitle: { fontSize: 20, fontWeight: "800", color: D.textDark, letterSpacing: -0.4 },
  headerSub:   { fontSize: 12, color: D.textMuted, marginTop: 3 },
  progressCircle: {
    width:           52,
    height:          52,
    borderRadius:    26,
    borderWidth:     2.5,
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
  },
  progressPct:   { fontSize: 13, fontWeight: "800" },
  progressTrack: { height: 5, backgroundColor: D.muted, borderRadius: 3, overflow: "hidden" },
  progressFill:  { height: 5, borderRadius: 3 },
  progressLabel: { fontSize: 11, color: D.textMuted, marginTop: 5, textAlign: "right" },

  // ── Scroll ─────────────────────────────────────────────────────────────────
  scroll: { paddingHorizontal: 16, paddingTop: 14, gap: 12 },

  // ── Card ───────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: D.white,
    borderRadius:    16,
    borderWidth:     1,
    borderColor:     D.border,
    padding:         16,
    gap:             14,
  },

  // ── Section header ─────────────────────────────────────────────────────────
  sectionHeader:   { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: -2 },
  stepBadge:       { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  stepBadgeText:   { fontSize: 13, fontWeight: "800", color: "#fff" },
  sectionTitle:    { fontSize: 15, fontWeight: "700", color: D.textDark, flex: 1 },
  sectionPill:     { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  sectionPillText: { fontSize: 11, fontWeight: "700" },

  // ── Selfie ─────────────────────────────────────────────────────────────────
  selfieRow:    { flexDirection: "row", alignItems: "center", gap: 14 },
  selfieWrap:   { position: "relative" },
  selfieCircle: {
    width:           72,
    height:          72,
    borderRadius:    36,
    backgroundColor: D.primarySoft,
    borderWidth:     2,
    borderColor:     D.primary,
    alignItems:      "center",
    justifyContent:  "center",
  },
  selfieImg: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: D.primary },
  selfieBadge: {
    position:        "absolute",
    bottom:          0,
    right:           0,
    width:           22,
    height:          22,
    borderRadius:    11,
    backgroundColor: D.primary,
    alignItems:      "center",
    justifyContent:  "center",
  },
  selfieLabel: { fontSize: 14, fontWeight: "600", color: D.textDark },
  selfieHint:  { fontSize: 12, color: D.textMuted, marginTop: 3, lineHeight: 17 },

  // ── Fields ─────────────────────────────────────────────────────────────────
  fieldGroup: { gap: 5 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: D.textMid },
  fieldError: { fontSize: 11.5, color: D.error, marginTop: 2 },
  textInput: {
    height:            46,
    borderWidth:       1.5,
    borderRadius:      10,
    paddingHorizontal: 14,
    fontSize:          14,
    fontWeight:        "500",
  },
  selectRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  selectText:   { fontSize: 14, fontWeight: "500" },
  dropdown:     { borderWidth: 1, borderColor: D.border, borderRadius: 12, backgroundColor: D.white, overflow: "hidden", marginTop: 2 },
  dropdownItem: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical:   12,
    borderBottomWidth: 0.5,
    borderBottomColor: D.border,
  },
  dropdownText: { fontSize: 14 },
  genderRow:    { flexDirection: "row", gap: 8 },
  genderChip:   { flex: 1, height: 40, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  genderText:   { fontSize: 13, fontWeight: "600" },

  // ── Vehicle grid ───────────────────────────────────────────────────────────
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  vehicleTile: {
    width:          "30.5%",
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius:   10,
    borderWidth:    1.5,
    alignItems:     "center",
    gap:            5,
    position:       "relative",
  },
  vehicleText:  { fontSize: 11, fontWeight: "600", textAlign: "center" },
  vehicleCheck: {
    position:        "absolute",
    top:             5,
    right:           5,
    width:           16,
    height:          16,
    borderRadius:    8,
    backgroundColor: D.primary,
    alignItems:      "center",
    justifyContent:  "center",
  },

  // ── Documents ──────────────────────────────────────────────────────────────
  docGroup: { fontSize: 13, fontWeight: "700", color: D.textMid, marginBottom: -6 },
  docRow:   { flexDirection: "row", gap: 10 },
  docSlot: {
    flex:          1,
    minHeight:     90,
    borderRadius:  12,
    borderWidth:   1.5,
    alignItems:    "center",
    justifyContent:"center",
    padding:       10,
    gap:           6,
  },
  docThumb:   { width: 50, height: 38, borderRadius: 6 },
  docLabel:   { fontSize: 12, fontWeight: "600", textAlign: "center" },
  divider:    { height: 1, backgroundColor: D.border, marginVertical: -2 },
  secureNote: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            7,
    padding:        10,
    borderRadius:   10,
    backgroundColor: D.primarySoft,
    borderWidth:    1,
    borderColor:    D.primary,
    marginTop:      -2,
  },
  secureNoteText: { fontSize: 12, fontWeight: "500", color: D.primaryBold, flex: 1 },

  // ── Payment ────────────────────────────────────────────────────────────────
  feeRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  feeAmount:  { fontSize: 28, fontWeight: "800", color: D.textDark },
  feeOnce:    { fontSize: 13, fontWeight: "400", color: D.textMuted },
  feeSub:     { fontSize: 12, color: D.textMuted, marginTop: 2 },
  feeList:    { gap: 7, marginTop: -2 },
  feeItem:    { flexDirection: "row", alignItems: "center", gap: 9 },
  feeItemText:{ fontSize: 13, color: D.textMid },

  // ── Footer ─────────────────────────────────────────────────────────────────
  footer: {
    position:          "absolute",
    bottom:            0,
    left:              0,
    right:             0,
    backgroundColor:   D.white,
    borderTopWidth:    1,
    borderTopColor:    D.border,
    paddingHorizontal: 20,
    paddingTop:        14,
    gap:               8,
  },
  submitBtn: {
    backgroundColor: D.primary,
    borderRadius:    14,
    height:          54,
    alignItems:      "center",
    justifyContent:  "center",
  },
  submitRow:  { flexDirection: "row", alignItems: "center", gap: 10 },
  submitText: { fontSize: 16, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  footerHint: { fontSize: 12, color: D.textMuted, textAlign: "center" },

  // ── Payment Success Overlay ────────────────────────────────────────────────
  successBackdrop: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  successCard: {
    backgroundColor: D.white,
    borderRadius:    28,
    paddingVertical:   40,
    paddingHorizontal: 36,
    alignItems:      "center",
    gap:             14,
    shadowColor:     "#000",
    shadowOpacity:   0.25,
    shadowRadius:    30,
    shadowOffset:    { width: 0, height: 12 },
    elevation:       20,
    minWidth:        240,
  },
  successIconWrap: {
    width:           80,
    height:          80,
    borderRadius:    40,
    backgroundColor: D.successSoft,
    alignItems:      "center",
    justifyContent:  "center",
  },
  successCheckmark: {
    fontSize:   38,
    color:      D.success,
    fontWeight: "800",
  },
  successTitle: {
    fontSize:      22,
    fontWeight:    "800",
    color:         D.textDark,
    letterSpacing: -0.4,
  },
  successSub: {
    fontSize: 14,
    color:    D.textMuted,
  },
});
