import { SafeInlineIcon, SafeIcon3D, PremiumButton3D } from "@/components/SafeIcon";
import { useRouter } from "expo-router";
import { callSupport } from "@/utils/support";
import { useEffect, useRef, useCallback } from "react";
import {
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { TS } from "@/constants/typography";
import { useDriver } from "@/contexts/DriverContext";

const DOC_LABELS: Record<string, string> = {
  selfie:       "Selfie / Profile Photo",
  aadhaarFront: "Aadhaar (Front)",
  aadhaarBack:  "Aadhaar (Back)",
  pan:          "PAN Card",
  licenseFront: "Driving Licence (Front)",
  licenseBack:  "Driving Licence (Back)",
  rcFront:      "Vehicle RC (Front)",
  rcBack:       "Vehicle RC (Back)",
};

function PulseRing({ delay, color }: { delay: number; color: string }) {
  const scale   = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, {
          toValue: 1,
          duration: 2400,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 2400,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [delay]);

  return (
    <Animated.View
      style={[
        styles.pulseRing,
        {
          borderColor: color,
          transform: [{ scale: scale.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.7] }) }],
          opacity,
        },
      ]}
    />
  );
}

function SpinningRing({ color }: { color: string }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);

  return (
    <Animated.View
      style={[
        styles.spinRing,
        {
          borderColor:      color,
          borderTopColor:   "transparent",
          borderRightColor: "transparent",
          transform: [
            { rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
          ],
        },
      ]}
    />
  );
}

type StepStatus = "done" | "active" | "pending" | "rejected";

function TimelineStep({
  title,
  description,
  status,
  isLast,
}: {
  title: string;
  description: string;
  status: StepStatus;
  isLast?: boolean;
}) {
  const colors = useColors();
  const pulse  = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (status !== "active") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.18,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [status]);

  const dotColor =
    status === "done"     ? colors.success :
    status === "active"   ? colors.pending  :
    status === "rejected" ? colors.error    :
    colors.border;

  const dotBg =
    status === "done"     ? colors.success     :
    status === "active"   ? colors.pendingSoft  :
    status === "rejected" ? colors.errorSoft    :
    colors.muted;

  return (
    <View style={styles.tlRow}>
      <View style={styles.tlIconCol}>
        <Animated.View
          style={[
            styles.tlDot,
            {
              backgroundColor: dotBg,
              borderColor:     dotColor,
              transform: [{ scale: status === "active" ? pulse : 1 }],
            },
          ]}
        >
          {status === "done" && <SafeInlineIcon name="check" size={13} color="#fff" />}
          {status === "rejected" && <SafeInlineIcon name="close" size={13} color={colors.error} />}
          {status === "active" && (
            <View style={[styles.tlActiveCore, { backgroundColor: colors.pending }]} />
          )}
        </Animated.View>
        {!isLast && (
          <View
            style={[
              styles.tlLine,
              { backgroundColor: status === "done" ? colors.success : colors.border },
            ]}
          />
        )}
      </View>
      <View style={[styles.tlContent, { paddingBottom: isLast ? 0 : 18 }]}>
        <Text
          style={[
            styles.tlTitle,
            {
              color:      status === "pending" ? colors.mutedForeground :
                          status === "rejected" ? colors.error : colors.foreground,
              fontWeight: status === "active" ? "800" : "700",
            },
          ]}
        >
          {title}
        </Text>
        <Text style={[styles.tlDesc, { color: colors.mutedForeground }]}>
          {description}
        </Text>
        {status === "active" && (
          <View style={[styles.tlBadge, { backgroundColor: colors.warningSoft }]}>
            <View style={[styles.tlBadgeDot, { backgroundColor: colors.warning }]} />
            <Text style={[styles.tlBadgeText, { color: colors.warningText }]}>In progress</Text>
          </View>
        )}
        {status === "rejected" && (
          <View style={[styles.tlBadge, { backgroundColor: colors.errorSoft }]}>
            <View style={[styles.tlBadgeDot, { backgroundColor: colors.error }]} />
            <Text style={[styles.tlBadgeText, { color: colors.errorText }]}>Action required</Text>
          </View>
        )}
      </View>
    </View>
  );
}

