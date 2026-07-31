/**
 * signup-form.tsx — V3 Phase 6: New Driver Signup Form
 *
 * Responsibility (ONE):
 *   Collect new-driver profile data (name, phone, city, gender, vehicle),
 *   then send an OTP and navigate to the OTP verification screen.
 *
 * No B2 dependencies.
 */

import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { v3Store }   from "@/utils/auth-v3-store";
import { v3SendOtp } from "@/utils/auth-v3-api";
import { V3_VEHICLES } from "@/utils/auth-v3-api";

const GENDERS = ["Male", "Female", "Other"] as const;

export default function SignupFormScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [name,          setName]          = useState("");
  const [city,          setCity]          = useState("");
  const [phone,         setPhone]         = useState("");
  const [gender,        setGender]        = useState<string>("");
  const [vehicleId,     setVehicleId]     = useState("");
  const [vehicleName,   setVehicleName]   = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");

  const [error, setError] = useState("");
  const [busy,  setBusy]  = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    city.trim().length > 0 &&
    phone.length === 10 &&
    gender.length > 0 &&
    vehicleId.length > 0;

  const handleContinue = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    const fullPhone = `+91${phone}`;

    const result = await v3SendOtp(fullPhone);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    // Save to store so downstream screens can access them
    v3Store.setPhone(fullPhone);
    v3Store.setOtpId(result.otpId);
    v3Store.setSignup({
      name:          name.trim(),
      city:          city.trim(),
      gender,
      vehicleId,
      vehicleName,
      licenseNumber: licenseNumber.trim(),
      vehicleNumber: vehicleNumber.trim(),
    });

    router.push("/auth-v3/otp?intent=signup");
  };

  return (
    <KeyboardAvoidingView
      style={ss.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        style={ss.bg}
        contentContainerStyle={[
          ss.scroll,
          { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={ss.backBtn} onPress={() => router.back()}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Create Account</Text>
        <Text style={ss.sub}>Fill in your details to get started.</Text>

        {/* Full Name */}
        <Text style={ss.label}>Full Name</Text>
        <TextInput
          style={ss.input}
          value={name}
          onChangeText={(v) => { setError(""); setName(v); }}
          placeholder="Your full name"
          placeholderTextColor={C.placeholder}
          autoCapitalize="words"
          editable={!busy}
        />

        {/* City */}
        <Text style={ss.label}>City</Text>
        <TextInput
          style={ss.input}
          value={city}
          onChangeText={(v) => { setError(""); setCity(v); }}
          placeholder="Your city"
          placeholderTextColor={C.placeholder}
          autoCapitalize="words"
          editable={!busy}
        />

        {/* Mobile */}
        <Text style={ss.label}>Mobile Number</Text>
        <View style={ss.phoneRow}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>+91</Text>
          </View>
          <TextInput
            style={ss.phoneInput}
            value={phone}
            onChangeText={(v) => {
              setError("");
              setPhone(v.replace(/\D/g, "").slice(0, 10));
            }}
            placeholder="10-digit number"
            placeholderTextColor={C.placeholder}
            keyboardType="number-pad"
            maxLength={10}
            editable={!busy}
          />
        </View>

        {/* Gender */}
        <Text style={ss.label}>Gender</Text>
        <View style={ss.chipRow}>
          {GENDERS.map((g) => (
            <Pressable
              key={g}
              style={[ss.chip, gender === g && ss.chipSelected]}
              onPress={() => { setError(""); setGender(g); }}
              disabled={busy}
            >
              <Text style={[ss.chipLabel, gender === g && ss.chipLabelSelected]}>{g}</Text>
            </Pressable>
          ))}
        </View>

        {/* Vehicle Type */}
        <Text style={ss.label}>Vehicle Type</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={ss.vehicleScroll}
          contentContainerStyle={{ gap: 8 }}
        >
          {V3_VEHICLES.map((v) => (
            <Pressable
              key={v.id}
              style={[ss.chip, vehicleId === v.id && ss.chipSelected]}
              onPress={() => {
                setError("");
                setVehicleId(v.id);
                setVehicleName(v.name);
              }}
              disabled={busy}
            >
              <Text style={[ss.chipLabel, vehicleId === v.id && ss.chipLabelSelected]}>
                {v.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Optional */}
        <Text style={ss.label}>
          License Number <Text style={ss.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={ss.input}
          value={licenseNumber}
          onChangeText={(v) => setLicenseNumber(v.toUpperCase())}
          placeholder="e.g. KA01 20230012345"
          placeholderTextColor={C.placeholder}
          autoCapitalize="characters"
          editable={!busy}
        />

        <Text style={ss.label}>
          Vehicle Number <Text style={ss.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={ss.input}
          value={vehicleNumber}
          onChangeText={(v) => setVehicleNumber(v.toUpperCase())}
          placeholder="e.g. KA01AB1234"
          placeholderTextColor={C.placeholder}
          autoCapitalize="characters"
          editable={!busy}
        />

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (!canSubmit || busy) && ss.btnDisabled]}
          onPress={handleContinue}
          disabled={!canSubmit || busy}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={ss.primaryBtnLabel}>Continue</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const C = {
  primary:     "#FF6B00",
  bg:          "#FFFFFF",
  text:        "#111111",
  sub:         "#374151",
  muted:       "#6B7280",
  placeholder: "#9CA3AF",
  border:      "#E5E7EB",
  error:       "#DC2626",
} as const;

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { flex: 1, backgroundColor: C.bg },
  scroll:          { paddingHorizontal: 24 },
  backBtn:         { marginBottom: 24 },
  backLabel:       { fontSize: 15, color: C.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: C.text, marginBottom: 8 },
  sub:             { fontSize: 14, color: C.sub, marginBottom: 28, lineHeight: 20 },
  label:           { fontSize: 13, fontWeight: "600", color: C.text, marginBottom: 8, marginTop: 16 },
  optional:        { fontWeight: "400", color: C.muted },
  input:           {
    borderWidth: 1.5, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, height: 52, fontSize: 15, color: C.text,
  },
  phoneRow:        {
    flexDirection: "row", borderWidth: 1.5, borderColor: C.border,
    borderRadius: 12, overflow: "hidden", height: 52,
  },
  prefix:          {
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: "#F9FAFB", borderRightWidth: 1, borderRightColor: C.border,
  },
  prefixText:      { fontSize: 15, fontWeight: "600", color: C.text },
  phoneInput:      { flex: 1, paddingHorizontal: 14, fontSize: 15, color: C.text },
  chipRow:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  vehicleScroll:   { marginTop: 4, marginBottom: 4 },
  chip:            {
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 20, borderWidth: 1.5, borderColor: C.border,
    backgroundColor: "#F9FAFB",
  },
  chipSelected:    { borderColor: C.primary, backgroundColor: "#FFF3EC" },
  chipLabel:       { fontSize: 13, fontWeight: "500", color: C.sub },
  chipLabelSelected: { color: C.primary, fontWeight: "700" },
  errorText:       { color: C.error, fontSize: 13, marginTop: 16, marginBottom: 4 },
  primaryBtn:      {
    backgroundColor: C.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 24,
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
