/**
 * COMPARTMENT 8 — UI Layer: Signup Form Screen
 *
 * Single responsibility: collect new-driver profile data, send OTP, store
 * data in FlowContext, navigate to OTP screen.
 *
 * Imports only from:
 *   C2  Engine      — engineSendOtp
 *   C8  FlowContext — setPhone, setSignup
 *   C1  Navigation  — navToOtp, navBack
 *   C10 Config      — VEHICLES, COLORS, PHONE_DIGITS, PHONE_PREFIX
 */

import React, { useRef, useState } from "react";
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

import { engineSendOtp }            from "@/modules/auth-v3/engine";
import { useV3Flow }                from "@/modules/auth-v3/ui";
import { navToOtp, navBack }        from "@/modules/auth-v3/navigation";
import { COLORS, VEHICLES, PHONE_DIGITS, PHONE_PREFIX } from "@/modules/auth-v3/config";

const GENDERS = ["Male", "Female", "Other"] as const;

export default function SignupFormScreen() {
  const router      = useRouter();
  const insets      = useSafeAreaInsets();
  const { setPhone, setSignup } = useV3Flow();
  const mountedRef  = useRef(true);

  const [name,          setName]          = useState("");
  const [city,          setCity]          = useState("");
  const [digits,        setDigits]        = useState("");
  const [gender,        setGender]        = useState("");
  const [vehicleId,     setVehicleId]     = useState("");
  const [vehicleName,   setVehicleName]   = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [error,         setError]         = useState("");
  const [busy,          setBusy]          = useState(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const canSubmit =
    name.trim().length > 0 &&
    city.trim().length > 0 &&
    digits.length === PHONE_DIGITS &&
    gender.length > 0 &&
    vehicleId.length > 0;

  const handleContinue = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");

    const fullPhone = `${PHONE_PREFIX}${digits}`;
    const result = await engineSendOtp(fullPhone);

    if (!mountedRef.current) return;
    setBusy(false);

    if (!result.success) {
      setError(result.error.userMessage);
      return;
    }

    setPhone(fullPhone);
    setSignup({
      name:          name.trim(),
      city:          city.trim(),
      gender,
      vehicleId,
      vehicleName,
      licenseNumber: licenseNumber.trim(),
      vehicleNumber: vehicleNumber.trim(),
    });

    navToOtp(router, "signup");
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
        <Pressable style={ss.backBtn} onPress={() => navBack(router)} disabled={busy}>
          <Text style={ss.backLabel}>← Back</Text>
        </Pressable>

        <Text style={ss.heading}>Create Account</Text>
        <Text style={ss.sub}>Fill in your details to get started.</Text>

        <Text style={ss.label}>Full Name</Text>
        <TextInput
          style={ss.input}
          value={name}
          onChangeText={(v) => { setError(""); setName(v); }}
          placeholder="Your full name"
          placeholderTextColor={COLORS.placeholder}
          autoCapitalize="words"
          editable={!busy}
        />

        <Text style={ss.label}>City</Text>
        <TextInput
          style={ss.input}
          value={city}
          onChangeText={(v) => { setError(""); setCity(v); }}
          placeholder="Your city"
          placeholderTextColor={COLORS.placeholder}
          autoCapitalize="words"
          editable={!busy}
        />

        <Text style={ss.label}>Mobile Number</Text>
        <View style={ss.phoneRow}>
          <View style={ss.prefix}>
            <Text style={ss.prefixText}>{PHONE_PREFIX}</Text>
          </View>
          <TextInput
            style={ss.phoneInput}
            value={digits}
            onChangeText={(v) => {
              setError("");
              setDigits(v.replace(/\D/g, "").slice(0, PHONE_DIGITS));
            }}
            placeholder={`${PHONE_DIGITS}-digit number`}
            placeholderTextColor={COLORS.placeholder}
            keyboardType="number-pad"
            maxLength={PHONE_DIGITS}
            editable={!busy}
          />
        </View>

        <Text style={ss.label}>Gender</Text>
        <View style={ss.chipRow}>
          {GENDERS.map((g) => (
            <Pressable
              key={g}
              style={[ss.chip, gender === g && ss.chipSelected]}
              onPress={() => { setError(""); setGender(g); }}
              disabled={busy}
            >
              <Text style={[ss.chipLabel, gender === g && ss.chipLabelOn]}>{g}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={ss.label}>Vehicle Type</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={ss.vehicleScroll}
          contentContainerStyle={{ gap: 8, paddingRight: 24 }}
        >
          {VEHICLES.map((v) => (
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
              <Text style={[ss.chipLabel, vehicleId === v.id && ss.chipLabelOn]}>
                {v.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Text style={ss.label}>
          License Number <Text style={ss.optional}>(optional)</Text>
        </Text>
        <TextInput
          style={ss.input}
          value={licenseNumber}
          onChangeText={(v) => setLicenseNumber(v.toUpperCase())}
          placeholder="e.g. KA01 20230012345"
          placeholderTextColor={COLORS.placeholder}
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
          placeholderTextColor={COLORS.placeholder}
          autoCapitalize="characters"
          editable={!busy}
        />

        {!!error && <Text style={ss.errorText}>{error}</Text>}

        <Pressable
          style={[ss.primaryBtn, (!canSubmit || busy) && ss.btnDisabled]}
          onPress={() => void handleContinue()}
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

const ss = StyleSheet.create({
  flex:            { flex: 1 },
  bg:              { flex: 1, backgroundColor: COLORS.bg },
  scroll:          { paddingHorizontal: 24 },
  backBtn:         { marginBottom: 24 },
  backLabel:       { fontSize: 15, color: COLORS.muted },
  heading:         { fontSize: 26, fontWeight: "800", color: COLORS.text, marginBottom: 8 },
  sub:             { fontSize: 14, color: COLORS.sub, marginBottom: 28, lineHeight: 20 },
  label:           { fontSize: 13, fontWeight: "600", color: COLORS.text, marginBottom: 8, marginTop: 16 },
  optional:        { fontWeight: "400", color: COLORS.muted },
  input:           {
    borderWidth: 1.5, borderColor: COLORS.border, borderRadius: 12,
    paddingHorizontal: 14, height: 52, fontSize: 15, color: COLORS.text,
  },
  phoneRow:        {
    flexDirection: "row", borderWidth: 1.5, borderColor: COLORS.border,
    borderRadius: 12, overflow: "hidden", height: 52,
  },
  prefix:          {
    paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.inputBg, borderRightWidth: 1, borderRightColor: COLORS.border,
  },
  prefixText:      { fontSize: 15, fontWeight: "600", color: COLORS.text },
  phoneInput:      { flex: 1, paddingHorizontal: 14, fontSize: 15, color: COLORS.text },
  chipRow:         { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  vehicleScroll:   { marginTop: 4 },
  chip:            {
    paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
    borderWidth: 1.5, borderColor: COLORS.border, backgroundColor: COLORS.inputBg,
  },
  chipSelected:    { borderColor: COLORS.primary, backgroundColor: COLORS.tint },
  chipLabel:       { fontSize: 13, fontWeight: "500", color: COLORS.sub },
  chipLabelOn:     { color: COLORS.primary, fontWeight: "700" },
  errorText:       { color: COLORS.error, fontSize: 13, marginTop: 16, marginBottom: 4 },
  primaryBtn:      {
    backgroundColor: COLORS.primary, borderRadius: 14, height: 54,
    alignItems: "center", justifyContent: "center", marginTop: 24,
  },
  btnDisabled:     { opacity: 0.4 },
  primaryBtnLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
