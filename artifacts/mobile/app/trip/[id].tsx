import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path } from "react-native-svg";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

type TripStage = "to_pickup" | "arrived" | "in_trip" | "completed";

const STAGES: { id: TripStage; label: string; sub: string }[] = [
  { id: "to_pickup", label: "Heading to pickup", sub: "Drive to passenger" },
  { id: "arrived", label: "Arrived at pickup", sub: "Waiting for passenger" },
  { id: "in_trip", label: "Trip in progress", sub: "Heading to drop" },
  { id: "completed", label: "Trip completed", sub: "Collect payment" },
];

function DriverPin({ color }: { color: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.driverPinWrap}>
      <Animated.View
        style={[
          styles.driverPinPulse,
          {
            backgroundColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
          },
        ]}
      />
      <View style={[styles.driverPinPulse, { backgroundColor: color, opacity: 0.18 }]} />
      <View style={[styles.driverPinCore, { backgroundColor: color }]}>
        <Feather name="navigation" size={14} color="#fff" />
      </View>
    </View>
  );
}

function MapPlaceholder({ stage, color }: { stage: TripStage; color: string }) {
  const progress =
    stage === "to_pickup" ? 0.25
    : stage === "arrived" ? 0.5
    : stage === "in_trip" ? 0.75
    : 1;

  // path from pickup (top-left) to drop (bottom-right)
  const pathD = "M 60 70 Q 140 110 180 200 T 320 360";

  return (
    <LinearGradient
      colors={["#e8f0ee", "#dde7e2", "#cfd9d4"]}
      style={styles.map}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      {/* fake grid streets */}
      <View style={styles.mapGrid} pointerEvents="none">
        {Array.from({ length: 7 }).map((_, i) => (
          <View
            key={`h${i}`}
            style={[
              styles.gridH,
              {
                top: 40 + i * 50,
                backgroundColor: "rgba(255,255,255,0.5)",
              },
            ]}
          />
        ))}
        {Array.from({ length: 5 }).map((_, i) => (
          <View
            key={`v${i}`}
            style={[
              styles.gridV,
              {
                left: 30 + i * 80,
                backgroundColor: "rgba(255,255,255,0.5)",
              },
            ]}
          />
        ))}
      </View>

      {/* route path */}
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 380 430">
        <Path
          d={pathD}
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={8}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={pathD}
          stroke={color}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray="0 0"
        />
        <Circle cx={60} cy={70} r={10} fill={color} stroke="#fff" strokeWidth={3} />
        <Circle cx={320} cy={360} r={10} fill="#FF3B30" stroke="#fff" strokeWidth={3} />
      </Svg>

      {/* driver pin moving along the path */}
      <View
        style={[
          styles.driverPinPosition,
          {
            top: 70 + (360 - 70) * progress - 18,
            left: 60 + (320 - 60) * progress - 18,
          },
        ]}
      >
        <DriverPin color={color} />
      </View>

      {/* labels */}
      <View style={[styles.mapLabel, { top: 50, left: 80 }]}>
        <View style={[styles.mapLabelDot, { backgroundColor: color }]} />
        <Text style={styles.mapLabelText}>Pickup</Text>
      </View>
      <View style={[styles.mapLabel, { top: 340, right: 30 }]}>
        <View style={[styles.mapLabelDot, { backgroundColor: "#FF3B30" }]} />
        <Text style={styles.mapLabelText}>Drop</Text>
      </View>
    </LinearGradient>
  );
}