export default function VerificationPendingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { verificationStatus, kycRejectionReason, kycDocuments, refreshKycStatus } = useDriver();

  const isApproved = verificationStatus === "approved" || verificationStatus === "verified";
  const isRejected = verificationStatus === "rejected";

  const rejectedDocs = kycDocuments
    ? (Object.entries(kycDocuments) as [string, { status?: string | null } | undefined][])
        .filter(([, entry]) => entry?.status === "rejected")
        .map(([key]) => key)
    : [];

  const doRefresh = useCallback(async () => {
    await refreshKycStatus();
  }, [refreshKycStatus]);

  // ── Diagnostic log — fires on mount and whenever KYC state changes ──
  useEffect(() => {
    console.log("[REJECTED_DOCS]", JSON.stringify({
      verificationStatus,
      kycRejectionReason:   kycRejectionReason ?? "(absent)",
      rejectedDocs,
      kycDocumentsStatuses: kycDocuments
        ? Object.fromEntries(
            (Object.entries(kycDocuments) as [string, { status?: string | null; rejectionReason?: string | null } | undefined][])
              .map(([k, v]) => [k, { status: v?.status ?? null, rejectionReason: v?.rejectionReason ?? null }])
          )
        : null,
    }, null, 2));
  }, [verificationStatus, kycRejectionReason, rejectedDocs]);

  useEffect(() => {
    if (isApproved) return;
    const interval = setInterval(doRefresh, 30_000);
    return () => clearInterval(interval);
  }, [isApproved, doRefresh]);

  useEffect(() => {
    if (isApproved) return;
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") {
        void doRefresh();
      }
    });
    return () => sub.remove();
  }, [isApproved, doRefresh]);

  // Auto-navigate the moment polling detects approval — driver should not
  // have to tap the button manually when the approval happens while they watch.
  useEffect(() => {
    if (!isApproved) return;
    router.replace("/(tabs)");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApproved]);

  if (isRejected) {
    return (
      <View style={[styles.root, { backgroundColor: colors.background }]}>
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
          <View style={{ width: 38 }} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Application Status
          </Text>
          <TouchableOpacity
            style={[styles.headerBtn, { backgroundColor: colors.muted }]}
            activeOpacity={0.7}
            onPress={() =>
              Alert.alert("Need help?", undefined, [
                { text: "Contact support", onPress: callSupport },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <SafeInlineIcon name="info" size={18} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Rejected hero ── */}
          <View style={[styles.hero, { backgroundColor: colors.error }]}>
            <View style={styles.heroSheen} />
            <View style={styles.heroAnimWrap}>
              <PulseRing delay={0}   color="rgba(255,255,255,0.5)" />
              <PulseRing delay={900} color="rgba(255,255,255,0.5)" />
              <View
                style={[
                  styles.heroIconCircle,
                  {
                    backgroundColor: "rgba(255,255,255,0.18)",
                    borderColor:     "rgba(255,255,255,0.35)",
                    shadowColor:     colors.error,
                  },
                ]}
              >
                <SafeInlineIcon name="close" size={28} color="#fff" />
              </View>
            </View>

            <View style={styles.heroBadgePill}>
              <View style={[styles.heroBadgeDot, { backgroundColor: "#fff" }]} />
              <Text style={styles.heroBadgeText}>Documents Rejected</Text>
            </View>

            <Text style={styles.heroTitle}>Verification Unsuccessful</Text>
            <Text style={styles.heroSub}>
              One or more documents could not be verified. Please re-upload the
              correct documents to continue.
            </Text>
          </View>

          {/* ── Rejection reason ── */}
          {!!kycRejectionReason && (
            <View
              style={[
                styles.reasonCard,
                { backgroundColor: colors.errorSoft, borderColor: colors.error },
              ]}
            >
              <View style={styles.reasonHeader}>
                <SafeInlineIcon name="info" size={16} color={colors.error} />
                <Text style={[styles.reasonTitle, { color: colors.errorText }]}>
                  Reason from verification team
                </Text>
              </View>
              <Text style={[styles.reasonBody, { color: colors.errorText }]}>
                {kycRejectionReason}
              </Text>
            </View>
          )}

          {/* ── Rejected docs list ── */}
          {rejectedDocs.length > 0 && (
            <View
              style={[
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                Documents to Re-upload
              </Text>
              {rejectedDocs.map((key, i) => (
                <View
                  key={key}
                  style={[
                    styles.docRow,
                    i < rejectedDocs.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                  ]}
                >
                  <View
                    style={[
                      styles.docIconWrap,
                      { backgroundColor: colors.errorSoft },
                    ]}
                  >
                    <SafeInlineIcon name="close" size={14} color={colors.error} />
                  </View>
                  <Text style={[styles.docLabel, { color: colors.foreground }]}>
                    {DOC_LABELS[key] ?? key}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Timeline ── */}
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor:     colors.border,
                shadowColor:     colors.error,
              },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>
              Review Timeline
            </Text>
            <View style={styles.timeline}>
              <TimelineStep
                status="done"
                title="Documents Uploaded"
                description="All required documents received"
              />
              <TimelineStep
                status="done"
                title="Registration Fee Paid"
                description="₹10 one-time activation fee verified"
              />
              <TimelineStep
                status="rejected"
                title="Verification Failed"
                description="Some documents could not be verified"
              />
              <TimelineStep
                status="pending"
                title="Re-upload & Re-verify"
                description="Upload correct documents to proceed"
                isLast
              />
            </View>
          </View>

          {/* ── Support row ── */}
          <TouchableOpacity
            style={[
              styles.supportRow,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
            activeOpacity={0.7}
            onPress={callSupport}
          >
            <SafeIcon3D
              name="support"
              size={36}
              bg={colors.warningSoft}
              color={colors.warning}
              glow={colors.warning}
              rounded={10}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.supportTitle, { color: colors.foreground }]}>
                Need help?
              </Text>
              <Text style={[styles.supportSub, { color: colors.mutedForeground }]}>
                Contact our support team 24×7
              </Text>
            </View>
            <SafeInlineIcon name="arrow" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
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
          <PremiumButton3D
            title="Re-upload Documents"
            leftIcon="refresh"
            bg={colors.error}
            bgDark="#991B1B"
            textColor="#fff"
            onPress={() => router.replace("/document-upload")}
          />
          <TouchableOpacity
            style={[styles.ghostBtn, { borderColor: colors.border }]}
            activeOpacity={0.7}
            onPress={callSupport}
          >
            <SafeInlineIcon name="support" size={15} color={colors.foreground} />
            <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
              Contact Support
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      {/* Header */}
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
        <View style={{ width: 38 }} />
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Application Status
        </Text>
        <TouchableOpacity
          style={[styles.headerBtn, { backgroundColor: colors.muted }]}
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert("Application options", undefined, [
              { text: "Refresh status", onPress: () => void doRefresh() },
              { text: "Contact support", onPress: callSupport },
              { text: "Cancel", style: "cancel" },
            ])
          }
        >
          <SafeInlineIcon name="info" size={18} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Pending hero card ── */}
        <View style={[styles.hero, { backgroundColor: colors.pending }]}>
          {/* Decorative sheen */}
          <View style={styles.heroSheen} />

          <View style={styles.heroAnimWrap}>
            <PulseRing delay={0}    color="rgba(255,255,255,0.6)" />
            <PulseRing delay={800}  color="rgba(255,255,255,0.6)" />
            <PulseRing delay={1600} color="rgba(255,255,255,0.6)" />
            <SpinningRing color="rgba(255,255,255,0.7)" />
            <View
              style={[
                styles.heroIconCircle,
                {
                  backgroundColor: "rgba(255,255,255,0.18)",
                  borderColor:     "rgba(255,255,255,0.35)",
                  shadowColor:     colors.pending,
                },
              ]}
            >
              <SafeInlineIcon name="shield" size={28} color="#fff" />
            </View>
          </View>

          {/* Badge */}
          <View style={styles.heroBadgePill}>
            <View style={styles.heroBadgeDot} />
            <Text style={styles.heroBadgeText}>Under Review</Text>
          </View>

          <Text style={styles.heroTitle}>Verification in Progress</Text>
          <Text style={styles.heroSub}>
            Our team is reviewing your documents. You'll be notified once approved.
          </Text>

          <View style={styles.heroEtaPill}>
            <SafeInlineIcon name="clock" size={12} color="#fff" />
            <Text style={styles.heroEtaText}>Usually within 24 hours</Text>
          </View>
        </View>

        {/* ── Review timeline ── */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor:     colors.border,
              shadowColor:     colors.pending,
            },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Review Timeline
          </Text>
          <View style={styles.timeline}>
            <TimelineStep
              status="done"
              title="Documents Uploaded"
              description="All required documents received"
            />
            <TimelineStep
              status="done"
              title="Registration Fee Paid"
              description="₹10 one-time activation fee verified"
            />
            <TimelineStep
              status="active"
              title="Verification Under Review"
              description="Our team is reviewing your details"
            />
            <TimelineStep
              status="pending"
              title="Account Approved"
              description="You'll be able to start accepting rides"
              isLast
            />
          </View>
        </View>

        {/* ── Message card ── */}
        <View
          style={[
            styles.messageCard,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.messageHeader}>
            <SafeIcon3D
              name="profile"
              size={38}
              bg={colors.pendingSoft}
              color={colors.pending}
              glow={colors.pending}
              rounded={19}
            />
            <View style={{ flex: 1 }}>
              <View style={styles.messageHeaderRow}>
                <Text style={[styles.messageAuthor, { color: colors.foreground }]}>
                  Verification Team
                </Text>
                <View style={[styles.verifiedDot, { backgroundColor: colors.pending }]}>
                  <SafeInlineIcon name="check" size={8} color="#fff" />
                </View>
              </View>
              <Text style={[styles.messageMeta, { color: colors.mutedForeground }]}>
                Admin Review • Just now
              </Text>
            </View>
          </View>
          <Text style={[styles.messageBody, { color: colors.foreground }]}>
            "Thank you for your application! Your documents are now in our review
            queue. We'll get back to you within{" "}
            <Text style={{ fontWeight: "700", color: colors.pending }}>
              24 hours
            </Text>
            . Keep an eye on your notifications."
          </Text>
          <View style={[styles.messageFooter, { borderTopColor: colors.border }]}>
            <SafeInlineIcon name="info" size={12} color={colors.mutedForeground} />
            <Text style={[styles.messageFooterText, { color: colors.mutedForeground }]}>
              Ticket ID: DRV-2026-04827
            </Text>
          </View>
        </View>

        {/* ── Tips card ── */}
        <View
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Meanwhile
          </Text>
          {[
            "Keep notifications enabled",
            "Keep vehicle documents ready",
            "Check application status anytime",
          ].map((item) => (
            <View key={item} style={styles.checklistRow}>
              <SafeIcon3D
                name="check"
                size={20}
                bg={colors.primary}
                color="#fff"
                glow={colors.primary}
                rounded={10}
              />
              <Text style={[styles.checklistText, { color: colors.foreground }]}>
                {item}
              </Text>
            </View>
          ))}
        </View>

        {/* ── Support row ── */}
        <TouchableOpacity
          style={[
            styles.supportRow,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
          activeOpacity={0.7}
          onPress={callSupport}
        >
          <SafeIcon3D
            name="support"
            size={36}
            bg={colors.warningSoft}
            color={colors.warning}
            glow={colors.warning}
            rounded={10}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.supportTitle, { color: colors.foreground }]}>
              Need help?
            </Text>
            <Text style={[styles.supportSub, { color: colors.mutedForeground }]}>
              Contact our support team 24×7
            </Text>
          </View>
          <SafeInlineIcon name="arrow" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
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
        <PremiumButton3D
          title={isApproved ? "Go to Dashboard" : "Check Application Status"}
          leftIcon={isApproved ? "check" : "refresh"}
          bg={isApproved ? colors.primary : colors.muted}
          bgDark={isApproved ? "#BE185D" : "#9CA3AF"}
          textColor={isApproved ? "#fff" : colors.foreground}
          onPress={() => {
            if (isApproved) {
              router.replace("/(tabs)");
            } else {
              void doRefresh().then(() => {
                Alert.alert(
                  "Status Refreshed",
                  "Your application is still under review. You'll receive a notification once approved.",
                  [{ text: "OK" }],
                );
              });
            }
          }}
        />
        <TouchableOpacity
          style={[styles.ghostBtn, { borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert(
              "Notifications enabled",
              "We'll alert you the moment your verification is approved.",
            )
          }
        >
          <SafeInlineIcon name="bell" size={15} color={colors.foreground} />
          <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
            Notify Me When Approved
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerTitle: { ...TS.h3 },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },

  hero: {
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  heroSheen: {
    position: "absolute",
    top: 0,
    left: 28,
    right: 28,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  heroAnimWrap: {
    width: 90,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  pulseRing: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
  },
  spinRing: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
  },
  heroIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  heroBadgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  heroBadgeDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#fff",
    opacity: 0.9,
  },
  heroBadgeText: {
    ...TS.label,
    color: "#fff",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  heroSub: {
    ...TS.bodySm,
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
    paddingHorizontal: 8,
  },
  heroEtaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    marginTop: 4,
  },
  heroEtaText: {
    ...TS.btnSm,
    color: "#fff",
    letterSpacing: 0.3,
    fontWeight: "600",
  },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  cardTitle: { ...TS.body, fontWeight: "700" },

  reasonCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
    gap: 8,
  },
  reasonHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  reasonTitle:  { ...TS.bodySm, fontWeight: "700", flex: 1 },
  reasonBody:   { ...TS.bodySm, lineHeight: 20 },

  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  docIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  docLabel: { ...TS.bodySm, flex: 1, fontWeight: "600" },

  timeline:    { gap: 0 },
  tlRow:       { flexDirection: "row", gap: 12 },
  tlIconCol:   { alignItems: "center", width: 24 },
  tlDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  tlActiveCore: { width: 8, height: 8, borderRadius: 4 },
  tlLine:       { flex: 1, width: 2, marginTop: 4, minHeight: 24 },
  tlContent:    { flex: 1, paddingTop: 1, gap: 3 },
  tlTitle:      { ...TS.body },
  tlDesc:       { ...TS.bodySm, lineHeight: 17 },
  tlBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  tlBadgeDot:  { width: 6, height: 6, borderRadius: 3 },
  tlBadgeText: { ...TS.label, fontSize: 10 },

  messageCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  messageHeader:    { flexDirection: "row", alignItems: "center", gap: 10 },
  adminAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  messageHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  messageAuthor:    { ...TS.body, fontWeight: "700" },
  verifiedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  messageMeta:       { fontSize: 11, marginTop: 1 },
  messageBody:       { ...TS.bodySm, lineHeight: 20 },
  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  messageFooterText: { fontSize: 11, fontWeight: "500" },

  checklistRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 5 },
  checklistText: { ...TS.bodySm, flex: 1 },

  supportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  supportTitle: { ...TS.bodySm, fontWeight: "700" },
  supportSub:   { fontSize: 11, marginTop: 1 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    gap: 10,
  },
  primaryBtn: {
    height: 54,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  primaryBtnText: { fontSize: 16, fontWeight: "700", color: "#fff" },
  ghostBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ghostBtnText: { ...TS.body, fontWeight: "600" },
});
