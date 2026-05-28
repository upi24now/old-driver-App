import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import {
  Alert,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function PulseRing({ delay, color }: { delay: number; color: string }) {
  const scale = useRef(new Animated.Value(0)).current;
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
          borderColor: color,
          borderTopColor: "transparent",
          borderRightColor: "transparent",
          transform: [
            { rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
          ],
        },
      ]}
    />
  );
}

type StepStatus = "done" | "active" | "pending";

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
  const pulse = useRef(new Animated.Value(1)).current;

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
    status === "done" ? colors.primary : status === "active" ? colors.primary : colors.border;
  const dotBg =
    status === "done"
      ? colors.primary
      : status === "active"
        ? "rgba(0, 200, 83, 0.18)"
        : "#f5f5f5";

  return (
    <View style={styles.tlRow}>
      <View style={styles.tlIconCol}>
        <Animated.View
          style={[
            styles.tlDot,
            {
              backgroundColor: dotBg,
              borderColor: dotColor,
              transform: [{ scale: status === "active" ? pulse : 1 }],
            },
          ]}
        >
          {status === "done" && <Feather name="check" size={13} color="#fff" />}
          {status === "active" && (
            <View style={[styles.tlActiveCore, { backgroundColor: colors.primary }]} />
          )}
        </Animated.View>
        {!isLast && (
          <View
            style={[
              styles.tlLine,
              { backgroundColor: status === "done" ? colors.primary : colors.border },
            ]}
          />
        )}
      </View>
      <View style={[styles.tlContent, { paddingBottom: isLast ? 0 : 18 }]}>
        <Text
          style={[
            styles.tlTitle,
            {
              color: status === "pending" ? colors.mutedForeground : colors.foreground,
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
          <View style={[styles.tlBadge, { backgroundColor: "#fff5e6" }]}>
            <View style={styles.tlBadgeDot} />
            <Text style={styles.tlBadgeText}>In progress</Text>
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

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ width: 38 }} />
        <Text style={styles.headerTitle}>Application Status</Text>
        <TouchableOpacity
          style={[styles.headerBtn, { backgroundColor: "#f5f5f5" }]}
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert("Application options", undefined, [
              { text: "Refresh status" },
              { text: "Contact support" },
              { text: "Cancel", style: "cancel" },
            ])
          }
        >
          <Feather name="more-horizontal" size={18} color="#0a0a0a" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#0d2818", "#0a0a0a"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroAnimWrap}>
            <PulseRing delay={0} color={colors.primary} />
            <PulseRing delay={800} color={colors.primary} />
            <PulseRing delay={1600} color={colors.primary} />
            <SpinningRing color={colors.primary} />
            <View style={[styles.heroIconCircle, { backgroundColor: colors.primary }]}>
              <Feather name="shield" size={28} color="#fff" />
            </View>
          </View>

          <Text style={styles.heroTitle}>Verification in Progress</Text>
          <Text style={styles.heroSub}>
            Our team is reviewing your documents. You'll be notified once approved.
          </Text>

          <View style={styles.heroEtaPill}>
            <Feather name="clock" size={12} color="#fff" />
            <Text style={styles.heroEtaText}>Typically 24-48 hours</Text>
          </View>
        </LinearGradient>

        <View style={[styles.card, { borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            Review Timeline
          </Text>
          <View style={styles.timeline}>
            <TimelineStep
              status="done"
              title="Documents Submitted"
              description="All 3 documents received successfully"
            />
            <TimelineStep
              status="active"
              title="Under Admin Review"
              description="Our verification team is checking your details"
            />
            <TimelineStep
              status="pending"
              title="Verification Complete"
              description="You'll be able to start accepting rides"
              isLast
            />
          </View>
        </View>

        <View style={[styles.messageCard, { borderColor: colors.border }]}>
          <View style={styles.messageHeader}>
            <View
              style={[
                styles.adminAvatar,
                { backgroundColor: "rgba(0, 200, 83, 0.12)" },
              ]}
            >
              <Feather name="user-check" size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.messageHeaderRow}>
                <Text style={[styles.messageAuthor, { color: colors.foreground }]}>
                  Verification Team
                </Text>
                <View style={[styles.verifiedDot, { backgroundColor: colors.primary }]}>
                  <Feather name="check" size={8} color="#fff" />
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
            <Text style={{ fontWeight: "700", color: colors.primary }}>
              24-48 hours
            </Text>
            . Keep an eye on your notifications."
          </Text>
          <View style={[styles.messageFooter, { borderTopColor: colors.border }]}>
            <Feather name="info" size={12} color={colors.mutedForeground} />
            <Text style={[styles.messageFooterText, { color: colors.mutedForeground }]}>
              Ticket ID: DRV-2026-04827
            </Text>
          </View>
        </View>

        <View style={[styles.card, { borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>
            What you can do meanwhile
          </Text>
          {[
            {
              icon: "smartphone",
              title: "Keep notifications on",
              desc: "We'll ping you the moment your account is approved.",
            },
            {
              icon: "book-open",
              title: "Read the driver handbook",
              desc: "Learn best practices for top ratings and earnings.",
            },
            {
              icon: "tool",
              title: "Get your vehicle ready",
              desc: "Service check, clean interiors, working AC.",
            },
          ].map((tip) => (
            <View key={tip.title} style={styles.tipRow}>
              <View style={[styles.tipIcon, { backgroundColor: "#f0fdf4" }]}>
                <Feather name={tip.icon as any} size={15} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.tipTitle, { color: colors.foreground }]}>
                  {tip.title}
                </Text>
                <Text style={[styles.tipDesc, { color: colors.mutedForeground }]}>
                  {tip.desc}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.supportRow, { borderColor: colors.border }]}
          activeOpacity={0.7}
          onPress={() =>
            Alert.alert(
              "Contact support",
              "Our team is available 24×7 at support@driver.app or +91 80000 00000.",
            )
          }
        >
          <View
            style={[styles.supportIcon, { backgroundColor: "#fff5e6" }]}
          >
            <Feather name="help-circle" size={16} color="#b75d00" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.supportTitle, { color: colors.foreground }]}>
              Need help?
            </Text>
            <Text style={[styles.supportSub, { color: colors.mutedForeground }]}>
              Contact our support team 24×7
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            paddingBottom: insets.bottom + 16,
            borderTopColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          onPress={() => router.replace("/(tabs)")}
          activeOpacity={0.85}
        >
          <Feather name="home" size={17} color="#fff" />
          <Text style={styles.primaryBtnText}>Go to Dashboard</Text>
        </TouchableOpacity>
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
          <Feather name="bell" size={15} color={colors.foreground} />
          <Text style={[styles.ghostBtnText, { color: colors.foreground }]}>
            Notify me when verified
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
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#0a0a0a" },
  headerBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 14 },

  hero: {
    borderRadius: 22,
    paddingVertical: 30,
    paddingHorizontal: 24,
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  heroAnimWrap: {
    width: 130,
    height: 130,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  pulseRing: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
  },
  spinRing: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
  },
  heroIconCircle: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  heroSub: {
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: 8,
  },
  heroEtaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    marginTop: 4,
  },
  heroEtaText: { fontSize: 11, fontWeight: "600", color: "#fff", letterSpacing: 0.3 },

  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700" },

  timeline: { gap: 0 },
  tlRow: { flexDirection: "row", gap: 12 },
  tlIconCol: { alignItems: "center", width: 24 },
  tlDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  tlActiveCore: { width: 8, height: 8, borderRadius: 4 },
  tlLine: { flex: 1, width: 2, marginTop: 4, minHeight: 24 },
  tlContent: { flex: 1, paddingTop: 1, gap: 3 },
  tlTitle: { fontSize: 14 },
  tlDesc: { fontSize: 12, lineHeight: 17 },
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
  tlBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#b75d00",
  },
  tlBadgeText: { fontSize: 10, fontWeight: "700", color: "#b75d00", letterSpacing: 0.3 },

  messageCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  messageHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  adminAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  messageHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  messageAuthor: { fontSize: 14, fontWeight: "700" },
  verifiedDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  messageMeta: { fontSize: 11, marginTop: 1 },
  messageBody: { fontSize: 13, lineHeight: 19 },
  messageFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingTop: 8,
    borderTopWidth: 1,
  },
  messageFooterText: { fontSize: 11, fontWeight: "500" },

  tipRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, paddingVertical: 4 },
  tipIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tipTitle: { fontSize: 13, fontWeight: "700", marginBottom: 1 },
  tipDesc: { fontSize: 12, lineHeight: 17 },

  supportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  supportIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  supportTitle: { fontSize: 13, fontWeight: "700" },
  supportSub: { fontSize: 11, marginTop: 1 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: "#fff",
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
  ghostBtnText: { fontSize: 14, fontWeight: "600" },
});
