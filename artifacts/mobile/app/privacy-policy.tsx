import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { TS } from "@/constants/typography";

// ─── Types ────────────────────────────────────────────────────────────────────

type Section = {
  icon: string;
  title: string;
  paragraphs: string[];
};

// ─── Content ──────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    icon: "database",
    title: "Information We Collect",
    paragraphs: [
      "We collect information that you provide directly to us when you register as a driver partner, including personal details, vehicle information, and documents required for verification.",
      "We automatically collect certain information about your device and how you interact with the app, including app usage data, crash reports, and performance metrics.",
    ],
  },
  {
    icon: "user",
    title: "Driver Profile Information",
    paragraphs: [
      "When you sign up as a driver partner, we collect your full name, mobile number, date of birth, gender, city, vehicle number, driver's license number, and profile photograph.",
      "This information is used solely for account verification and to provide you with access to our delivery partner platform. Driver information is used for account verification and service delivery only.",
      "We do not sell your personal information to any third party under any circumstances.",
    ],
  },
  {
    icon: "map-pin",
    title: "Location Information",
    paragraphs: [
      "We collect your precise GPS location while the app is in use so we can dispatch delivery orders to you, show your position to customers during active deliveries, and calculate accurate earnings.",
      "Location is used only for delivery operations. We do not track your location when you are offline or when the app is not in use.",
      "Location data is transmitted securely and stored only as long as necessary for operational and legal compliance purposes.",
    ],
  },
  {
    icon: "smartphone",
    title: "Device Information",
    paragraphs: [
      "We collect device identifiers (such as your Android device ID and FCM token) to deliver push notifications for incoming order alerts directly to your device.",
      "We may collect information about your device model, operating system version, and app version to ensure compatibility and provide technical support.",
    ],
  },
  {
    icon: "bell",
    title: "Notifications",
    paragraphs: [
      "We use Firebase Cloud Messaging (FCM) to send real-time ride request alerts to your device. These notifications are essential to the operation of the delivery partner platform.",
      "You may manage notification permissions through your device settings. Disabling notifications may prevent you from receiving new delivery orders.",
    ],
  },
  {
    icon: "settings",
    title: "How We Use Your Data",
    paragraphs: [
      "We use your information to operate and improve the platform, verify your identity, process your earnings and payments, prevent fraud, and comply with applicable laws.",
      "We may use aggregated, anonymised data (with no personally identifying information) for analytics and service improvement purposes.",
      "We do not use your personal data for advertising purposes, and we do not sell, rent, or trade your personal information to any third parties.",
    ],
  },
  {
    icon: "lock",
    title: "Security",
    paragraphs: [
      "We implement industry-standard security measures including encrypted data transmission (HTTPS/TLS), Firebase Authentication for secure login, and role-based access controls to protect your information.",
      "Your documents and personal data are stored securely in Firebase Firestore with access restricted to authorised personnel only.",
      "While we strive to protect your personal information, no method of electronic transmission or storage is 100% secure. We encourage you to keep your account credentials confidential.",
    ],
  },
  {
    icon: "phone",
    title: "Contact Information",
    paragraphs: [
      "If you have any questions or concerns about this Privacy Policy or how we handle your data, please contact us:",
      "Bike Courier Service Private Limited\nB-36, Block B, Phase-1, Metro Vihar,\nHolambi Kalan, Delhi",
      "Phone: 8545937468",
      "We will respond to your enquiry within 5 business days.",
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionCard({ section }: { section: Section }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {/* Card header */}
      <View style={styles.cardHeader}>
        <View style={[styles.cardIconWrap, { backgroundColor: colors.primarySoft }]}>
          <Feather name={section.icon as any} size={16} color={colors.primary} />
        </View>
        <Text style={[styles.cardTitle, { color: colors.foreground }]}>
          {section.title}
        </Text>
      </View>

      {/* Divider */}
      <View style={[styles.cardDivider, { backgroundColor: colors.border }]} />

      {/* Paragraphs */}
      <View style={styles.cardBody}>
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={[styles.cardText, { color: colors.foreground }]}>
            {p}
          </Text>
        ))}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PrivacyPolicyScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop:        insets.top + 10,
            backgroundColor:   colors.surface,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.backBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Privacy Policy</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>Last updated: June 2026</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Intro card */}
        <View
          style={[
            styles.introCard,
            { backgroundColor: colors.primarySoft, borderColor: colors.primary },
          ]}
        >
          <View style={styles.introRow}>
            <View style={[styles.introIcon, { backgroundColor: colors.primary }]}>
              <Feather name="shield" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.introTitle, { color: colors.primary }]}>
                Bike Courier Service Private Limited
              </Text>
              <Text style={[styles.introSub, { color: colors.foreground }]}>
                We are committed to protecting your privacy and handling your personal data with transparency and care.
              </Text>
            </View>
          </View>
        </View>

        {/* Section cards */}
        {SECTIONS.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}

        {/* Footer note */}
        <View style={[styles.footerNote, { borderColor: colors.border }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.footerNoteText, { color: colors.mutedForeground }]}>
            This policy applies to the Bike Courier driver partner app. By using our platform, you agree to this Privacy Policy. We may update this policy periodically and will notify you of significant changes.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { alignItems: "center", gap: 2 },
  headerTitle: { ...TS.h3 },
  headerSub:   { ...TS.bodySm, fontSize: 11 },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },

  introCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    padding: 14,
  },
  introRow:   { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  introIcon:  {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  introTitle: { ...TS.bodySm, fontWeight: "800", marginBottom: 4 },
  introSub:   { ...TS.bodySm, lineHeight: 19 },

  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
  },
  cardIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { ...TS.body, fontWeight: "700", flex: 1 },
  cardDivider: { height: 1, marginHorizontal: 14 },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  cardText: { ...TS.bodySm, lineHeight: 20 },

  footerNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  footerNoteText: { ...TS.bodySm, flex: 1, lineHeight: 19 },
});
