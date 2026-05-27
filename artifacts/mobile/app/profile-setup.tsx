import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
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

import { useColors } from "@/hooks/useColors";

const VEHICLE_TYPES = [
  { id: "bike", label: "Bike", icon: "wind" },
  { id: "auto", label: "Auto", icon: "truck" },
  { id: "car", label: "Car", icon: "navigation" },
  { id: "ev", label: "EV", icon: "zap" },
] as const;

const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Surat",
];

type Field = {
  name: string;
  city: string;
  dob: string;
  gender: string;
  vehicleNumber: string;
  licenseNumber: string;
};

const GENDERS = ["Male", "Female", "Other"];

function StepBar({ step, total }: { step: number; total: number }) {
  const colors = useColors();
  return (
    <View style={styles.stepBar}>
      {Array.from({ length: total }).map((_, i) => (
        <View
          key={i}
          style={[
            styles.stepSegment,
            {
              backgroundColor: i < step ? colors.primary : colors.border,
              flex: 1,
            },
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
          borderColor: focused ? colors.primary : colors.border,
          backgroundColor: focused ? "#f8fff8" : "#fafafa",
          color: colors.foreground,
        },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize ?? "words"}
      maxLength={maxLength}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export default function ProfileSetupScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const [fields, setFields] = useState<Field>({
    name: "",
    city: "",
    dob: "",
    gender: "",
    vehicleNumber: "",
    licenseNumber: "",
  });
  const [vehicleType, setVehicleType] = useState<string>("");
  const [cityOpen, setCityOpen] = useState(false);

  function set(key: keyof Field) {
    return (val: string) => setFields((f) => ({ ...f, [key]: val }));
  }

  async function pickPhoto() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  }

  const isValid =
    fields.name.trim().length >= 2 &&
    fields.city.length > 0 &&
    vehicleType.length > 0;

  function handleContinue() {
    if (!isValid) return;
    router.push("/document-upload");
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: "#fff" }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={[styles.backBtn, { backgroundColor: "#f5f5f5" }]}
          >
            <Feather name="arrow-left" size={19} color="#0a0a0a" />
          </TouchableOpacity>
          <View style={styles.headerTitle}>
            <Text style={styles.headerLabel}>Profile Setup</Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              Step 3 of 3
            </Text>
          </View>
          <View style={{ width: 38 }} />
        </View>
        <StepBar step={3} total={3} />
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.photoSection}>
          <TouchableOpacity onPress={pickPhoto} activeOpacity={0.8} style={styles.photoWrap}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.photoImg} contentFit="cover" />
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
            Tap to add profile photo
          </Text>
        </View>

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
                  borderColor: cityOpen ? colors.primary : colors.border,
                  backgroundColor: cityOpen ? "#f8fff8" : "#fafafa",
                },
              ]}
              onPress={() => setCityOpen((o) => !o)}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.selectText,
                  {
                    color: fields.city ? colors.foreground : colors.mutedForeground,
                  },
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
                  { borderColor: colors.border, backgroundColor: "#fff" },
                ]}
              >
                {CITIES.map((c) => (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.dropdownItem,
                      {
                        backgroundColor:
                          fields.city === c ? "#f0fdf4" : "transparent",
                        borderBottomColor: colors.border,
                      },
                    ]}
                    onPress={() => {
                      set("city")(c);
                      setCityOpen(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.dropdownText,
                        {
                          color:
                            fields.city === c ? colors.primary : colors.foreground,
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

          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <FormField label="Date of Birth" icon="calendar">
                <TextFieldInput
                  value={fields.dob}
                  onChangeText={set("dob")}
                  placeholder="DD / MM / YYYY"
                  keyboardType="numeric"
                  autoCapitalize="none"
                  maxLength={10}
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
                          borderColor:
                            fields.gender === g ? colors.primary : colors.border,
                          backgroundColor:
                            fields.gender === g ? "#f0fdf4" : "#fafafa",
                        },
                      ]}
                      onPress={() => set("gender")(g)}
                    >
                      <Text
                        style={[
                          styles.genderText,
                          {
                            color:
                              fields.gender === g
                                ? colors.primary
                                : colors.mutedForeground,
                          },
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

          <FormField label="Vehicle Type" icon="truck" required>
            <View style={styles.vehicleRow}>
              {VEHICLE_TYPES.map((v) => {
                const active = vehicleType === v.id;
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={[
                      styles.vehicleChip,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? "#f0fdf4" : "#fafafa",
                      },
                    ]}
                    onPress={() => setVehicleType(v.id)}
                    activeOpacity={0.75}
                  >
                    <Feather
                      name={v.icon as any}
                      size={18}
                      color={active ? colors.primary : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.vehicleLabel,
                        {
                          color: active ? colors.primary : colors.foreground,
                          fontWeight: active ? "700" : "500",
                        },
                      ]}
                    >
                      {v.label}
                    </Text>
                    {active && (
                      <View
                        style={[
                          styles.vehicleCheck,
                          { backgroundColor: colors.primary },
                        ]}
                      >
                        <Feather name="check" size={9} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </FormField>

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
            style={[styles.infoBox, { backgroundColor: "#f0fdf4", borderColor: colors.primary }]}
          >
            <Feather name="info" size={14} color={colors.primary} />
            <Text style={[styles.infoText, { color: colors.foreground }]}>
              Your documents will be verified within 24 hours before you can go online.
            </Text>
          </View>
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
            backgroundColor: "#fff",
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
              : "Fill in name, city and vehicle type to continue."}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.continueBtn,
            { backgroundColor: isValid ? colors.primary : colors.muted },
          ]}
          onPress={handleContinue}
          activeOpacity={0.85}
          disabled={!isValid}
        >
          <Text
            style={[
              styles.continueBtnText,
              { color: isValid ? "#fff" : colors.mutedForeground },
            ]}
          >
            Continue to Dashboard
          </Text>
          <Feather
            name="arrow-right"
            size={18}
            color={isValid ? "#fff" : colors.mutedForeground}
          />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
    backgroundColor: "#fff",
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
  },
  headerTitle: { alignItems: "center" },
  headerLabel: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
  headerSub: { fontSize: 12 },
  stepBar: {
    flexDirection: "row",
    gap: 5,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  stepSegment: { height: 4, borderRadius: 2 },
  scroll: { paddingHorizontal: 20, paddingTop: 24, gap: 22 },
  photoSection: { alignItems: "center", gap: 10 },
  photoWrap: { width: 100, height: 100, position: "relative" },
  photoImg: {
    width: 100,
    height: 100,
    borderRadius: 50,
  },
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
  photoHint: { fontSize: 13 },
  form: { gap: 18 },
  fieldGroup: { gap: 7 },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  fieldLabel: { fontSize: 12, fontWeight: "600", letterSpacing: 0.2 },
  textInput: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    fontWeight: "500",
  },
  selectInput: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectText: { fontSize: 15, fontWeight: "500" },
  dropdown: {
    borderWidth: 1.5,
    borderRadius: 12,
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
  row: { flexDirection: "row", gap: 12 },
  genderRow: { flexDirection: "column", gap: 6 },
  genderChip: {
    height: 36,
    borderWidth: 1.5,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  genderText: { fontSize: 12, fontWeight: "600" },
  vehicleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  vehicleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    position: "relative",
  },
  vehicleLabel: { fontSize: 14 },
  vehicleCheck: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    alignItems: "flex-start",
  },
  infoText: { fontSize: 13, flex: 1, lineHeight: 19 },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 14,
    borderTopWidth: 1,
    gap: 10,
  },
  footerMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerMetaText: { fontSize: 12 },
  continueBtn: {
    height: 56,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtnText: { fontSize: 17, fontWeight: "700" },
});