function ProgressStepper({ stage }: { stage: TripStage }) {
  const colors = useColors();
  const activeIdx = STAGES.findIndex((s) => s.id === stage);

  return (
    <View style={styles.stepper}>
      {STAGES.map((s, idx) => {
        const done = idx < activeIdx;
        const active = idx === activeIdx;
        const dotColor = done || active ? colors.primary : colors.border;
        const dotBg = done ? colors.primary : active ? "rgba(0, 200, 83, 0.18)" : "#f5f5f5";
        return (
          <View key={s.id} style={styles.stepItem}>
            <View style={styles.stepDotCol}>
              <View
                style={[
                  styles.stepDot,
                  { backgroundColor: dotBg, borderColor: dotColor },
                ]}
              >
                {done ? (
                  <Feather name="check" size={9} color="#fff" />
                ) : active ? (
                  <View style={[styles.stepActiveCore, { backgroundColor: colors.primary }]} />
                ) : null}
              </View>
              {idx < STAGES.length - 1 && (
                <View
                  style={[
                    styles.stepLine,
                    { backgroundColor: done ? colors.primary : colors.border },
                  ]}
                />
              )}
            </View>
            <Text
              style={[
                styles.stepLabel,
                {
                  color: active || done ? colors.foreground : colors.mutedForeground,
                  fontWeight: active ? "800" : "600",
                },
              ]}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function ActiveTripScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const { activeRide, advanceStage, endActiveRide } = useDriver();

  useEffect(() => {
    if (!activeRide) {
      router.replace("/(tabs)");
    }
  }, [activeRide]);

  const stage: TripStage = activeRide?.stage ?? "to_pickup";
  const stageInfo = STAGES.find((s) => s.id === stage)!;
  const isInTrip = stage === "in_trip" || stage === "arrived";

  function advance() {
    if (stage === "completed") {
      endActiveRide();
      router.replace("/(tabs)");
      return;
    }
    advanceStage();
  }

  const ctaConfig = {
    to_pickup: { label: "I've Arrived", icon: "map-pin" as const },
    arrived: { label: "Start Trip", icon: "play" as const },
    in_trip: { label: "Complete Trip", icon: "flag" as const },
    completed: { label: "Back to Dashboard", icon: "home" as const },
  }[stage];

  const etaMins =
    stage === "to_pickup" ? 4
    : stage === "arrived" ? 0
    : stage === "in_trip" ? 18
    : 0;
  const distanceKm =
    stage === "to_pickup" ? 1.2
    : stage === "arrived" ? 0
    : stage === "in_trip" ? 7.4
    : 0;

  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      {/* MAP */}
      <View style={styles.mapContainer}>
        <MapPlaceholder stage={stage} color={colors.primary} />

        {/* Floating top bar */}
        <View style={[styles.mapTopBar, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            style={styles.mapIconBtn}
            onPress={() => router.replace("/(tabs)")}
            activeOpacity={0.7}
          >
            <Feather name="arrow-left" size={18} color="#0a0a0a" />
          </TouchableOpacity>
          <View style={styles.statusPill}>
            <View style={[styles.statusPillDot, { backgroundColor: colors.primary }]} />
            <Text style={styles.statusPillText}>{stageInfo.label}</Text>
          </View>
          <TouchableOpacity style={styles.mapIconBtn} activeOpacity={0.7}>
            <Feather name="more-vertical" size={18} color="#0a0a0a" />
          </TouchableOpacity>
        </View>

        {/* Floating ETA card */}
        {stage !== "completed" && (
          <View style={[styles.etaCard, { bottom: 20 }]}>
            <View
              style={[
                styles.etaIconWrap,
                { backgroundColor: stage === "in_trip" ? "#FFEBE9" : "#f0fdf4" },
              ]}
            >
              <Feather
                name={stage === "in_trip" ? "flag" : "map-pin"}
                size={16}
                color={stage === "in_trip" ? "#FF3B30" : colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.etaLabel, { color: colors.mutedForeground }]}>
                {stage === "arrived"
                  ? "WAITING FOR PASSENGER"
                  : stage === "in_trip"
                    ? "ETA TO DROP"
                    : "ETA TO PICKUP"}
              </Text>
              <Text style={[styles.etaValue, { color: colors.foreground }]}>
                {stage === "arrived" ? "At location" : `${etaMins} min · ${distanceKm} km`}
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.navBtn, { backgroundColor: colors.primary }]}
              activeOpacity={0.85}
            >
              <Feather name="navigation" size={14} color="#fff" />
              <Text style={styles.navBtnText}>Navigate</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* BOTTOM SHEET */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
        <View style={styles.sheetHandle} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 14, paddingBottom: 6 }}
        >
          {/* PROGRESS STEPPER */}
          <ProgressStepper stage={stage} />

          {/* CUSTOMER CARD */}
          <View style={[styles.customerCard, { borderColor: colors.border }]}>
            <View style={styles.customerRow}>
              <View style={[styles.customerAvatar, { backgroundColor: "#fff5e6" }]}>
                <Text style={[styles.customerAvatarText, { color: "#b75d00" }]}>
                  PS
                </Text>
                <View style={[styles.verifiedDot, { backgroundColor: colors.primary }]}>
                  <Feather name="check" size={7} color="#fff" />
                </View>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customerName, { color: colors.foreground }]}>
                  Priya S.
                </Text>
                <View style={styles.customerMeta}>
                  <Feather name="star" size={11} color="#FFB300" />
                  <Text style={[styles.customerMetaText, { color: colors.mutedForeground }]}>
                    4.87
                  </Text>
                  <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                  <Text style={[styles.customerMetaText, { color: colors.mutedForeground }]}>
                    142 trips
                  </Text>
                </View>
              </View>
              <View style={styles.contactBtns}>
                <TouchableOpacity
                  style={[styles.contactBtn, { backgroundColor: colors.primary }]}
                  activeOpacity={0.85}
                >
                  <Feather name="phone" size={15} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.contactBtn, { backgroundColor: "#f5f5f5" }]}
                  activeOpacity={0.7}
                >
                  <Feather name="message-circle" size={15} color="#0a0a0a" />
                </TouchableOpacity>
              </View>
            </View>

            {/* OTP for pickup verification */}
            {(stage === "to_pickup" || stage === "arrived") && (
              <View style={[styles.otpBox, { backgroundColor: "#f0fdf4", borderColor: colors.primary }]}>
                <Feather name="shield" size={14} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.otpLabel, { color: colors.mutedForeground }]}>
                    Ride OTP — share with passenger
                  </Text>
                  <View style={styles.otpDigits}>
                    {["4", "8", "2", "7"].map((d, i) => (
                      <View
                        key={i}
                        style={[styles.otpDigit, { borderColor: colors.primary }]}
                      >
                        <Text style={[styles.otpDigitText, { color: colors.primary }]}>
                          {d}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            )}
          </View>

          {/* ROUTE INFO */}
          <View style={[styles.routeCard, { borderColor: colors.border }]}>
            <View style={styles.routeIcons}>
              <View style={[styles.routePinDot, { backgroundColor: colors.primary }]} />
              <View style={styles.routeDottedLine}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <View key={i} style={[styles.routeDot, { backgroundColor: colors.border }]} />
                ))}
              </View>
              <View style={[styles.routePinSquare, { backgroundColor: "#FF3B30" }]} />
            </View>
            <View style={{ flex: 1, gap: 12 }}>
              <View>
                <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                  PICKUP
                </Text>
                <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={1}>
                  Indiranagar Metro Station
                </Text>
              </View>
              <View>
                <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                  DROP · 8.4 km
                </Text>
                <Text style={[styles.routeAddr, { color: colors.foreground }]} numberOfLines={1}>
                  Phoenix Marketcity, Whitefield
                </Text>
              </View>
            </View>
          </View>

          {/* FARE STRIP */}
          <View style={[styles.fareStrip, { borderColor: colors.border }]}>
            {[
              { label: "Fare", value: "₹186", icon: "credit-card" },
              { label: "Distance", value: "9.6 km", icon: "map" },
              { label: "Payment", value: "UPI", icon: "smartphone" },
            ].map((item, i) => (
              <View key={item.label} style={styles.fareItem}>
                <Feather name={item.icon as any} size={13} color={colors.mutedForeground} />
                <Text style={[styles.fareValue, { color: colors.foreground }]}>
                  {item.value}
                </Text>
                <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>
                  {item.label}
                </Text>
                {i < 2 && (
                  <View style={[styles.fareDivider, { backgroundColor: colors.border }]} />
                )}
              </View>
            ))}
          </View>
        </ScrollView>

        {/* PRIMARY CTA */}
        <TouchableOpacity
          style={[
            styles.cta,
            {
              backgroundColor: stage === "completed" ? "#0a0a0a" : colors.primary,
            },
          ]}
          onPress={advance}
          activeOpacity={0.85}
        >
          <Feather name={ctaConfig.icon} size={18} color="#fff" />
          <Text style={styles.ctaText}>{ctaConfig.label}</Text>
          <Feather name="arrow-right" size={18} color="#fff" />
        </TouchableOpacity>

        {isInTrip && (
          <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.6}>
            <Feather name="alert-triangle" size={12} color="#FF3B30" />
            <Text style={styles.cancelText}>Cancel trip · Report issue</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: {
    height: "44%",
    position: "relative",
  },
  map: { flex: 1, overflow: "hidden" },
  mapGrid: { ...StyleSheet.absoluteFillObject },
  gridH: { position: "absolute", left: 0, right: 0, height: 1 },
  gridV: { position: "absolute", top: 0, bottom: 0, width: 1 },

  mapTopBar: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  mapIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statusPillDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusPillText: { fontSize: 12, fontWeight: "700", color: "#0a0a0a" },

  mapLabel: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#fff",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  mapLabelDot: { width: 6, height: 6, borderRadius: 3 },
  mapLabelText: { fontSize: 10, fontWeight: "700", color: "#0a0a0a" },

  driverPinPosition: { position: "absolute", width: 36, height: 36 },
  driverPinWrap: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  driverPinPulse: {
    position: "absolute",
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  driverPinCore: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#00C853",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  etaCard: {
    position: "absolute",
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  etaIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  etaLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  etaValue: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  navBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  sheet: {
    flex: 1,
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingTop: 10,
    marginTop: -14,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e0e0e0",
    marginBottom: 4,
  },

  stepper: {
    flexDirection: "row",
    paddingTop: 2,
    paddingHorizontal: 2,
  },
  stepItem: { flex: 1, alignItems: "center", gap: 6 },
  stepDotCol: { width: "100%", alignItems: "center", flexDirection: "row", justifyContent: "center" },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    backgroundColor: "#fff",
  },
  stepActiveCore: { width: 6, height: 6, borderRadius: 3 },
  stepLine: { flex: 1, height: 2 },
  stepLabel: {
    fontSize: 9,
    textAlign: "center",
    letterSpacing: 0.1,
    paddingHorizontal: 2,
  },

  customerCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  customerRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  customerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  customerAvatarText: { fontSize: 13, fontWeight: "800" },
  verifiedDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  customerName: { fontSize: 15, fontWeight: "800" },
  customerMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 },
  customerMetaText: { fontSize: 11, fontWeight: "600" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  contactBtns: { flexDirection: "row", gap: 6 },
  contactBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },

  otpBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  otpLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  otpDigits: { flexDirection: "row", gap: 5, marginTop: 4 },
  otpDigit: {
    width: 26,
    height: 28,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  otpDigitText: { fontSize: 14, fontWeight: "800", letterSpacing: 0.4 },

  routeCard: {
    flexDirection: "row",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: "#fff",
  },
  routeIcons: { alignItems: "center", paddingTop: 6, gap: 3 },
  routePinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#fff",
  },
  routePinSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  routeDottedLine: { gap: 3, paddingVertical: 3, alignItems: "center" },
  routeDot: { width: 2, height: 2, borderRadius: 1 },
  routeLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4 },
  routeAddr: { fontSize: 13, fontWeight: "700", marginTop: 1 },

  fareStrip: {
    flexDirection: "row",
    backgroundColor: "#fafafa",
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
  },
  fareItem: { flex: 1, alignItems: "center", gap: 2, position: "relative" },
  fareDivider: {
    position: "absolute",
    right: 0,
    top: 6,
    bottom: 6,
    width: 1,
  },
  fareValue: { fontSize: 13, fontWeight: "800", marginTop: 2 },
  fareLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.3 },

  cta: {
    height: 54,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "800" },

  cancelBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 6,
  },
  cancelText: { fontSize: 11, fontWeight: "600", color: "#FF3B30" },
});
