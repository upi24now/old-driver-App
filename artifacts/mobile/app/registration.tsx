/**
 * registration.tsx — Driver Registration (Screen 3 of 4)
 *
 * Single scrollable form: Profile · Vehicle · Documents · Payment
 * Design: Uber Driver / Rapido Captain style — professional logistics
 * Primary #FF6B00 · Success #16A34A
 *
 * APIs called on submit (unchanged):
 *   1. uploadDocumentImage × N   — upload local images to VPS
 *   2. registerDriverKeys        — duplicate key check
 *   3. patchDriverVehicle        — persist vehicle selection
 *   4. patchDriverProfile        — persist profile fields
 *   5. submitDocumentsToPostgres — submit KYC docs + mark pending
 *   6. (if fee) create-order     — Razorpay order
 *   7. (if fee) verify-payment   — verify Razorpay HMAC
 */

import { RazorpayWebCheckout, type RazorpayCheckoutParams } from "@/components/RazorpayWebCheckout";
import { useDriver } from "@/contexts/DriverContext";
import { registerDriverKeys, submitDocumentsToPostgres } from "@/utils/driver-api";
import { firebaseAuth } from "@/utils/firebase";
import { getOnboardingFeeConfig } from "@/utils/firestore";
import { patchDriverProfile, patchDriverVehicle } from "@/utils/profile-api";
import { uploadDocumentImage, isRemoteUrl } from "@/utils/storage";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  Modal,
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

// ─── Design tokens (matches mockup exactly) ───────────────────────────────────
const D = {
  bg:          "#F8FAFC",
  white:       "#FFFFFF",
  primary:     "#FF6B00",
  primarySoft: "#FFF3EC",
  success:     "#16A34A",
  successSoft: "#DCFCE7",
  successBorder:"#86EFAC",
  error:       "#EF4444",
  errorSoft:   "#FEE2E2",
  textDark:    "#111827",
  textMid:     "#374151",
  textMuted:   "#6B7280",
  border:      "#E5E7EB",
  muted:       "#F9FAFB",
  inputBg:     "#FFFFFF",
  placeholder: "#9CA3AF",
  card:        "#FFFFFF",
  divider:     "#F3F4F6",
} as const;

const REGISTRATION_FEE = 10;
const API_BASE = (() => {
  const d = process.env["EXPO_PUBLIC_DOMAIN"] ?? "";
  return d ? `https://${d}/api` : "/api";
})();

// ─── Data ─────────────────────────────────────────────────────────────────────
const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Surat",
  "Nagpur", "Lucknow", "Indore", "Thane", "Bhopal",
];

const GENDERS = ["Male", "Female", "Other"] as const;

type VehicleOption = {
  id:       string;
  name:     string;
  capacity: string;
  image:    number;
};
const VEHICLES: VehicleOption[] = [
  { id: "two_wheeler",          name: "Two Wheeler",          capacity: "Up to 20 KG",    image: require("@/assets/images/vehicles/bike-delivery.png")   },
  { id: "loader_three_wheeler", name: "Loader Three Wheeler", capacity: "Up to 500 KG",   image: require("@/assets/images/vehicles/auto-cargo.png")      },
  { id: "tata_ace",             name: "Tata Ace",             capacity: "Up to 750 KG",   image: require("@/assets/images/vehicles/tata-ace.png")        },
  { id: "mini_truck",           name: "Mini Truck",           capacity: "Up to 1200 KG",  image: require("@/assets/images/vehicles/mini-truck.png")      },
  { id: "mahindra_pickup",      name: "Mahindra Pickup",      capacity: "Up to 1700 KG",  image: require("@/assets/images/vehicles/pickup-truck.png")    },
  { id: "tata_407",             name: "Tata 407",             capacity: "Up to 2250 KG",  image: require("@/assets/images/vehicles/eicher-truck.png")    },
  { id: "canter",               name: "Canter",               capacity: "Up to 5000 KG",  image: require("@/assets/images/vehicles/14-feet-truck.png")   },
];

