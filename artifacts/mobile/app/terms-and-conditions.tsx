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
  bullets?: string[];
};

// ─── Content ──────────────────────────────────────────────────────────────────

const SECTIONS: Section[] = [
  {
    icon: "user-check",
    title: "Driver Responsibilities",
    paragraphs: [
      "As a driver partner on the Bike Courier platform, you agree to fulfil all delivery requests accepted through the app in a professional, safe, and timely manner.",
      "You are responsible for complying with all applicable local, state, and national laws and regulations, including traffic rules, vehicle regulations, and any permits required for commercial delivery operations.",
    ],
  },
  {
    icon: "edit-3",
    title: "Accurate Information",
    paragraphs: [
      "You must provide accurate, complete, and truthful information during registration and throughout your use of the platform.",
      "Any misrepresentation of personal details, vehicle information, or professional qualifications may result in immediate account suspension and legal action.",
    ],
    bullets: [
      "Name and contact details must match government-issued ID.",
      "Vehicle number must match your registered vehicle.",
      "License number must be valid and current.",
    ],
  },
  {
    icon: "file-text",
    title: "Document Verification",
    paragraphs: [
      "You are required to submit valid copies of your driver's license, vehicle registration certificate (RC), and any other documents requested by Bike Courier Service Private Limited.",
      "All submitted documents must be authentic and currently valid. Submission of fake, forged, or expired documents will result in permanent suspension of your account and may be reported to law enforcement authorities.",
      "Our verification team reviews documents within 24–48 hours. You will be notified of your verification status through the app.",
    ],
  },
  {
    icon: "alert-octagon",
    title: "Account Suspension",
    paragraphs: [
      "Bike Courier Service Private Limited reserves the right to suspend or permanently deactivate your account for any of the following reasons:",
    ],
    bullets: [
      "Submission of fake or forged documents — results in permanent suspension.",
      "Repeated cancellation of accepted orders without valid reason.",
      "Unprofessional behaviour as reported by customers.",
      "Violation of traffic laws or causing damage during deliveries.",
      "Fraudulent activity including false earnings claims.",
      "Violation of any provision of these Terms & Conditions.",
    ],
  },
  {
    icon: "package",
    title: "Delivery Conduct",
    paragraphs: [
      "You must handle all packages with care and ensure timely delivery to the customer's specified address. Any damage to parcels due to negligence may result in deductions from your earnings.",
      "You are required to verify the OTP provided by the customer before completing a delivery. Marking orders as delivered without OTP verification is a violation of platform policy.",
      "You must not open, inspect, or tamper with any parcel or shipment assigned to you.",
    ],
  },
  {
    icon: "dollar-sign",
    title: "Payment and Earnings",
    paragraphs: [
      "Your earnings are calculated based on completed deliveries and are subject to the platform's fare structure, which may change from time to time.",
      "Earnings are subject to platform rules and any applicable subscription plan. Driver partners on an active plan retain 100% of their delivery fares. Driver partners without an active plan are subject to the platform commission structure.",
      "Payments are processed to your registered bank account or wallet within the platform's standard payout cycle. Bike Courier is not responsible for delays caused by third-party payment processors.",
    ],
  },
  {
    icon: "smartphone",
    title: "Platform Usage",
    paragraphs: [
      "You may use the Bike Courier driver app solely for the purpose of receiving and completing delivery assignments. Any other use of the app or its features is strictly prohibited.",
      "You must not attempt to reverse-engineer, modify, or exploit the app or its underlying systems. Unauthorized access or manipulation of platform data is a violation of these terms and may be subject to legal action.",
      "Your account is personal and non-transferable. You must not share your login credentials with any other person.",
    ],
  },
  {
    icon: "shield-off",
    title: "Limitation of Liability",
    paragraphs: [
      "Bike Courier Service Private Limited provides the platform on an 'as-is' basis and makes no warranties regarding uninterrupted service, earnings guarantees, or order availability.",
      "We are not liable for any indirect, incidental, special, or consequential damages arising from your use of the platform, including loss of earnings due to technical issues, order cancellations, or market conditions.",
      "Our total liability to you for any claim arising from your use of the platform shall not exceed the amount paid to you in the 30 days preceding the claim.",
    ],
  },
  {
    icon: "phone",
    title: "Contact Information",
    paragraphs: [
      "If you have any questions about these Terms & Conditions, wish to raise a dispute, or need assistance with your account, please contact us:",
      "Bike Courier Service Private Limited\nB-36, Block B, Phase-1, Metro Vihar,\nHolambi Kalan, Delhi",
      "Phone: 8545937468",
      "We will endeavour to respond to all enquiries within 5 business days.",
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

      {/* Body */}
      <View style={styles.cardBody}>
        {section.paragraphs.map((p, i) => (
          <Text key={i} style={[styles.cardText, { color: colors.foreground }]}>
            {p}
          </Text>
        ))}

        {section.bullets && section.bullets.length > 0 && (
          <View style={styles.bulletList}>
            {section.bullets.map((b, i) => (
              <View key={i} style={styles.bulletRow}>
                <View
                  style={[styles.bulletDot, { backgroundColor: colors.primary }]}
                />
                <Text style={[styles.bulletText, { color: colors.foreground }]}>
                  {b}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TermsAndConditionsScreen() {
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
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Terms & Conditions</Text>
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
              <Feather name="book-open" size={18} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.introTitle, { color: colors.primary }]}>
                Bike Courier Service Private Limited
              </Text>
              <Text style={[styles.introSub, { color: colors.foreground }]}>
                By using the Bike Courier driver app, you agree to these Terms & Conditions. Please read them carefully before registering.
              </Text>
            </View>
          </View>
        </View>

        {/* Warning callout */}
        <View
          style={[
            styles.warningCard,
            { backgroundColor: colors.errorSoft, borderColor: colors.error },
          ]}
        >
          <Feather name="alert-triangle" size={15} color={colors.error} />
          <Text style={[styles.warningText, { color: colors.error }]}>
            Submission of fake or forged documents will result in permanent account suspension and may be reported to law enforcement.
          </Text>
        </View>

        {/* Section cards */}
        {SECTIONS.map((section) => (
          <SectionCard key={section.title} section={section} />
        ))}

        {/* Footer note */}
        <View style={[styles.footerNote, { borderColor: colors.border }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.footerNoteText, { color: colors.mutedForeground }]}>
            These terms constitute the entire agreement between you and Bike Courier Service Private Limited. We reserve the right to modify these terms at any time. Continued use of the platform after changes constitutes your acceptance of the updated terms.
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
  headerTitle:  { ...TS.h3 },
  headerSub:    { ...TS.bodySm, fontSize: 11 },

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

  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 12,
  },
  warningText: { ...TS.bodySm, fontWeight: "600", flex: 1, lineHeight: 19 },

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
  cardTitle:   { ...TS.body, fontWeight: "700", flex: 1 },
  cardDivider: { height: 1, marginHorizontal: 14 },
  cardBody: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 14,
    gap: 10,
  },
  cardText: { ...TS.bodySm, lineHeight: 20 },

  bulletList: { gap: 8, marginTop: 2 },
  bulletRow:  { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 7,
    flexShrink: 0,
  },
  bulletText: { ...TS.bodySm, lineHeight: 20, flex: 1 },

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
