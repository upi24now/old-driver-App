/**
 * profile-setup.tsx — Step 3 of 4
 *
 * UI redesign: card-based layout with gradient Driver Profile card,
 * personal info card, selected vehicle card, vehicle details card,
 * and verification info card.
 *
 * All Firebase/Firestore/navigation logic is unchanged.
 */

import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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

import { useDriver } from "@/contexts/DriverContext";

// ─── Design tokens (matches vehicle-selection style) ─────────────────────────
const D = {
  bg:          "#F8FAFC",
  white:       "#FFFFFF",
  primary:     "#E83272",
  primarySoft: "#FFF1F5",
  primaryBold: "#C41E5A",
  success:     "#10B981",
  successBg:   "#D1FAE5",
  textDark:    "#111827",
  textMuted:   "#6B7280",
  border:      "#E5E7EB",
  muted:       "#F3F4F6",
  mutedFg:     "#9CA3AF",
  placeholder: "#B0B8C1",
} as const;

const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Surat",
];

const GENDERS = ["Male", "Female", "Other"] as const;

// ─── DOB formatter ────────────────────────────────────────────────────────────
function formatDob(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} / ${d.slice(2)}`;
  return `${d.slice(0, 2)} / ${d.slice(2, 4)} / ${d.slice(4)}`;
}

// ─── Image picker helpers (allowsEditing: false = avoids Android UCrop bug) ──
async function requestCamera(): Promise<boolean> {
  const { status, canAskAgain } = await ImagePicker.requestCameraPermissionsAsync();
  if (status === "granted") return true;
  Alert.alert(
    "Camera permission required",
    canAskAgain
      ? "Please allow camera access to take a photo."
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

async function fromCamera(): Promise<string | null> {
  if (!(await requestCamera())) return null;
  try {
    const r = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    if (r.canceled || !r.assets?.length) return null;
    return r.assets[0].uri;
  } catch {
    Alert.alert("Camera error", "Could not open camera. Please try again.");
    return null;
  }
}

async function fromGallery(): Promise<string | null> {
  if (!(await requestGallery())) return null;
  try {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      quality: 0.85,
    });
    if (r.canceled || !r.assets?.length) return null;
    return r.assets[0].uri;
  } catch {
    Alert.alert("Gallery error", "Could not open gallery. Please try again.");
    return null;
  }
}

// ─── Progress dot-and-line (4 steps) ─────────────────────────────────────────
function ProgressDots({ step }: { step: number }) {
  return (
    <View style={styles.progressRow}>
      {[1, 2, 3, 4].map((s, i) => (
        <View key={s} style={styles.progressSegment}>
          <View
            style={[
              styles.stepDot,
              s <= step
                ? { backgroundColor: D.primary }
                : { backgroundColor: D.border, borderWidth: 2, borderColor: "#D1D5DB" },
            ]}
          >
            {s <= step && <Feather name="check" size={9} color="#fff" />}
          </View>
          {i < 3 && (
            <View
              style={[
                styles.progressLine,
                { backgroundColor: s < step ? D.primary : D.border },
              ]}
            />
          )}
        </View>
      ))}
    </View>
  );
}

// ─── Section card wrapper ─────────────────────────────────────────────────────
function SectionCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function CardTitle({ label, icon }: { label: string; icon?: React.ComponentProps<typeof Feather>["name"] }) {
  return (
    <View style={styles.cardTitleRow}>
      {icon && (
        <View style={styles.cardTitleIconBox}>
          <Feather name={icon} size={14} color={D.primary} />
        </View>
      )}
      <Text style={styles.cardTitleText}>{label}</Text>
    </View>
  );
}

// ─── Form input ───────────────────────────────────────────────────────────────
function FieldInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
  required,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: "default" | "numeric" | "email-address";
  autoCapitalize?: "none" | "words" | "characters";
  maxLength?: number;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>
        {label}
        {required && <Text style={{ color: D.primary }}> *</Text>}
      </Text>
      <TextInput
        style={[
          styles.textInput,
          {
            borderColor:     focused ? D.primary   : D.border,
            backgroundColor: focused ? D.primarySoft : D.muted,
            color: D.textDark,
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
    </View>
  );
}

// ─── DOB input ────────────────────────────────────────────────────────────────
function DobInput({ value, onChangeText }: { value: string; onChangeText: (t: string) => void }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>Date of Birth</Text>
      <TextInput
        style={[
          styles.textInput,
          {
            borderColor:     focused ? D.primary    : D.border,
            backgroundColor: focused ? D.primarySoft: D.muted,
            color: D.textDark,
            letterSpacing: 0.5,
          },
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder="DD / MM / YYYY"
        placeholderTextColor={D.placeholder}
        keyboardType="numeric"
        autoCapitalize="none"
        maxLength={14}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
    </View>
  );
}

// ─── Vehicle data for the summary card ───────────────────────────────────────
const VEHICLE_META: Record<string, { mcIcon: string; gradStart: string; gradEnd: string }> = {
  bike:        { mcIcon: "motorbike",     gradStart: "#FF6B9D", gradEnd: "#9B59B6" },
  scooter:     { mcIcon: "motorbike",     gradStart: "#FF8C69", gradEnd: "#FFA726" },
  "auto-pass": { mcIcon: "car-side",      gradStart: "#FFD43B", gradEnd: "#FFA726" },
  "auto-cargo":{ mcIcon: "truck-delivery",gradStart: "#FB923C", gradEnd: "#F59E0B" },
  "mini-car":  { mcIcon: "car",           gradStart: "#38BDF8", gradEnd: "#2563EB" },
  sedan:       { mcIcon: "car-side",      gradStart: "#818CF8", gradEnd: "#4338CA" },
  suv:         { mcIcon: "car",           gradStart: "#2DD4BF", gradEnd: "#0D9488" },
  "tata-ace":  { mcIcon: "truck-delivery",gradStart: "#4ADE80", gradEnd: "#16A34A" },
  pickup:      { mcIcon: "truck",         gradStart: "#A3E635", gradEnd: "#65A30D" },
  "mini-truck":{ mcIcon: "truck",         gradStart: "#22D3EE", gradEnd: "#0EA5E9" },
  eicher:      { mcIcon: "truck",         gradStart: "#94A3B8", gradEnd: "#3B82F6" },
  "truck-14ft":{ mcIcon: "truck",         gradStart: "#C084FC", gradEnd: "#6D28D9" },
  // legacy ids from the old 4-vehicle screen
  auto:        { mcIcon: "car-side",      gradStart: "#FFD43B", gradEnd: "#FFA726" },
  truck:       { mcIcon: "truck",         gradStart: "#4ADE80", gradEnd: "#16A34A" },
};

function vehicleMeta(id: string) {
  return VEHICLE_META[id] ?? { mcIcon: "car", gradStart: "#94A3B8", gradEnd: "#6B7280" };
}

// ─── Main screen ──────────────────────────────────────────────────────────────
type Fields = {
  name: string;
  city: string;
  dob: string;
  gender: string;
  vehicleNumber: string;
  licenseNumber: string;
};

export default function ProfileSetupScreen() {
  console.log("[SCREEN_MOUNT] profile-setup");
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { setProfile, vehicle } = useDriver();

  const [photo,        setPhoto]        = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);
  const [cityOpen,     setCityOpen]     = useState(false);

  const [fields, setFields] = useState<Fields>({
    name: "", city: "", dob: "", gender: "",
    vehicleNumber: "", licenseNumber: "",
  });

  function set(key: keyof Fields) {
    return (val: string) => setFields((f) => ({ ...f, [key]: val }));
  }

  function handleDobChange(raw: string) {
    setFields((f) => ({ ...f, dob: formatDob(raw) }));
  }

  function handlePickPhoto() {
    Alert.alert(
      "Profile Photo",
      "Choose how to add your photo",
      [
        {
          text: "Take Selfie (Front Camera)",
          onPress: async () => {
            setPhotoLoading(true);
            const uri = await fromCamera();
            setPhotoLoading(false);
            if (uri) setPhoto(uri);
          },
        },
        {
          text: "Choose from Gallery",
          onPress: async () => {
            setPhotoLoading(true);
            const uri = await fromGallery();
            setPhotoLoading(false);
            if (uri) setPhoto(uri);
          },
        },
        { text: "Cancel", style: "cancel" },
      ],
      { cancelable: true },
    );
  }

  const isValid = fields.name.trim().length >= 2 && fields.city.length > 0;

  function handleContinue() {
    if (!isValid) return;
    setProfile({
      name:          fields.name.trim(),
      city:          fields.city,
      gender:        fields.gender,
      licenseNumber: fields.licenseNumber.trim(),
      vehicleNumber: fields.vehicleNumber.trim(),
    });
    router.push("/document-upload");
  }

  const vMeta = vehicle ? vehicleMeta(vehicle.id) : null;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: D.bg }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color={D.textDark} />
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Profile Setup</Text>
            <Text style={styles.headerSub}>Step 3 of 4</Text>
          </View>

          <View style={{ width: 38 }} />
        </View>

        <ProgressDots step={3} />
      </View>

      {/* ── Scroll ── */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 180 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ─── 1. Driver Profile Card ─── */}
        <SectionCard>
          {/* Gradient banner */}
          <LinearGradient
            colors={["#F43F8F", "#E83272"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.profileBanner}
          >
            <Text style={styles.profileBannerTitle}>Driver Profile</Text>
            <Text style={styles.profileBannerSub}>Add your basic driver info</Text>
          </LinearGradient>

          {/* Photo section */}
          <View style={styles.photoSection}>
            <TouchableOpacity
              onPress={handlePickPhoto}
              activeOpacity={0.8}
              style={styles.photoWrap}
              disabled={photoLoading}
            >
              {photoLoading ? (
                <View style={styles.photoCircle}>
                  <ActivityIndicator size="small" color={D.primary} />
                </View>
              ) : photo ? (
                <Image
                  source={{ uri: photo }}
                  style={styles.photoImg}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={styles.photoCircle}>
                  <Feather name="user" size={34} color={D.primary} />
                </View>
              )}
              <View style={styles.cameraChip}>
                <Feather name="camera" size={12} color="#fff" />
              </View>
            </TouchableOpacity>

            <Text style={styles.photoHint}>
              {photo ? "Tap to change photo" : "Upload Profile Photo"}
            </Text>

            <View style={styles.photoTagsRow}>
              <View style={styles.photoTag}>
                <Feather name="camera" size={10} color={D.textMuted} />
                <Text style={styles.photoTagText}>Camera</Text>
              </View>
              <View style={styles.photoTagDot} />
              <View style={styles.photoTag}>
                <Feather name="image" size={10} color={D.textMuted} />
                <Text style={styles.photoTagText}>Gallery</Text>
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ─── 2. Personal Information Card ─── */}
        <SectionCard>
          <CardTitle label="Personal Information" icon="user" />

          <FieldInput
            label="Full Name"
            required
            value={fields.name}
            onChangeText={set("name")}
            placeholder="Enter your full name"
            autoCapitalize="words"
          />

          {/* City dropdown */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              City <Text style={{ color: D.primary }}>*</Text>
            </Text>
            <TouchableOpacity
              style={[
                styles.textInput,
                styles.selectRow,
                {
                  borderColor:     cityOpen ? D.primary : D.border,
                  backgroundColor: cityOpen ? D.primarySoft : D.muted,
                },
              ]}
              onPress={() => setCityOpen((o) => !o)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.selectText,
                  { color: fields.city ? D.textDark : D.placeholder },
                ]}
              >
                {fields.city || "Select your city"}
              </Text>
              <Feather
                name={cityOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={D.textMuted}
              />
            </TouchableOpacity>

            {cityOpen && (
              <View style={styles.dropdown}>
                {CITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.dropdownItem,
                      fields.city === c && { backgroundColor: D.primarySoft },
                    ]}
                    onPress={() => { set("city")(c); setCityOpen(false); }}
                  >
                    <Text
                      style={[
                        styles.dropdownText,
                        { color: fields.city === c ? D.primary : D.textDark, fontWeight: fields.city === c ? "700" : "400" },
                      ]}
                    >
                      {c}
                    </Text>
                    {fields.city === c && <Feather name="check" size={14} color={D.primary} />}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

          {/* DOB + Gender row */}
          <View style={styles.twoColRow}>
            <View style={{ flex: 1 }}>
              <DobInput value={fields.dob} onChangeText={handleDobChange} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Gender</Text>
                <View style={styles.genderRow}>
                  {GENDERS.map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.genderChip,
                        {
                          backgroundColor: fields.gender === g ? D.primary : D.muted,
                          borderColor:     fields.gender === g ? D.primary : D.border,
                        },
                      ]}
                      onPress={() => set("gender")(g)}
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.genderChipText,
                          { color: fields.gender === g ? "#fff" : D.textMuted },
                        ]}
                      >
                        {g}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>
          </View>
        </SectionCard>

        {/* ─── 3. Selected Vehicle Card ─── */}
        <SectionCard>
          <CardTitle label="Selected Vehicle" icon="truck" />

          {vehicle && vMeta ? (
            <View style={styles.vehicleRow}>
              <LinearGradient
                colors={[vMeta.gradStart, vMeta.gradEnd]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.vehicleThumb}
              >
                <MaterialCommunityIcons
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  name={vMeta.mcIcon as any}
                  size={22}
                  color="#fff"
                />
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleName}>{vehicle.name}</Text>
                <Text style={styles.vehicleId}>Vehicle type selected in Step 2</Text>
              </View>
              <View style={styles.vehicleCheck}>
                <Feather name="check" size={14} color={D.success} />
              </View>
            </View>
          ) : (
            <View style={styles.vehicleEmpty}>
              <Feather name="alert-circle" size={16} color={D.mutedFg} />
              <Text style={styles.vehicleEmptyText}>
                No vehicle selected — go back and choose a vehicle
              </Text>
            </View>
          )}
        </SectionCard>

        {/* ─── 4. Vehicle Details Card ─── */}
        <SectionCard>
          <CardTitle label="Vehicle Details" icon="key" />

          <FieldInput
            label="Vehicle Number"
            value={fields.vehicleNumber}
            onChangeText={(t) => set("vehicleNumber")(t.toUpperCase())}
            placeholder="e.g. MH 01 AB 1234"
            autoCapitalize="characters"
            maxLength={13}
          />

          <FieldInput
            label="License Number"
            value={fields.licenseNumber}
            onChangeText={(t) => set("licenseNumber")(t.toUpperCase())}
            placeholder="e.g. MH0120240001234"
            autoCapitalize="characters"
            maxLength={16}
          />
        </SectionCard>

        {/* ─── 5. Verification Info Card ─── */}
        <View style={styles.verifyCard}>
          <View style={styles.verifyIconWrap}>
            <Feather name="shield" size={20} color="#047857" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.verifyTitle}>Verification Process</Text>
            <Text style={styles.verifySub}>
              Your profile and documents will be reviewed before you can go online.
              Expected approval within 24 hours.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Sticky Footer ── */}
      <View
        style={[
          styles.footer,
          { paddingBottom: insets.bottom + 14 },
        ]}
      >
        <View style={styles.footerHint}>
          <Feather
            name={isValid ? "check-circle" : "info"}
            size={13}
            color={isValid ? D.success : D.mutedFg}
          />
          <Text style={styles.footerHintText}>
            {isValid
              ? "Looks good! Ready to continue."
              : "Fill in your name and city to continue."}
          </Text>
        </View>

        <Pressable
          onPress={handleContinue}
          disabled={!isValid}
          style={({ pressed }) => [
            styles.ctaWrap,
            { opacity: pressed && isValid ? 0.88 : 1 },
          ]}
        >
          <LinearGradient
            colors={isValid ? ["#F43F8F", "#E83272"] : ["#E5E7EB", "#E5E7EB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            <Text style={[styles.ctaText, !isValid && { color: D.mutedFg }]}>
              Continue to Documents
            </Text>
            <Feather
              name="arrow-right"
              size={18}
              color={isValid ? "#fff" : D.mutedFg}
            />
          </LinearGradient>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header
  header: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    gap: 10,
    zIndex: 10,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.3,
  },
  headerSub: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 1,
  },

  // Progress
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  progressSegment: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  progressLine: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    marginHorizontal: -1,
  },

  // Scroll
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },

  // Card
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  cardTitleIconBox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: "rgba(232,50,114,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitleText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.2,
  },

  // Driver profile card
  profileBanner: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 3,
  },
  profileBannerTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  profileBannerSub: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.85)",
  },

  photoSection: {
    alignItems: "center",
    paddingVertical: 18,
    gap: 8,
  },
  photoWrap: {
    width: 90,
    height: 90,
    position: "relative",
  },
  photoCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#E5E7EB",
  },
  photoImg: {
    width: 90,
    height: 90,
    borderRadius: 45,
  },
  cameraChip: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#E83272",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#FFFFFF",
  },
  photoHint: {
    fontSize: 13,
    fontWeight: "600",
    color: "#6B7280",
  },
  photoTagsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  photoTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  photoTagText: {
    fontSize: 11,
    fontWeight: "500",
    color: "#9CA3AF",
  },
  photoTagDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: "#D1D5DB",
  },

  // Form fields
  fieldGroup: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 6,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#6B7280",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  textInput: {
    height: 50,
    borderWidth: 1.5,
    borderRadius: 13,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "500",
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 50,
  },
  selectText: {
    fontSize: 15,
    fontWeight: "500",
  },
  dropdown: {
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 13,
    marginTop: 4,
    overflow: "hidden",
    maxHeight: 200,
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownText: { fontSize: 14 },

  twoColRow: {
    flexDirection: "row",
    gap: 0,
  },
  genderRow: {
    flexDirection: "row",
    gap: 6,
    flexWrap: "wrap",
  },
  genderChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  genderChipText: {
    fontSize: 12,
    fontWeight: "700",
  },

  // Selected vehicle card
  vehicleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  vehicleThumb: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleName: {
    fontSize: 15,
    fontWeight: "800",
    color: "#111827",
    letterSpacing: -0.2,
  },
  vehicleId: {
    fontSize: 11,
    fontWeight: "500",
    color: "#6B7280",
    marginTop: 2,
  },
  vehicleCheck: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#D1FAE5",
    alignItems: "center",
    justifyContent: "center",
  },
  vehicleEmpty: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  vehicleEmptyText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#9CA3AF",
    flex: 1,
  },

  // Verification card
  verifyCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    backgroundColor: "#D1FAE5",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#6EE7B7",
    padding: 14,
  },
  verifyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#A7F3D0",
    alignItems: "center",
    justifyContent: "center",
  },
  verifyTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#065F46",
    marginBottom: 4,
  },
  verifySub: {
    fontSize: 12,
    fontWeight: "500",
    color: "#047857",
    lineHeight: 18,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  footerHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  footerHintText: {
    fontSize: 12,
    fontWeight: "500",
    color: "#6B7280",
    flex: 1,
  },
  ctaWrap: {
    borderRadius: 14,
    shadowColor: "#E83272",
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  ctaGradient: {
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
});
