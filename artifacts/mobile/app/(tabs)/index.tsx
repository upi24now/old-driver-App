import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function RadarPulse({ color }: { color: string }) {
  const a1 = useRef(new Animated.Value(0)).current;
  const a2 = useRef(new Animated.Value(0)).current;
  const a3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const make = (v: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.timing(v, {
          toValue: 1,
          duration: 2400,
          delay,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        })
      );
    const l1 = make(a1, 0);
    const l2 = make(a2, 800);
    const l3 = make(a3, 1600);
    l1.start();
    l2.start();
    l3.start();
    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
    };
  }, []);

  const ring = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.radarRing,
        {
          borderColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
          transform: [
            {
              scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.9] }),
            },
          ],
        },
      ]}
    />
  );

  return (
    <View style={styles.radarWrap}>
      {ring(a1)}
      {ring(a2)}
      {ring(a3)}
      <View style={[styles.radarCore, { backgroundColor: color }]}>
        <Feather name="navigation" size={22} color="#fff" />
      </View>
    </View>
  );
}

function StatusPulseDot({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.statusDotWrap}>
      <Animated.View
        style={[
          styles.statusDotPulse,
          {
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [
              { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) },
            ],
          },
        ]}
      />
      <View style={[styles.statusDotCore, { backgroundColor: color }]} />
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [online, setOnline] = useState(false);

  const weeklyEarned = 4280;
  const weeklyGoal = 7000;
  const weeklyPct = Math.min(weeklyEarned / weeklyGoal, 1);

  return (
    <View style={{ flex: 1, backgroundColor: "#fafafa" }}>
      <ScrollView
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingBottom: 32,
          paddingHorizontal: 16,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* TOP BAR */}
        <View style={styles.topBar}>
          <TouchableOpacity activeOpacity={0.8} style={styles.avatarRow}>
            <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>RK</Text>
              <View style={[styles.avatarRing, { borderColor: colors.primary }]} />
            </View>
            <View>
              <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
                Good morning
              </Text>
              <Text style={[styles.driverName, { color: colors.foreground }]}>
                Rohit K. <Feather name="chevron-down" size={14} color="#999" />
              </Text>
            </View>
          </TouchableOpacity>
          <View style={styles.topActions}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: "#fff", borderColor: colors.border }]}
              activeOpacity={0.7}
            >
              <Feather name="bell" size={17} color="#0a0a0a" />
              <View style={[styles.notifBadge, { backgroundColor: "#FF3B30" }]}>
                <Text style={styles.notifBadgeText}>3</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* ONLINE/OFFLINE TOGGLE */}
        <LinearGradient
          colors={online ? ["#0d2818", "#0a0a0a"] : ["#fff", "#fff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.statusCard,
            {
              borderColor: online ? "transparent" : colors.border,
              borderWidth: online ? 0 : 1,
            },
          ]}
        >
          <View style={styles.statusLeft}>
            <StatusPulseDot color={online ? colors.primary : "#9E9E9E"} />
            <View>
              <Text
                style={[
                  styles.statusLabel,
                  { color: online ? "rgba(255,255,255,0.6)" : colors.mutedForeground },
                ]}
              >
                YOU ARE
              </Text>
              <Text
                style={[
                  styles.statusValue,
                  { color: online ? colors.primary : "#0a0a0a" },
                ]}
              >
                {online ? "Online" : "Offline"}
              </Text>
              <Text
                style={[
                  styles.statusSub,
                  { color: online ? "rgba(255,255,255,0.55)" : colors.mutedForeground },
                ]}
              >
                {online
                  ? "Accepting ride requests nearby"
                  : "Tap to start receiving requests"}
              </Text>
            </View>
          </View>
          <Switch
            value={online}
            onValueChange={setOnline}
            trackColor={{ false: "#E0E0E0", true: colors.primary }}
            thumbColor="#fff"
            ios_backgroundColor="#E0E0E0"
            style={{ transform: [{ scaleX: 1.15 }, { scaleY: 1.15 }] }}
          />
        </LinearGradient>

        {/* EARNINGS HERO */}
        <LinearGradient
          colors={["#00C853", "#00A847"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.earningsCard}
        >
          <View style={styles.earningsTop}>
            <View>
              <Text style={styles.earningsLabel}>TODAY'S EARNINGS</Text>
              <View style={styles.earningsAmountRow}>
                <Text style={styles.earningsCurrency}>₹</Text>
                <Text style={styles.earningsAmount}>1,248</Text>
                <View style={styles.earningsDelta}>
                  <Feather name="trending-up" size={11} color="#fff" />
                  <Text style={styles.earningsDeltaText}>+18%</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={styles.cashoutBtn}
              onPress={() => router.push("/wallet")}
              activeOpacity={0.8}
            >
              <Feather name="zap" size={12} color="#0a0a0a" />
              <Text style={styles.cashoutText}>Cash out</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.earningsBreakdown}>
            <View style={styles.breakdownItem}>
              <Feather name="navigation" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>14</Text>
              <Text style={styles.breakdownLabel}>Trips</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Feather name="clock" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>6h 42m</Text>
              <Text style={styles.breakdownLabel}>Online</Text>
            </View>
            <View style={styles.breakdownDivider} />
            <View style={styles.breakdownItem}>
              <Feather name="map-pin" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.breakdownValue}>87 km</Text>
              <Text style={styles.breakdownLabel}>Distance</Text>
            </View>
          </View>
        </LinearGradient>

        {/* QUICK STATS ROW */}
        <View style={styles.quickStats}>
          {[
            { icon: "star", value: "4.92", label: "Rating", color: "#FFB300" },
            { icon: "check-circle", value: "96%", label: "Acceptance", color: colors.primary },
            { icon: "award", value: "Gold", label: "Tier", color: "#9C27B0" },
          ].map((s) => (
            <View
              key={s.label}
              style={[styles.qStatCard, { borderColor: colors.border }]}
            >
              <View style={[styles.qStatIcon, { backgroundColor: s.color + "1a" }]}>
                <Feather name={s.icon as any} size={14} color={s.color} />
              </View>
              <Text style={[styles.qStatValue, { color: colors.foreground }]}>
                {s.value}
              </Text>
              <Text style={[styles.qStatLabel, { color: colors.mutedForeground }]}>
                {s.label}
              </Text>
            </View>
          ))}
        </View>

        {/* RIDE REQUEST AREA */}
        <View
          style={[
            styles.requestCard,
            {
              borderColor: online ? colors.primary : colors.border,
              backgroundColor: "#fff",
              borderWidth: online ? 1.5 : 1,
            },
          ]}
        >
          <View style={styles.requestHeader}>
            <Text style={[styles.requestTitle, { color: colors.foreground }]}>
              Ride Requests
            </Text>
            <View
              style={[
                styles.requestBadge,
                {
                  backgroundColor: online ? "#f0fdf4" : "#f5f5f5",
                },
              ]}
            >
              <View
                style={[
                  styles.requestBadgeDot,
                  { backgroundColor: online ? colors.primary : "#9E9E9E" },
                ]}
              />
              <Text
                style={[
                  styles.requestBadgeText,
                  { color: online ? colors.primary : colors.mutedForeground },
                ]}
              >
                {online ? "Live" : "Paused"}
              </Text>
            </View>
          </View>

          {online ? (
            <View style={styles.requestActive}>
              <RadarPulse color={colors.primary} />
              <Text style={[styles.requestActiveTitle, { color: colors.foreground }]}>
                Looking for ride requests
              </Text>
              <Text style={[styles.requestActiveSub, { color: colors.mutedForeground }]}>
                We'll notify you instantly when a request comes in your area.
              </Text>
              <View style={styles.requestStatsRow}>
                <View style={styles.requestStat}>
                  <Text style={[styles.requestStatNum, { color: colors.foreground }]}>
                    12
                  </Text>
                  <Text style={[styles.requestStatLbl, { color: colors.mutedForeground }]}>
                    Drivers near you
                  </Text>
                </View>
                <View style={[styles.requestVDivider, { backgroundColor: colors.border }]} />
                <View style={styles.requestStat}>
                  <Text style={[styles.requestStatNum, { color: colors.foreground }]}>
                    High
                  </Text>
                  <Text style={[styles.requestStatLbl, { color: colors.mutedForeground }]}>
                    Demand
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  style={[styles.simulateBtn, { borderColor: colors.primary, flex: 1 }]}
                  onPress={() => router.push("/ride-request")}
                  activeOpacity={0.7}
                >
                  <Feather name="bell" size={12} color={colors.primary} />
                  <Text style={[styles.simulateText, { color: colors.primary }]}>
                    Simulate request
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.simulateBtn, { borderColor: "#FF3B30", flex: 1 }]}
                  onPress={() => router.push("/lock-alert")}
                  activeOpacity={0.7}
                >
                  <Feather name="lock" size={12} color="#FF3B30" />
                  <Text style={[styles.simulateText, { color: "#FF3B30" }]}>
                    Lock screen alert
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.requestOffline}>
              <View style={[styles.offlineIcon, { backgroundColor: "#f5f5f5" }]}>
                <Feather name="power" size={22} color="#9E9E9E" />
              </View>
              <Text style={[styles.requestActiveTitle, { color: colors.foreground }]}>
                You're offline
              </Text>
              <Text style={[styles.requestActiveSub, { color: colors.mutedForeground }]}>
                Go online to start receiving ride requests from passengers near you.
              </Text>
              <TouchableOpacity
                style={[styles.goOnlineBtn, { backgroundColor: colors.primary }]}
                onPress={() => setOnline(true)}
                activeOpacity={0.85}
              >
                <Feather name="power" size={14} color="#fff" />
                <Text style={styles.goOnlineText}>Go Online</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* WEEKLY GOAL */}
        <View style={[styles.goalCard, { borderColor: colors.border }]}>
          <View style={styles.goalHeader}>
            <View>
              <Text style={[styles.goalLabel, { color: colors.mutedForeground }]}>
                WEEKLY GOAL
              </Text>
              <Text style={[styles.goalTitle, { color: colors.foreground }]}>
                ₹{weeklyEarned.toLocaleString()}{" "}
                <Text style={[styles.goalTotal, { color: colors.mutedForeground }]}>
                  / ₹{weeklyGoal.toLocaleString()}
                </Text>
              </Text>
            </View>
            <View style={[styles.goalPctChip, { backgroundColor: "#f0fdf4" }]}>
              <Text style={[styles.goalPctText, { color: colors.primary }]}>
                {Math.round(weeklyPct * 100)}%
              </Text>
            </View>
          </View>
          <View style={[styles.goalTrack, { backgroundColor: colors.border }]}>
            <View
              style={[
                styles.goalFill,
                {
                  width: `${weeklyPct * 100}%`,
                  backgroundColor: colors.primary,
                },
              ]}
            />
          </View>
          <View style={styles.goalFooter}>
            <Text style={[styles.goalFooterText, { color: colors.mutedForeground }]}>
              ₹{(weeklyGoal - weeklyEarned).toLocaleString()} to go
            </Text>
            <Text style={[styles.goalFooterText, { color: colors.mutedForeground }]}>
              3 days left
            </Text>
          </View>
        </View>

        {/* QUICK ACTIONS */}
        <View style={styles.quickActions}>
          {[
            { icon: "credit-card", label: "Wallet", path: "/wallet", color: "#00C853" },
            { icon: "zap", label: "Plans", path: "/subscription", color: "#FF6F00" },
            { icon: "list", label: "History", path: "/(tabs)/trips", color: "#1976D2" },
            { icon: "user", label: "Profile", path: "/(tabs)/profile", color: "#673AB7" },
          ].map((a) => (
            <TouchableOpacity
              key={a.label}
              style={[styles.actionTile, { borderColor: colors.border }]}
              onPress={() => a.path && router.push(a.path as any)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.actionIcon,
                  { backgroundColor: a.color + "1a" },
                ]}
              >
                <Feather name={a.icon as any} size={16} color={a.color} />
              </View>
              <Text style={[styles.actionLabel, { color: colors.foreground }]}>
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRing: {
    position: "absolute",
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
  },
  avatarText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  greeting: { fontSize: 11, fontWeight: "500", letterSpacing: 0.3 },
  driverName: { fontSize: 16, fontWeight: "800", marginTop: 1 },
  topActions: { flexDirection: "row", gap: 8 },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  notifBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    minWidth: 15,
    height: 15,
    borderRadius: 7.5,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  notifBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },

  statusCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    borderRadius: 18,
  },
  statusLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  statusDotWrap: {
    width: 14,
    height: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotPulse: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  statusDotCore: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6 },
  statusValue: { fontSize: 22, fontWeight: "800", marginTop: 2, letterSpacing: -0.3 },
  statusSub: { fontSize: 11, marginTop: 2 },

  earningsCard: {
    borderRadius: 20,
    padding: 18,
    gap: 16,
    shadowColor: "#00C853",
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  earningsTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  earningsLabel: { fontSize: 10, fontWeight: "700", color: "rgba(255,255,255,0.8)", letterSpacing: 0.6 },
  earningsAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 4, marginTop: 4 },
  earningsCurrency: { fontSize: 20, fontWeight: "700", color: "#fff", marginBottom: 4 },
  earningsAmount: { fontSize: 36, fontWeight: "800", color: "#fff", letterSpacing: -1, lineHeight: 40 },
  earningsDelta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    marginLeft: 6,
    marginBottom: 6,
  },
  earningsDeltaText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  cashoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 11,
  },
  cashoutText: { color: "#0a0a0a", fontSize: 12, fontWeight: "700" },
  earningsBreakdown: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 12,
    padding: 12,
  },
  breakdownItem: { flex: 1, alignItems: "center", gap: 2 },
  breakdownValue: { fontSize: 15, fontWeight: "800", color: "#fff" },
  breakdownLabel: { fontSize: 10, color: "rgba(255,255,255,0.75)", fontWeight: "500" },
  breakdownDivider: { width: 1, height: 28, backgroundColor: "rgba(255,255,255,0.2)" },

  quickStats: { flexDirection: "row", gap: 10 },
  qStatCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: "flex-start",
    gap: 6,
  },
  qStatIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  qStatValue: { fontSize: 18, fontWeight: "800", letterSpacing: -0.2 },
  qStatLabel: { fontSize: 11, fontWeight: "500" },

  requestCard: {
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  requestHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  requestTitle: { fontSize: 15, fontWeight: "700" },
  requestBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  requestBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  requestBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },

  requestActive: { alignItems: "center", gap: 8, paddingVertical: 14 },
  requestOffline: { alignItems: "center", gap: 10, paddingVertical: 18 },
  radarWrap: {
    width: 110,
    height: 110,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  radarRing: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 2,
  },
  radarCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  offlineIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  requestActiveTitle: { fontSize: 16, fontWeight: "700", marginTop: 4 },
  requestActiveSub: { fontSize: 12, textAlign: "center", lineHeight: 17, paddingHorizontal: 16 },
  requestStatsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    backgroundColor: "#fafafa",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignSelf: "stretch",
  },
  requestStat: { flex: 1, alignItems: "center", gap: 2 },
  requestStatNum: { fontSize: 15, fontWeight: "800" },
  requestStatLbl: { fontSize: 10, fontWeight: "500" },
  requestVDivider: { width: 1, height: 26 },
  goOnlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 12,
    marginTop: 6,
  },
  goOnlineText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  simulateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 8,
  },
  simulateText: { fontSize: 11, fontWeight: "700" },

  goalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  goalLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  goalTitle: { fontSize: 18, fontWeight: "800", marginTop: 3, letterSpacing: -0.3 },
  goalTotal: { fontSize: 13, fontWeight: "600" },
  goalPctChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  goalPctText: { fontSize: 13, fontWeight: "800" },
  goalTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  goalFill: { height: "100%", borderRadius: 4 },
  goalFooter: { flexDirection: "row", justifyContent: "space-between" },
  goalFooterText: { fontSize: 11, fontWeight: "600" },

  quickActions: { flexDirection: "row", gap: 10 },
  actionTile: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 6,
  },
  actionIcon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: { fontSize: 11, fontWeight: "700" },
});