// ─── Validators ───────────────────────────────────────────────────────────────
function validateAadhaar(s: string): string | null {
  const clean = s.replace(/\s/g, "");
  if (!clean) return "Required";
  if (!/^\d{12}$/.test(clean)) return "Must be 12 digits";
  return null;
}
function validatePAN(s: string): string | null {
  const clean = s.trim().toUpperCase();
  if (!clean) return "Required";
  if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(clean)) return "Format: ABCDE1234F";
  return null;
}
function formatDob(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} / ${d.slice(2)}`;
  return `${d.slice(0, 2)} / ${d.slice(2, 4)} / ${d.slice(4)}`;
}

// ─── Image picker ─────────────────────────────────────────────────────────────
async function pickImage(useFront = false): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    const cam = await ImagePicker.requestCameraPermissionsAsync();
    if (!cam.granted) return null;
    const r = await ImagePicker.launchCameraAsync({
      mediaTypes: "images",
      quality: 0.82,
      allowsEditing: false,
      cameraType: useFront
        ? ImagePicker.CameraType.front
        : ImagePicker.CameraType.back,
    });
    return r.canceled ? null : (r.assets[0]?.uri ?? null);
  }
  const r = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 0.82,
    allowsEditing: false,
  });
  return r.canceled ? null : (r.assets[0]?.uri ?? null);
}

// ─── PickerModal ─────────────────────────────────────────────────────────────
function PickerModal<T extends { id: string; name: string }>({
  visible, title, options, onSelect, onClose,
}: {
  visible:  boolean;
  title:    string;
  options:  T[];
  onSelect: (item: T) => void;
  onClose:  () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={pm.backdrop} onPress={onClose} />
      <View style={pm.sheet}>
        <View style={pm.handle} />
        <Text style={pm.title}>{title}</Text>
        <FlatList
          data={options}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={pm.option}
              onPress={() => { onSelect(item); onClose(); }}
              activeOpacity={0.7}
            >
              <Text style={pm.optionText}>{item.name}</Text>
              <Feather name="chevron-right" size={16} color={D.textMuted} />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={pm.sep} />}
        />
      </View>
    </Modal>
  );
}
const pm = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    backgroundColor: D.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxHeight: "75%",
  },
  handle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: D.border,
    alignSelf: "center", marginTop: 10, marginBottom: 14,
  },
  title: {
    fontSize: 16, fontWeight: "700", color: D.textDark,
    marginBottom: 12,
  },
  option: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  optionText: { fontSize: 15, color: D.textDark },
  sep: { height: 1, backgroundColor: D.divider },
});

// ─── VehiclePickerModal ───────────────────────────────────────────────────────
function VehiclePickerModal({
  visible, onSelect, onClose,
}: {
  visible:  boolean;
  onSelect: (item: VehicleOption) => void;
  onClose:  () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={pm.backdrop} onPress={onClose} />
      <View style={pm.sheet}>
        <View style={pm.handle} />
        <Text style={pm.title}>Select Vehicle Type</Text>
        <FlatList
          data={VEHICLES}
          keyExtractor={(v) => v.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={vpm.row}
              onPress={() => { onSelect(item); onClose(); }}
              activeOpacity={0.72}
            >
              <View style={vpm.iconWrap}>
                <Image source={item.image} style={vpm.icon} contentFit="contain" />
              </View>
              <View style={vpm.textCol}>
                <Text style={vpm.name}>{item.name}</Text>
                <Text style={vpm.cap}>{item.capacity}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={D.textMuted} />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={pm.sep} />}
          showsVerticalScrollIndicator={false}
        />
      </View>
    </Modal>
  );
}
const vpm = StyleSheet.create({
  row: {
    flexDirection:  "row",
    alignItems:     "center",
    gap:            12,
    minHeight:      72,
    paddingVertical: 10,
  },
  iconWrap: {
    width:           60,
    height:          52,
    borderRadius:    10,
    backgroundColor: "#F3F4F6",
    alignItems:      "center",
    justifyContent:  "center",
    overflow:        "hidden",
  },
  icon: {
    width:  54,
    height: 46,
  },
  textCol: { flex: 1 },
  name: {
    fontSize:   15,
    fontWeight: "700",
    color:      D.textDark,
  },
  cap: {
    fontSize:   12,
    color:      D.textMuted,
    marginTop:  3,
    fontWeight: "500",
  },
});

// ─── DocUploadBox ─────────────────────────────────────────────────────────────
function DocUploadBox({
  label, uri, loading, onPress, compact = false,
}: {
  label:    string;
  uri:      string | null;
  loading:  boolean;
  onPress:  () => void;
  compact?: boolean;
}) {
  const uploaded = !!uri;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.75}
      style={[
        ub.box,
        compact && ub.boxCompact,
        uploaded
          ? { borderColor: D.successBorder, backgroundColor: D.successSoft }
          : { borderColor: D.border, backgroundColor: D.muted },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={D.primary} />
      ) : uploaded ? (
        <View style={ub.uploadedRow}>
          {uri && (
            <Image source={{ uri }} style={ub.thumb} contentFit="cover" />
          )}
          <Feather name="check-circle" size={14} color={D.success} />
          <Text style={[ub.uploadedText, { color: D.success }]}>Uploaded</Text>
        </View>
      ) : (
        <View style={ub.emptyRow}>
          <Feather name="camera" size={16} color={D.textMuted} />
          <Text style={ub.emptyText}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}
const ub = StyleSheet.create({
  box: {
    flex: 1,
    height: 60,
    borderWidth: 1.5,
    borderRadius: 12,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  boxCompact: {
    height: 52,
    width: 90,
    flex: undefined,
  },
  uploadedRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
  },
  thumb: {
    width: 28, height: 28, borderRadius: 6,
  },
  uploadedText: {
    fontSize: 12, fontWeight: "600",
  },
  emptyRow: {
    alignItems: "center", gap: 4,
  },
  emptyText: {
    fontSize: 11, color: D.textMuted, textAlign: "center",
  },
});

// ─── SectionCard ─────────────────────────────────────────────────────────────
function SectionCard({
  icon, step, title, children,
}: {
  icon:     React.ComponentProps<typeof Feather>["name"];
  step:     number;
  title:    string;
  children: React.ReactNode;
}) {
  return (
    <View style={sc.card}>
      <View style={sc.header}>
        <View style={sc.iconWrap}>
          <Feather name={icon} size={15} color={D.primary} />
        </View>
        <Text style={sc.title}>{step}. {title}</Text>
      </View>
      {children}
    </View>
  );
}
const sc = StyleSheet.create({
  card: {
    backgroundColor: D.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: D.border,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: D.primarySoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "700",
    color: D.textDark,
    letterSpacing: 0.1,
  },
});

// ─── TextInputField ───────────────────────────────────────────────────────────
function TextInputField({
  label, value, onChangeText, placeholder,
  keyboardType, autoCapitalize, maxLength, required, error, hint,
}: {
  label:           string;
  value:           string;
  onChangeText:    (t: string) => void;
  placeholder:     string;
  keyboardType?:   "default" | "numeric" | "email-address";
  autoCapitalize?: "none" | "words" | "characters" | "sentences";
  maxLength?:      number;
  required?:       boolean;
  error?:          string | null;
  hint?:           string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={tf.wrap}>
      <Text style={tf.label}>
        {label}{required && <Text style={{ color: D.error }}> *</Text>}
      </Text>
      <TextInput
        style={[
          tf.input,
          focused && tf.inputFocused,
          !!error && tf.inputError,
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
        selectionColor={D.primary}
        underlineColorAndroid="transparent"
        {...(Platform.OS === "web" ? ({ outlineWidth: 0 } as object) : {})}
      />
      {hint && !error && <Text style={tf.hint}>{hint}</Text>}
      {error && <Text style={tf.error}>{error}</Text>}
    </View>
  );
}
const tf = StyleSheet.create({
  wrap: { gap: 5 },
  label: { fontSize: 12, fontWeight: "600", color: D.textMid },
  input: {
    height: 44,
    borderWidth: 1.5,
    borderColor: D.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: D.inputBg,
    fontSize: 14,
    color: D.textDark,
  },
  inputFocused: { borderColor: D.primary, backgroundColor: D.primarySoft },
  inputError:   { borderColor: D.error },
  hint:  { fontSize: 11, color: D.textMuted },
  error: { fontSize: 11, color: D.error },
});

// ─── DropdownField ────────────────────────────────────────────────────────────
function DropdownField({
  label, value, placeholder, required, onPress,
}: {
  label:       string;
  value:       string;
  placeholder: string;
  required?:   boolean;
  onPress:     () => void;
}) {
  return (
    <View style={df.wrap}>
      <Text style={df.label}>
        {label}{required && <Text style={{ color: D.error }}> *</Text>}
      </Text>
      <TouchableOpacity style={df.btn} onPress={onPress} activeOpacity={0.75}>
        <Text style={[df.value, !value && { color: D.placeholder }]}>
          {value || placeholder}
        </Text>
        <Feather name="chevron-down" size={14} color={D.textMuted} />
      </TouchableOpacity>
    </View>
  );
}
const df = StyleSheet.create({
  wrap: { gap: 5 },
  label: { fontSize: 12, fontWeight: "600", color: D.textMid },
  btn: {
    height: 44,
    borderWidth: 1.5,
    borderColor: D.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    backgroundColor: D.inputBg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  value: { fontSize: 14, color: D.textDark, flex: 1 },
});

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function RegistrationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    driverUid,
    phone,
    vehicle:             ctxVehicle,
    profile:             ctxProfile,
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
  const [vehicleId,    setVehicleId]    = useState(ctxVehicle?.id   ?? "");
  const [vehicleName,  setVehicleName]  = useState(ctxVehicle?.name ?? "");
  const [vehicleOpen,  setVehicleOpen]  = useState(false);
  const [vehicleNum,   setVehicleNum]   = useState(ctxProfile?.vehicleNumber ?? "");
  const [dlNumber,     setDlNumber]     = useState(ctxProfile?.licenseNumber ?? "");
  const [licenseFront, setLicenseFront] = useState<string | null>(null);

  // ── Documents ──────────────────────────────────────────────────────────────
  const [aadhaarFront, setAadhaarFront] = useState<string | null>(null);
  const [aadhaarBack,  setAadhaarBack]  = useState<string | null>(null);
  const [aadhaarNum,   setAadhaarNum]   = useState("");
  const [pan,          setPan]          = useState<string | null>(null);
  const [panNum,       setPanNum]       = useState("");
  const [rcFront,      setRcFront]      = useState<string | null>(null);
  const [rcBack,       setRcBack]       = useState<string | null>(null);
  const [rcNumber,     setRcNumber]     = useState("");
  const [docLoading,   setDocLoading]   = useState<Record<string, boolean>>({});

  // ── Payment ────────────────────────────────────────────────────────────────
  const [feeAmount,             setFeeAmount]            = useState(REGISTRATION_FEE);
  const [checkoutParams,        setCheckoutParams]       = useState<RazorpayCheckoutParams | null>(null);
  const [checkoutVisible,       setCheckoutVisible]      = useState(false);
  const [paymentSuccessVisible, setPaymentSuccessVisible] = useState(false);
  const successScale   = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  function showPaymentSuccess() {
    setPaymentSuccessVisible(true);
    Animated.parallel([
      Animated.spring(successScale, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 10 }),
      Animated.timing(successOpacity, { toValue: 1, duration: 250, useNativeDriver: true, easing: Easing.out(Easing.ease) }),
    ]).start();
    setTimeout(() => router.replace("/verification-pending"), 1600);
  }

  // ── Submit state ────────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [submitStep, setSubmitStep] = useState("");

  // ── Fee config ─────────────────────────────────────────────────────────────
  useEffect(() => {
    getOnboardingFeeConfig()
      .then((cfg) => setFeeAmount(Math.max(cfg.amount, REGISTRATION_FEE)))
      .catch(() => setFeeAmount(Math.max(onboardingFeeAmount ?? 0, REGISTRATION_FEE)));
  }, [onboardingFeeAmount]);

  // ── Completion (16 required fields, DOB is optional) ──────────────────────
  // Profile (4): selfie · name · city · gender
  const profileDone = [!!selfie, !!name.trim(), !!city, !!gender].filter(Boolean).length;
  // Vehicle (4): type · reg number · DL number · DL photo
  const vehicleDone = [!!vehicleId, !!vehicleNum.trim(), !!dlNumber.trim(), !!licenseFront].filter(Boolean).length;
  // Identity docs (5): aadhaar front · back · number · PAN · PAN number
  const identityDone = [
    !!aadhaarFront, !!aadhaarBack, validateAadhaar(aadhaarNum) === null,
    !!pan,          validatePAN(panNum) === null,
  ].filter(Boolean).length;
  // Vehicle docs (3): RC front · back · number
  const rcDone = [!!rcFront, !!rcBack, !!rcNumber.trim()].filter(Boolean).length;

  const TOTAL    = 16;
  const totalDone = profileDone + vehicleDone + identityDone + rcDone;
  const allDone   = totalDone >= TOTAL;
  const pct       = Math.round((totalDone / TOTAL) * 100);

  // ── Pick document ──────────────────────────────────────────────────────────
  async function handlePickDoc(setter: (u: string | null) => void, id: string, front = false) {
    setDocLoading((p) => ({ ...p, [id]: true }));
    const uri = await pickImage(front);
    setDocLoading((p) => ({ ...p, [id]: false }));
    if (uri) setter(uri);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!allDone || !driverUid) return;
    setSubmitting(true);
    let goingToCheckout = false;

    try {
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

      setSubmitStep("Submitting documents…");
      const docsResult = await submitDocumentsToPostgres(uploads, {
        aadhaar: aadhaarNum.replace(/\s/g, ""),
        pan:     panNum.trim().toUpperCase(),
        license: dlNumber.trim(),
        rc:      rcNumber.trim(),
      });
      if (!docsResult.ok) {
        Alert.alert("Submission failed", docsResult.message);
        return;
      }

      if (onboardingFeeApplies !== true) {
        showPaymentSuccess();
        return;
      }

      setSubmitStep("Starting payment…");
      const user = firebaseAuth.currentUser;
      if (!user) { Alert.alert("Error", "Not logged in. Please restart the app."); return; }
      const token = await user.getIdToken();
      const orderRes = await fetch(`${API_BASE}/driver-plans/onboarding-fee/create-order`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ driverUid }),
      });
      const orderData = (await orderRes.json()) as {
        razorpayOrderId?: string; amount?: number; currency?: string; keyId?: string; error?: string;
      };
      if (!orderRes.ok || !orderData.razorpayOrderId || orderData.amount == null || !orderData.keyId) {
        Alert.alert("Payment error", orderData.error ?? "Could not start payment.");
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
      Alert.alert("Error", (err as Error).message || "Something went wrong. Please try again.");
    } finally {
      if (!goingToCheckout) setSubmitting(false);
    }
  }, [
    allDone, driverUid, phone, selfie, aadhaarFront, aadhaarBack, aadhaarNum,
    pan, panNum, licenseFront, rcFront, rcBack, rcNumber,
    vehicleId, vehicleName, vehicleNum, dlNumber, name, city, gender,
    onboardingFeeApplies, setVehicle, setProfile,
  ]);

  // ── Payment success ────────────────────────────────────────────────────────
  const handlePaymentSuccess = useCallback(async (
    paymentId: string, orderId: string, signature: string,
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
        Alert.alert("Verification failed", data.error ?? "Please contact support.");
        return;
      }
      markOnboardingFeePaidLocally();
      showPaymentSuccess();
    } catch {
      Alert.alert("Error", "Payment verification failed. Please contact support.");
    } finally {
      setSubmitting(false);
    }
  }, [driverUid, markOnboardingFeePaidLocally]);

  const feeRequired = onboardingFeeApplies === true;
  const submitLabel = feeRequired ? `Submit & Pay ₹${feeAmount}` : "Submit Application";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[s.root, { backgroundColor: D.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >

      {/* ── Sticky header ── */}
      <View style={[s.header, { paddingTop: insets.top + 10 }]}>
        <View style={s.headerRow}>
          <TouchableOpacity
            style={s.backBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
            hitSlop={8}
          >
            <Feather name="arrow-left" size={20} color={D.textDark} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Driver Registration</Text>
            <Text style={s.headerSub}>Complete all details to submit your application</Text>
          </View>

          {/* Small progress circle */}
          <View style={[s.circleWrap, { borderColor: allDone ? D.success : D.primary }]}>
            <Text style={[s.circlePct, { color: allDone ? D.success : D.primary }]}>
              {pct}%
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={s.progressTrack}>
          <View style={[
            s.progressFill,
            {
              width:           `${Math.max(pct, 2)}%` as `${number}%`,
              backgroundColor: allDone ? D.success : D.primary,
            },
          ]} />
        </View>
        <Text style={[s.progressLabel, { color: allDone ? D.success : D.textMuted }]}>
          {totalDone} of {TOTAL} fields complete
        </Text>
      </View>

      {/* ── Scrollable form ── */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 110 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >

        {/* ══════════════════════════════════════════════════════════
            SECTION 1 — PROFILE INFORMATION
        ══════════════════════════════════════════════════════════ */}
        <SectionCard icon="user" step={1} title="Profile Information">

          {/* Row: Selfie | Name + City */}
          <View style={s.profileTopRow}>
            {/* Selfie box */}
            <TouchableOpacity
              style={s.selfieBox}
              onPress={() => void (async () => {
                setSelfieLoad(true);
                const uri = await pickImage(true);
                setSelfieLoad(false);
                if (uri) setSelfie(uri);
              })()}
              activeOpacity={0.75}
              disabled={selfieLoad}
            >
              {selfieLoad ? (
                <ActivityIndicator size="small" color={D.primary} />
              ) : selfie ? (
                <Image source={{ uri: selfie }} style={s.selfieThumb} contentFit="cover" />
              ) : (
                <>
                  <Feather name="camera" size={22} color={D.textMuted} />
                  <Text style={s.selfieLabel}>Upload Selfie</Text>
                  <Text style={s.selfieHint}>Clear face photo</Text>
                </>
              )}
              {selfie && (
                <View style={s.selfieCheck}>
                  <Feather name="check-circle" size={16} color={D.success} />
                </View>
              )}
            </TouchableOpacity>

            {/* Name + City stacked */}
            <View style={s.profileRight}>
              <TextInputField
                label="Full Name" value={name} onChangeText={setName}
                placeholder="Ravi Kumar" required autoCapitalize="words"
              />
              <View style={{ height: 10 }} />
              <DropdownField
                label="City" value={city} placeholder="Select city" required
                onPress={() => setCityOpen(true)}
              />
            </View>
          </View>

          <View style={s.rowSep} />

          {/* Row: DOB | Gender */}
          <View style={s.twoCol}>
            <View style={{ flex: 1 }}>
              <TextInputField
                label="Date of Birth" value={dob}
                onChangeText={(t) => setDob(formatDob(t))}
                placeholder="DD / MM / YYYY"
                keyboardType="numeric" autoCapitalize="none"
                maxLength={14}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={tf.label}>
                Gender <Text style={{ color: D.error }}>*</Text>
              </Text>
              <View style={s.genderRow}>
                {GENDERS.map((g) => (
                  <TouchableOpacity
                    key={g}
                    style={[
                      s.genderChip,
                      gender === g && { backgroundColor: D.primary, borderColor: D.primary },
                    ]}
                    onPress={() => setGender(g)}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      s.genderChipText,
                      { color: gender === g ? D.white : D.textMid },
                    ]}>{g}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ══════════════════════════════════════════════════════════
            SECTION 2 — VEHICLE INFORMATION
        ══════════════════════════════════════════════════════════ */}
        <SectionCard icon="truck" step={2} title="Vehicle Information">

          {/* Row: Vehicle Type | Vehicle Number */}
          <View style={s.twoCol}>
            <View style={{ flex: 1 }}>
              <DropdownField
                label="Vehicle Type" value={vehicleName} placeholder="Select type" required
                onPress={() => setVehicleOpen(true)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextInputField
                label="Vehicle Number" value={vehicleNum} onChangeText={setVehicleNum}
                placeholder="MH 12 AA 1234" required
                autoCapitalize="characters" maxLength={15}
              />
            </View>
          </View>

          <View style={{ height: 12 }} />

          {/* Row: DL Number + DL Photo — TOGETHER */}
          <View style={s.dlRow}>
            <View style={{ flex: 1 }}>
              <TextInputField
                label="Driving Licence Number" value={dlNumber} onChangeText={setDlNumber}
                placeholder="MH12 20200012345" required
                autoCapitalize="characters" maxLength={20}
              />
            </View>
            <View style={s.dlPhotoWrap}>
              <Text style={[tf.label, { textAlign: "center" }]}>
                DL Photo <Text style={{ color: D.error }}>*</Text>
              </Text>
              <DocUploadBox
                label="Upload"
                uri={licenseFront}
                loading={!!docLoading["licenseFront"]}
                onPress={() => void handlePickDoc(setLicenseFront, "licenseFront")}
                compact
              />
            </View>
          </View>
        </SectionCard>

        {/* ══════════════════════════════════════════════════════════
            SECTION 3 — IDENTITY DOCUMENTS
        ══════════════════════════════════════════════════════════ */}
        <SectionCard icon="credit-card" step={3} title="Identity Documents">

          {/* ── Aadhaar ── */}
          <Text style={s.docGroupLabel}>Aadhaar</Text>
          <View style={s.twoUploadRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={tf.label}>Front <Text style={{ color: D.error }}>*</Text></Text>
              <DocUploadBox
                label="Aadhaar Front" uri={aadhaarFront}
                loading={!!docLoading["aadhaarFront"]}
                onPress={() => void handlePickDoc(setAadhaarFront, "aadhaarFront")}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={tf.label}>Back <Text style={{ color: D.error }}>*</Text></Text>
              <DocUploadBox
                label="Aadhaar Back" uri={aadhaarBack}
                loading={!!docLoading["aadhaarBack"]}
                onPress={() => void handlePickDoc(setAadhaarBack, "aadhaarBack")}
              />
            </View>
          </View>
          <View style={{ height: 10 }} />
          <TextInputField
            label="Aadhaar Number" value={aadhaarNum}
            onChangeText={(t) => setAadhaarNum(t.replace(/\D/g, "").slice(0, 12))}
            placeholder="1234 5678 9012" required
            keyboardType="numeric" autoCapitalize="none" maxLength={12}
            error={aadhaarNum.length > 0 ? validateAadhaar(aadhaarNum) : null}
          />

          <View style={s.docSep} />

          {/* ── PAN ── */}
          <Text style={s.docGroupLabel}>PAN Card</Text>
          <View style={{ gap: 4 }}>
            <Text style={tf.label}>PAN Card Photo <Text style={{ color: D.error }}>*</Text></Text>
            <DocUploadBox
              label="PAN Card" uri={pan}
              loading={!!docLoading["pan"]}
              onPress={() => void handlePickDoc(setPan, "pan")}
            />
          </View>
          <View style={{ height: 10 }} />
          <TextInputField
            label="PAN Number" value={panNum}
            onChangeText={(t) => setPanNum(t.trim().toUpperCase())}
            placeholder="ABCDE1234F" required
            autoCapitalize="characters" maxLength={10}
            error={panNum.length > 0 ? validatePAN(panNum) : null}
          />
        </SectionCard>

        {/* ══════════════════════════════════════════════════════════
            SECTION 4 — VEHICLE DOCUMENTS
        ══════════════════════════════════════════════════════════ */}
        <SectionCard icon="file-text" step={4} title="Vehicle Documents">

          {/* ── RC ── */}
          <View style={s.twoUploadRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={tf.label}>RC Front <Text style={{ color: D.error }}>*</Text></Text>
              <DocUploadBox
                label="RC Front" uri={rcFront}
                loading={!!docLoading["rcFront"]}
                onPress={() => void handlePickDoc(setRcFront, "rcFront")}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={tf.label}>RC Back <Text style={{ color: D.error }}>*</Text></Text>
              <DocUploadBox
                label="RC Back" uri={rcBack}
                loading={!!docLoading["rcBack"]}
                onPress={() => void handlePickDoc(setRcBack, "rcBack")}
              />
            </View>
          </View>
          <View style={{ height: 10 }} />
          <TextInputField
            label="RC Number" value={rcNumber}
            onChangeText={(t) => setRcNumber(t.toUpperCase())}
            placeholder="MH12AB1234" required
            autoCapitalize="characters" maxLength={16}
          />
        </SectionCard>

        {/* ══════════════════════════════════════════════════════════
            SECTION 5 — APPLICATION FEE (only when applicable)
        ══════════════════════════════════════════════════════════ */}
        {feeRequired && (
          <View style={s.feeRow}>
            <View style={s.feeLeft}>
              <Feather name="shield" size={14} color={D.success} />
              <Text style={s.feeLine}>5. Application Fee</Text>
              <Text style={s.feeHint}> · One-time payment · Secure &amp; Encrypted</Text>
            </View>
            <Text style={s.feeAmount}>₹{feeAmount}</Text>
          </View>
        )}

      </ScrollView>

      {/* ── Sticky submit button ── */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        {submitting ? (
          <View style={s.submittingRow}>
            <ActivityIndicator size="small" color={D.white} />
            <Text style={s.submittingText}>{submitStep || "Submitting…"}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.submitBtn, !allDone && s.submitBtnDisabled]}
            onPress={() => void handleSubmit()}
            disabled={!allDone}
            activeOpacity={0.85}
          >
            <Feather name="check-circle" size={18} color={D.white} />
            <Text style={s.submitText}>{submitLabel}</Text>
          </TouchableOpacity>
        )}
        <View style={s.secureRow}>
          <Feather name="lock" size={11} color={D.textMuted} />
          <Text style={s.secureText}>Your information is safe and secure</Text>
        </View>
      </View>

      {/* ── City picker ── */}
      <PickerModal
        visible={cityOpen}
        title="Select City"
        options={CITIES.map((c) => ({ id: c, name: c }))}
        onSelect={(item) => setCity(item.name)}
        onClose={() => setCityOpen(false)}
      />

      {/* ── Vehicle picker ── */}
      <VehiclePickerModal
        visible={vehicleOpen}
        onSelect={(item) => { setVehicleId(item.id); setVehicleName(item.name); }}
        onClose={() => setVehicleOpen(false)}
      />

      {/* ── Razorpay checkout ── */}
      {checkoutParams && (
        <RazorpayWebCheckout
          visible={checkoutVisible}
          params={checkoutParams}
          onSuccess={handlePaymentSuccess}
          onClose={() => { setCheckoutVisible(false); setSubmitting(false); }}
          onCancel={() => {
            setCheckoutVisible(false);
            setSubmitting(false);
            Alert.alert("Payment cancelled", "Your documents were saved. Tap Submit to try payment again.");
          }}
          onFailure={(err) => {
            setCheckoutVisible(false);
            setSubmitting(false);
            Alert.alert("Payment failed", err || "Please try again.");
          }}
        />
      )}

      {/* ── Payment success overlay ── */}
      <Modal visible={paymentSuccessVisible} transparent animationType="none" statusBarTranslucent>
        <View style={s.successBackdrop}>
          <Animated.View style={[
            s.successCard,
            { opacity: successOpacity, transform: [{ scale: successScale }] },
          ]}>
            <View style={s.successIconWrap}>
              <Feather name="check-circle" size={40} color={D.success} />
            </View>
            <Text style={s.successTitle}>Payment Successful!</Text>
            <Text style={s.successSub}>Redirecting to verification…</Text>
          </Animated.View>
        </View>
      </Modal>

    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    backgroundColor:   D.white,
    paddingHorizontal: 16,
    paddingBottom:     10,
    borderBottomWidth: 1,
    borderBottomColor: D.border,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  headerRow: {
    flexDirection: "row",
    alignItems:    "flex-start",
    gap:           10,
    marginBottom:  8,
  },
  backBtn: {
    marginTop: 2,
    padding:   4,
  },
  headerTitle: {
    fontSize:      20,
    fontWeight:    "800",
    color:         D.textDark,
    letterSpacing: -0.4,
  },
  headerSub: {
    fontSize:  12,
    color:     D.textMuted,
    marginTop: 2,
  },

  // Progress circle (small)
  circleWrap: {
    width:          52,
    height:         52,
    borderRadius:   26,
    borderWidth:    3,
    alignItems:     "center",
    justifyContent: "center",
    flexShrink:     0,
  },
  circlePct: {
    fontSize:   13,
    fontWeight: "800",
  },

  // Progress bar
  progressTrack: {
    height:          5,
    backgroundColor: D.divider,
    borderRadius:    3,
    overflow:        "hidden",
    marginBottom:    5,
  },
  progressFill: {
    height:       5,
    borderRadius: 3,
  },
  progressLabel: {
    fontSize:   12,
    fontWeight: "600",
    textAlign:  "right",
  },

  // ── Scroll ──────────────────────────────────────────────────────────────────
  scroll: {
    paddingTop:    12,
    paddingBottom: 120,
  },

  // ── Profile section ─────────────────────────────────────────────────────────
  profileTopRow: {
    flexDirection: "row",
    gap:           14,
    alignItems:    "flex-start",
  },
  selfieBox: {
    width:           88,
    height:          100,
    borderRadius:    14,
    borderWidth:     1.5,
    borderColor:     D.border,
    borderStyle:     "dashed",
    backgroundColor: D.muted,
    alignItems:      "center",
    justifyContent:  "center",
    flexShrink:      0,
    overflow:        "hidden",
  },
  selfieThumb: {
    width:  "100%",
    height: "100%",
  },
  selfieLabel: {
    fontSize:  11,
    fontWeight:"600",
    color:     D.textMuted,
    marginTop: 5,
    textAlign: "center",
  },
  selfieHint: {
    fontSize:  10,
    color:     D.placeholder,
    textAlign: "center",
  },
  selfieCheck: {
    position:       "absolute",
    bottom:         4,
    right:          4,
    backgroundColor: D.white,
    borderRadius:   10,
  },
  profileRight: {
    flex: 1,
  },
  rowSep: {
    height:          1,
    backgroundColor: D.divider,
    marginVertical:  14,
  },

  // Gender
  genderRow: {
    flexDirection: "row",
    gap:           6,
    marginTop:     2,
  },
  genderChip: {
    flex:              1,
    height:            40,
    borderRadius:      10,
    borderWidth:       1.5,
    borderColor:       D.border,
    backgroundColor:   D.inputBg,
    alignItems:        "center",
    justifyContent:    "center",
  },
  genderChipText: {
    fontSize:   12,
    fontWeight: "600",
  },

  // ── Two-column layout ────────────────────────────────────────────────────────
  twoCol: {
    flexDirection: "row",
    gap:           12,
  },

  // ── DL row (DL Number + DL Photo together) ──────────────────────────────────
  dlRow: {
    flexDirection: "row",
    gap:           12,
    alignItems:    "flex-end",
  },
  dlPhotoWrap: {
    gap:       4,
    alignItems:"center",
  },

  // ── Document upload rows ─────────────────────────────────────────────────────
  twoUploadRow: {
    flexDirection: "row",
    gap:           10,
  },
  docGroupLabel: {
    fontSize:      12,
    fontWeight:    "700",
    color:         D.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom:  8,
  },
  docSep: {
    height:          1,
    backgroundColor: D.divider,
    marginVertical:  14,
  },

  // ── Fee row ──────────────────────────────────────────────────────────────────
  feeRow: {
    flexDirection:     "row",
    alignItems:        "center",
    justifyContent:    "space-between",
    marginHorizontal:  16,
    marginBottom:      8,
    paddingVertical:   12,
    paddingHorizontal: 16,
    backgroundColor:   D.white,
    borderRadius:      14,
    borderWidth:       1,
    borderColor:       D.border,
  },
  feeLeft: {
    flexDirection: "row",
    alignItems:    "center",
    gap:           5,
    flex:          1,
  },
  feeLine: {
    fontSize:   13,
    fontWeight: "700",
    color:      D.textDark,
  },
  feeHint: {
    fontSize: 11,
    color:    D.textMuted,
    flex:     1,
  },
  feeAmount: {
    fontSize:   18,
    fontWeight: "800",
    color:      D.primary,
  },

  // ── Footer ───────────────────────────────────────────────────────────────────
  footer: {
    backgroundColor:   D.white,
    paddingHorizontal: 16,
    paddingTop:        14,
    borderTopWidth:    1,
    borderTopColor:    D.border,
    gap:               8,
    shadowColor:       "#000",
    shadowOpacity:     0.06,
    shadowRadius:      10,
    shadowOffset:      { width: 0, height: -3 },
    elevation:         8,
  },
  submitBtn: {
    backgroundColor: D.primary,
    borderRadius:    14,
    height:          52,
    flexDirection:   "row",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             10,
    shadowColor:     D.primary,
    shadowOpacity:   0.35,
    shadowRadius:    12,
    shadowOffset:    { width: 0, height: 5 },
    elevation:       6,
  },
  submitBtnDisabled: {
    backgroundColor: D.border,
    shadowOpacity:   0,
    elevation:       0,
  },
  submitText: {
    fontSize:   16,
    fontWeight: "800",
    color:      D.white,
    letterSpacing: 0.2,
  },
  submittingRow: {
    height:         52,
    borderRadius:   14,
    backgroundColor: D.primary,
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            10,
  },
  submittingText: {
    fontSize:   15,
    fontWeight: "700",
    color:      D.white,
  },
  secureRow: {
    flexDirection:  "row",
    alignItems:     "center",
    justifyContent: "center",
    gap:            5,
  },
  secureText: {
    fontSize: 11,
    color:    D.textMuted,
  },

  // ── Payment success overlay ──────────────────────────────────────────────────
  successBackdrop: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems:      "center",
    justifyContent:  "center",
  },
  successCard: {
    backgroundColor:   D.white,
    borderRadius:      24,
    paddingVertical:   40,
    paddingHorizontal: 36,
    alignItems:        "center",
    gap:               12,
    shadowColor:       "#000",
    shadowOpacity:     0.22,
    shadowRadius:      28,
    shadowOffset:      { width: 0, height: 10 },
    elevation:         20,
    minWidth:          230,
  },
  successIconWrap: {
    width:           72,
    height:          72,
    borderRadius:    36,
    backgroundColor: D.successSoft,
    alignItems:      "center",
    justifyContent:  "center",
    marginBottom:    4,
  },
  successTitle: {
    fontSize:      20,
    fontWeight:    "800",
    color:         D.textDark,
    letterSpacing: -0.3,
  },
  successSub: {
    fontSize: 13,
    color:    D.textMuted,
  },

  // ── Shared helpers ───────────────────────────────────────────────────────────
  white: { color: D.white },
});

const { white: _white } = s;
void _white;
