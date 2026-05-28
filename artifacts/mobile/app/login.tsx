import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
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

import { DeliveryRiderIllustration } from "@/components/DeliveryRiderIllustration";
import { useDriver } from "@/contexts/DriverContext";

const COUNTRY_CODE = "+91";

const GRADIENT_FROM = "#FF4D8D";
const GRADIENT_TO = "#FF7A3D";
const PAGE_BG = "#F8FAFC";
const TEXT_PRIMARY = "#111827";
const TEXT_MUTED = "#6B7280";
const BORDER = "#E5E7EB";

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const inputRef = useRef<TextInput>(null);
  const [phone, setPhone] = useState("");
  const { setPhone: setDriverPhone } = useDriver();
  const [focused, setFocused] = useState(false);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  const isValid = phone.replace(/\D/g, "").length === 10;

  function handleContinue() {
    if (!isValid) return;
    setDriverPhone(phone);
    router.push({ pathname: "/otp", params: { phone } });
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: PAGE_BG }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: insets.top + 12,
            paddingBottom: insets.bottom + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => router.canGoBack() && router.back()}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={20} color={TEXT_PRIMARY} />
          </TouchableOpacity>
        </View>

        <View style={styles.heroSection}>
          <DeliveryRiderIllustration size={190} />
        </View>

        <View style={styles.headingSection}>
          <Text style={styles.title}>Welcome Driver</Text>
          <Text style={styles.subtitle}>
            Login with your mobile number to continue deliveries
          </Text>
        </View>

        <View style={styles.formSection}>
          <View
            style={[
              styles.inputCard,
              focused && styles.inputCardFocused,
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => setShowCountryPicker(true)}
              style={styles.countrySelector}
            >
              <View style={styles.flagWrap}>
                <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
                <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
                  <View style={styles.flagChakra} />
                </View>
                <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
              </View>
              <Text style={styles.codeText}>{COUNTRY_CODE}</Text>
              <Feather name="chevron-down" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>

            <View style={styles.codeDivider} />

            <TextInput
              ref={inputRef}
              style={styles.phoneInput}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, "").slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="Enter mobile number"
              placeholderTextColor="#9CA3AF"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              returnKeyType="done"
              onSubmitEditing={handleContinue}
            />
          </View>

          <TouchableOpacity
            onPress={handleContinue}
            activeOpacity={0.92}
            disabled={!isValid}
            style={[styles.ctaWrap, !isValid && styles.ctaWrapDisabled]}
          >
            <LinearGradient
              colors={
                isValid
                  ? [GRADIENT_FROM, GRADIENT_TO]
                  : ["#E5E7EB", "#E5E7EB"]
              }
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.ctaButton}
            >
              <Text
                style={[
                  styles.ctaText,
                  !isValid && { color: "#9CA3AF" },
                ]}
              >
                Continue
              </Text>
              {isValid && (
                <Feather name="arrow-right" size={18} color="#fff" />
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <Text style={styles.termsText}>
          By continuing you agree to{" "}
          <Text style={styles.termsLink}>Terms</Text>
          {" & "}
          <Text style={styles.termsLink}>Privacy Policy</Text>
        </Text>
      </ScrollView>

      <Modal
        visible={showCountryPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCountryPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowCountryPicker(false)}
        >
          <Pressable
            style={styles.modalCard}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select country</Text>
              <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
                <Feather name="x" size={20} color={TEXT_PRIMARY} />
              </TouchableOpacity>
            </View>

            <View style={styles.countryItemActive}>
              <View style={styles.flagWrap}>
                <View style={[styles.flagBand, { backgroundColor: "#FF9933" }]} />
                <View style={[styles.flagBand, { backgroundColor: "#FFFFFF" }]}>
                  <View style={styles.flagChakra} />
                </View>
                <View style={[styles.flagBand, { backgroundColor: "#138808" }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.countryItemName}>India</Text>
                <Text style={styles.countryItemCode}>+91</Text>
              </View>
              <Feather name="check-circle" size={20} color={GRADIENT_FROM} />
            </View>

            <Text style={styles.modalHint}>More countries coming soon.</Text>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: {
    flexGrow: 1,
    paddingHorizontal: 24,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
  },
  heroSection: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 8,
  },
  headingSection: {
    marginTop: 28,
    gap: 10,
    alignItems: "center",
  },
  title: {
    fontSize: 34,
    fontWeight: "700",
    color: TEXT_PRIMARY,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    fontWeight: "400",
    color: TEXT_MUTED,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 12,
  },
  formSection: {
    marginTop: 36,
    gap: 16,
  },
  inputCard: {
    flexDirection: "row",
    alignItems: "center",
    height: 64,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: BORDER,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  inputCardFocused: {
    borderColor: GRADIENT_FROM,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.12,
    shadowRadius: 14,
  },
  countrySelector: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 18,
    paddingRight: 10,
    height: "100%",
  },
  flagWrap: {
    width: 24,
    height: 17,
    borderRadius: 2.5,
    overflow: "hidden",
    borderWidth: 0.5,
    borderColor: "#D1D5DB",
    flexDirection: "column",
  },
  flagBand: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  flagChakra: {
    width: 5,
    height: 5,
    borderRadius: 3,
    borderWidth: 0.8,
    borderColor: "#1A237E",
  },
  codeText: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  codeDivider: {
    width: 1,
    height: 28,
    backgroundColor: BORDER,
  },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: "600",
    color: TEXT_PRIMARY,
    paddingHorizontal: 16,
    height: "100%",
  },
  ctaWrap: {
    borderRadius: 20,
    shadowColor: GRADIENT_FROM,
    shadowOpacity: 0.25,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  ctaWrapDisabled: {
    shadowOpacity: 0,
    elevation: 0,
  },
  ctaButton: {
    height: 58,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  ctaText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.2,
  },
  termsText: {
    fontSize: 12,
    color: TEXT_MUTED,
    textAlign: "center",
    marginTop: 24,
    marginBottom: 8,
  },
  termsLink: {
    color: TEXT_PRIMARY,
    fontWeight: "600",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.5)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 22,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: TEXT_PRIMARY,
  },
  countryItemActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFF7F2",
    borderWidth: 1.5,
    borderColor: GRADIENT_FROM,
  },
  countryItemName: {
    fontSize: 16,
    fontWeight: "700",
    color: TEXT_PRIMARY,
  },
  countryItemCode: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 2,
  },
  modalHint: {
    fontSize: 13,
    color: TEXT_MUTED,
    textAlign: "center",
  },
});
