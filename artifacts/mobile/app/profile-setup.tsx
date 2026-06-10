import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { TS } from "@/constants/typography";

// ─── Constants ────────────────────────────────────────────────────────────────

const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Surat",
];

const GENDERS = ["Male", "Female", "Other"];

// ─── DOB masking ─────────────────────────────────────────────────────────────
// Formats raw digit input into "DD / MM / YYYY" as the user types.
// allowsEditing:false means we never hit the Android UCrop bug.

function formatDob(raw: string): string {
  // Keep only digits, cap at 8 (DDMMYYYY)
  const d = raw.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} / ${d.slice(2)}`;
  return `${d.slice(0, 2)} / ${d.slice(2, 4)} / ${d.slice(4)}`;
}

// ─── Image picker helpers (Expo Go-compatible) ────────────────────────────────
// allowsEditing: false — prevents Android UCrop activity from silently
// dropping the result in Expo Go (the #1 cause of "image not returned").

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
      allowsEditing: false, // ← critical: avoids Android UCrop result-drop bug
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
      allowsEditing: false, // ← critical: avoids Android UCrop result-drop bug
      quality: 0.85,
    });
    if (r.canceled || !r.assets?.length) return null;
    return r.assets[0].uri;
  } catch {
    Alert.alert("Gallery error", "Could not open gallery. Please try again.");
    return null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepBar({ step, total }: { step: number; total: number }) {
  const colors = useColors();
  return (
    <View style={styles.stepBar}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stepSegment,
            { backgroundColor: i < step ? colors.primary : colors.border, flex: 1 },
          ]}
        />
      ))}
    </View>
  );
}

function FormField({
  label,
  icon,
  children,
  required,
}: {
  label: string;
  icon: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.fieldGroup}>
      <View style={styles.fieldLabelRow}>
        <Feather name={icon as any} size={13} color={colors.mutedForeground} />
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
          {label}
          {required && <Text style={{ color: colors.primary }}> *</Text>}
        </Text>
      </View>
      {children}
    </View>
  );
}

function TextFieldInput({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  keyboardType?: any;
  autoCapitalize?: any;
  maxLength?: number;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[
        styles.textInput,
        {
          borderColor:     focused ? colors.primary         : colors.border,
          backgroundColor: focused ? colors.primarySoft     : colors.surfaceElevated,
          color:           colors.foreground,
        },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textPlaceholder}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize ?? "words"}
      maxLength={maxLength}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

type Field = {
  name: string;
  city: string;
  dob: string;
  gender: string;
  vehicleNumber: string;
  licenseNumber: string;
};

export default function ProfileSetupScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const router  = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const { setProfile } = useDriver();

  const [photo, setPhoto]             = useState<string | null>(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  const [fields, setFields] = useState<Field>({
    name: "", city: "", dob: "", gender: "",
    vehicleNumber: "", licenseNumber: "",
  });
  const [cityOpen, setCityOpen] = useState(false);

  function set(key: keyof Field) {
    return (val: string) => setFields((f) => ({ ...f, [key]: val }));
  }

  // DOB: strip non-digits then reformat on every keystroke
  function handleDobChange(raw: string) {
    setFields((f) => ({ ...f, dob: formatDob(raw) }));
  }

  // ── Photo picker ──
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

  // ── Render ──
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 12,
            backgroundColor:   colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          >
            <Feather name="arrow-left" size={19} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Text style={[styles.headerLabel, { color: colors.foreground }]}>Profile Setup</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Step 3 of 3
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <StepBar step={3} total={3} />
      </View>

      {/* ── Scroll ── */}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Profile photo */}
        <View style={styles.photoSection}>
          <TouchableOpacity
            onPress={handlePickPhoto}
            activeOpacity={0.8}
            style={styles.photoWrap}
            disabled={photoLoading}
          >
            {photoLoading ? (
              <View style={[styles.photoPlaceholder, { backgroundColor: colors.muted }]}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : photo ? (
              <Image source={{ uri: photo }} style={styles.photoImg} contentFit="cover" transition={200} />
            ) : (
              <View style={[styles.photoPlaceholder, { backgroundColor: colors.muted }]}>
                <Feather name="user" size={36} color={colors.mutedForeground} />
              </View>
            )}
            <View style={[styles.cameraBtn, { backgroundColor: colors.primary }]}>
              <Feather name="camera" size={14} color="#fff" />
            </View>
          </TouchableOpacity>

          <Text style={[styles.photoHint, { color: colors.mutedForeground }]}>
            {photo ? "Tap to change photo" : "Tap to add profile photo"}
          </Text>

          {/* Source tags */}
          <View style={styles.photoTags}>
            <View style={styles.photoTag}>
              <Feather name="camera" size={9} color={colors.mutedForeground} />
              <Text style={[styles.photoTagText, { color: colors.mutedForeground }]}>Camera</Text>
            </View>
            <View style={[styles.photoTagDot, { backgroundColor: colors.borderStrong }]} />
            <View style={styles.photoTag}>
              <Feather name="image" size={9} color={colors.mutedForeground} />
              <Text style={[styles.photoTagText, { color: colors.mutedForeground }]}>Gallery</Text>
            </View>
          </View>
        </View>

        {/* Form */}
        <View style={styles.form}>
          <FormField label="Full Name" icon="user" required>
            <TextFieldInput
              value={fields.name}
              onChangeText={set("name")}
              placeholder="Enter your full name"
              autoCapitalize="words"
            />
          </FormField>

          <FormField label="City" icon="map-pin" required>
            <TouchableOpacity
              style={[
                styles.selectInput,
                {
                  borderColor:     cityOpen ? colors.primary         : colors.border,
                  backgroundColor: cityOpen ? colors.primarySoft     : colors.surfaceElevated,
                },
              ]}
              onPress={() => setCityOpen((o) => !o)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.selectText,
                  { color: fields.city ? colors.foreground : colors.textPlaceholder },
                ]}
              >
                {fields.city || "Select your city"}
              </Text>
              <Feather
                name={cityOpen ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>

            {cityOpen && (
              <View
                style={[
                  styles.dropdown,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                {CITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.dropdownItem,
                      {
                        backgroundColor:  fields.city === c ? colors.primarySoft : "transparent",
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => { set("city")(c); setCityOpen(false); }}
                  >
                    <Text
                      style={[
                        styles.dropdownText,
                        {
                          color:      fields.city === c ? colors.primary : colors.foreground,
                          fontWeight: fields.city === c ? "700" : "400",
                        },
                      ]}
                    >
                      {c}
                    </Text>
                    {fields.city === c && (
                      <Feather name="check" size={14} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </FormField>

          {/* DOB + Gender row */}
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <FormField label="Date of Birth" icon="calendar">
                {/* Dedicated DOB input — numeric keyboard, auto-formatted */}
                <DobInput
                  value={fields.dob}
                  onChangeText={handleDobChange}
                />
              </FormField>
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Gender" icon="users">
                <View style={styles.genderRow}>
                  {GENDERS.map((g) => (
                    <TouchableOpacity
                      key={g}
                      style={[
                        styles.genderChip,
                        {
                          borderColor:     fields.gender === g ? colors.primary         : colors.border,
                          backgroundColor: fields.gender === g ? colors.primarySoft     : colors.surfaceElevated,
                        },
                      ]}
                      onPress={() => set("gender")(g)}
                    >
                      <Text
                        style={[
                          styles.genderText,
                          { color: fields.gender === g ? colors.primary : colors.mutedForeground },
                        ]}
                      >
                        {g}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </FormField>
            </View>
          </View>

          <FormField label="Vehicle Number" icon="hash">
            <TextFieldInput
              value={fields.vehicleNumber}
              onChangeText={(t) => set("vehicleNumber")(t.toUpperCase())}
              placeholder="e.g. MH 01 AB 1234"
              autoCapitalize="characters"
              maxLength={13}
            />
          </FormField>

          <FormField label="License Number" icon="credit-card">
            <TextFieldInput
              value={fields.licenseNumber}
              onChangeText={(t) => set("licenseNumber")(t.toUpperCase())}
              placeholder="e.g. MH0120240001234"
              autoCapitalize="characters"
              maxLength={16}
            />
          </FormField>

          <View
            style={[
              styles.infoBox,
              { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            ]}
          >
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              Your documents will be verified within 24 hours before you can go online.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ── Footer ── */}
      <View
        style={[
          styles.footer,
          {
            paddingBottom:   insets.bottom + 16,
            borderTopColor:  colors.border,
            backgroundColor: colors.surface,
          },
        ]}
      >
        <View style={styles.footerMeta}>
          <Feather
            name="check-circle"
            size={13}
            color={isValid ? colors.primary : colors.border}
          />
          <Text style={[styles.footerMetaText, { color: colors.mutedForeground }]}>
            {isValid
              ? "Looks good! You can continue."
              : "Fill in your name and city to continue."}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.continueBtn,
            {
              backgroundColor: isValid ? colors.primary : colors.muted,
              shadowColor:     isValid ? colors.primary : "transparent",
              shadowOpacity:   isValid ? 0.28 : 0,
              elevation:       isValid ? 6    : 0,
            },
          ]}
          onPress={handleContinue}
          activeOpacity={0.85}
          disabled={!isValid}
        >
          <Text style={[styles.continueBtnText, !isValid && { color: colors.mutedForeground }]}>
            Continue to Dashboard
          </Text>
          {isValid && <Feather name="arrow-right" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

// ─── DOB input component ──────────────────────────────────────────────────────
// Separate component so it can manage its own focus state cleanly.
// maxLength = 14 → "DD / MM / YYYY"

function DobInput({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (raw: string) => void;
}) {
  const colors = useColors();
  const [focused, setFocused] = useState(false);

  return (
    <TextInput
      style={[
        styles.textInput,
        {
          borderColor:     focused ? colors.primary     : colors.border,
          backgroundColor: focused ? colors.primarySoft : colors.surfaceElevated,
          color:           colors.foreground,
          letterSpacing:   0.5,
        },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder="DD / MM / YYYY"
      placeholderTextColor={colors.textPlaceholder}
      keyboardType="numeric"
      autoCapitalize="none"
      maxLength={14}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Header — bg/border injected inline
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  headerTitle: { alignItems: "center" },
  headerLabel: { ...TS.h3 },
  headerSub:   { ...TS.bodySm, marginTop: 2 },

  stepBar: {
    flexDirection: "row",
    gap: 5,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  stepSegment: { height: 4, borderRadius: 2 },

  // Scroll
  scroll: { paddingHorizontal: 20, paddingTop: 24, gap: 22 },

  // Photo section
  photoSection: { alignItems: "center", gap: 8 },
  photoWrap:    { width: 100, height: 100, position: "relative" },
  photoImg:     { width: 100, height: 100, borderRadius: 50 },
  photoPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBtn: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
  },
  photoHint: { ...TS.bodySm },
  photoTags: { flexDirection: "row", alignItems: "center", gap: 6 },
  photoTag:  { flexDirection: "row", alignItems: "center", gap: 3 },
  photoTagText: { ...TS.label, fontSize: 10, textTransform: "none", letterSpacing: 0 },
  photoTagDot:  { width: 3, height: 3, borderRadius: 1.5 },

  // Form
  form:          { gap: 18 },
  fieldGroup:    { gap: 7 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  fieldLabel:    { ...TS.bodySm, fontWeight: "600", letterSpacing: 0.2 },

  // Text input — bg/border/color injected inline
  textInput: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "500",
  },

  // City select — bg/border injected inline
  selectInput: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectText: { fontSize: 15, fontWeight: "500" },

  // Dropdown — bg/border injected inline
  dropdown: {
    borderWidth: 1.5,
    borderRadius: 14,
    marginTop: 4,
    overflow: "hidden",
    maxHeight: 220,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  dropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownText: { fontSize: 14 },

  // Row (DOB + Gender)
  row:       { flexDirection: "row", gap: 12 },
  genderRow: { flexDirection: "column", gap: 6 },
  genderChip: {
    height: 36,
    borderWidth: 1.5,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  genderText: { ...TS.bodySm, fontWeight: "600" },

  // Info box — bg/border injected inline
  infoBox: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: "flex-start",
  },
  infoText: { ...TS.bodySm, flex: 1, lineHeight: 19 },

  // Footer — bg/border injected inline
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerMeta:     { flexDirection: "row", alignItems: "center", gap: 6 },
  footerMetaText: { ...TS.bodySm },

  // Continue button — bg/shadow injected inline
  continueBtn: {
    height: 56,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  continueBtnText: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
  },
});
