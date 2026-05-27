import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

const TIMER_SECONDS = 15;
const RING_SIZE = 64;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

function UrgencyRing({
  progress,
  seconds,
  urgent,
}: {
  progress: Animated.Value;
  seconds: number;
  urgent: boolean;
}) {
  const colors = useColors();
  const ringColor = urgent ? "#FF3B30" : colors.primary;
  const dashOffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, RING_CIRC],
  });

  return (
    <View style={[styles.ringWrap, { width: RING_SIZE, height: RING_SIZE }]}>
      <Svg width={RING_SIZE} height={RING_SIZE}>
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke="#eaeaea"
          strokeWidth={RING_STROKE}
          fill="transparent"
        />
        <AnimatedCircle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          stroke={ringColor}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={`${RING_CIRC} ${RING_CIRC}`}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      </Svg>
      <View style={styles.ringCenter}>
        <Text style={[styles.ringNum, { color: urgent ? "#FF3B30" : colors.foreground }]}>
          {seconds}
        </Text>
        <Text style={[styles.ringUnit, { color: colors.mutedForeground }]}>sec</Text>
      </View>
    </View>
  );
}

export default function RideRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { incomingRide, acceptRide, rejectRide } = useDriver();

  const ride = incomingRide ?? {
    pickup: "Indiranagar Metro Station",
    pickupSub: "100 Ft Rd, Bangalore",
    drop: "Phoenix Marketcity",
    dropSub: "Whitefield Main Rd",
    distanceKm: 9.6,
    pickupDistanceKm: 1.2,
    fareEstimate: 186,
    passengerName: "Priya S.",
    passengerRating: 4.9,
    paymentMode: "UPI" as const,
  };
  const riderInitials = ride.passengerName
    .split(" ")
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const [seconds, setSeconds] = useState(TIMER_SECONDS);
  const slide = useRef(new Animated.Value(0)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const acceptScale = useRef(new Animated.Value(1)).current;

  const urgent = seconds <= 5;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.spring(slide, {
        toValue: 1,
        friction: 9,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(ring, {
        toValue: 1,
        duration: TIMER_SECONDS * 1000,
        easing: Easing.linear,
        useNativeDriver: false,
      }),
    ]).start();

    Vibration.vibrate(40);
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // urgency pulse — gets faster as time drops
  useEffect(() => {
    const duration = urgent ? 500 : 1200;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [urgent]);

  // auto-dismiss when timer hits zero (auto-reject)
  useEffect(() => {
    if (seconds === 0) {
      Vibration.vibrate(80);
      setTimeout(() => {
        rejectRide();
        dismiss();
      }, 600);
    }
  }, [seconds]);

  function dismiss(replaceRoute?: string) {
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 240,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      if (replaceRoute) {
        router.replace(replaceRoute as any);
      } else if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/(tabs)");
      }
    });
  }

  function handleAccept() {
    Vibration.vibrate(50);
    Animated.sequence([
      Animated.spring(acceptScale, {
        toValue: 0.92,
        friction: 5,
        useNativeDriver: true,
      }),
      Animated.spring(acceptScale, {
        toValue: 1,
        friction: 4,
        useNativeDriver: true,
      }),
    ]).start();
    acceptRide();
    setTimeout(() => dismiss("/trip/active"), 220);
  }

  const cardTranslate = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [600, 0],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.18, 0.5],
  });

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.backdrop,
          { opacity: backdrop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] }) },
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={() => dismiss()} />
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.sheetWrap,
          {
            paddingBottom: insets.bottom + 16,
            transform: [{ translateY: cardTranslate }],
          },
        ]}
      >
        {/* pulsing glow halo */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.glow,
            {
              backgroundColor: urgent ? "#FF3B30" : colors.primary,
              opacity: pulseOpacity,
              transform: [{ scale: pulseScale }],
            },
          ]}
        />

        <Animated.View
          style={[
            styles.card,
            {
              borderColor: urgent ? "#FF3B30" : colors.primary,
              transform: [{ scale: pulseScale }],
            },
          ]}
        >
          {/* HEADER */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.liveBadge,
                  { backgroundColor: urgent ? "#FFEBEE" : "#f0fdf4" },
                ]}
              >
                <View
                  style={[
                    styles.liveBadgeDot,
                    { backgroundColor: urgent ? "#FF3B30" : colors.primary },
                  ]}
                />
                <Text
                  style={[
                    styles.liveBadgeText,
                    { color: urgent ? "#FF3B30" : colors.primary },
                  ]}
                >
                  {urgent ? "HURRY" : "NEW REQUEST"}
                </Text>
              </View>
              <Text style={[styles.tripType, { color: colors.foreground }]}>
                Mini Car · 2 stops
              </Text>
            </View>
            <UrgencyRing progress={ring} seconds={seconds} urgent={urgent} />
          </View>

          {/* RIDER */}
          <View style={[styles.riderRow, { borderColor: colors.border }]}>
            <View style={[styles.riderAvatar, { backgroundColor: "#fff5e6" }]}>
              <Text style={[styles.riderAvatarText, { color: "#b75d00" }]}>{riderInitials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.riderName, { color: colors.foreground }]}>
                {ride.passengerName}
              </Text>
              <View style={styles.riderMeta}>
                <Feather name="star" size={11} color="#FFB300" />
                <Text style={[styles.riderMetaText, { color: colors.mutedForeground }]}>
                  {ride.passengerRating.toFixed(2)}
                </Text>
                <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                <Text style={[styles.riderMetaText, { color: colors.mutedForeground }]}>
                  142 trips
                </Text>
                <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                <View style={styles.payChip}>
                  <Feather name="credit-card" size={9} color={colors.primary} />
                  <Text style={[styles.payChipText, { color: colors.primary }]}>
                    {ride.paymentMode}
                  </Text>
                </View>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: "#f5f5f5" }]}
              activeOpacity={0.7}
            >
              <Feather name="phone" size={15} color="#0a0a0a" />
            </TouchableOpacity>
          </View>

          {/* ROUTE */}
          <View style={styles.route}>
            <View style={styles.routeIcons}>
              <View style={[styles.routeDot, { backgroundColor: colors.primary }]} />
              <View style={styles.dotLine}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <View
                    key={i}
                    style={[styles.dotLineDot, { backgroundColor: colors.border }]}
                  />
                ))}
              </View>
              <View style={[styles.routeSquare, { backgroundColor: "#FF3B30" }]} />
            </View>
            <View style={styles.routePoints}>
              <View style={styles.routePoint}>
                <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                  PICKUP · {ride.pickupDistanceKm} km away
                </Text>
                <Text
                  style={[styles.routeAddr, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {ride.pickup}
                </Text>
                <Text
                  style={[styles.routeSub, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {ride.pickupSub}
                </Text>
              </View>
              <View style={styles.routePoint}>
                <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                  DROP · {ride.distanceKm} km · ~{Math.round(ride.distanceKm * 2.5)} min
                </Text>
                <Text
                  style={[styles.routeAddr, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {ride.drop}
                </Text>
                <Text
                  style={[styles.routeSub, { color: colors.mutedForeground }]}
                  numberOfLines={1}
                >
                  {ride.dropSub}
                </Text>
              </View>
            </View>
          </View>

          {/* FARE */}
          <LinearGradient
            colors={["#f0fdf4", "#e6faec"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.fareBox, { borderColor: colors.primary }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>
                YOU EARN
              </Text>
              <View style={styles.fareAmountRow}>
                <Text style={[styles.fareCurrency, { color: colors.foreground }]}>₹</Text>
                <Text style={[styles.fareAmount, { color: colors.foreground }]}>
                  {ride.fareEstimate}
                </Text>
                <View style={styles.surgeBadge}>
                  <Feather name="zap" size={10} color="#fff" />
                  <Text style={styles.surgeText}>1.5×</Text>
                </View>
              </View>
              <Text style={[styles.fareSub, { color: colors.mutedForeground }]}>
                Incl. ₹24 tip · Cash + UPI accepted
              </Text>
            </View>
            <View style={[styles.fareDistanceBox, { borderColor: colors.primary }]}>
              <Text style={[styles.fareDistanceNum, { color: colors.primary }]}>
                {ride.distanceKm}
              </Text>
              <Text style={[styles.fareDistanceUnit, { color: colors.primary }]}>
                km total
              </Text>
            </View>
          </LinearGradient>

          {/* ACTIONS */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.rejectBtn, { borderColor: colors.border }]}
              onPress={() => {
                rejectRide();
                dismiss();
              }}
              activeOpacity={0.7}
            >
              <Feather name="x" size={18} color={colors.foreground} />
              <Text style={[styles.rejectText, { color: colors.foreground }]}>
                Reject
              </Text>
            </TouchableOpacity>

            <Animated.View
              style={{ flex: 2, transform: [{ scale: acceptScale }] }}
            >
              <TouchableOpacity
                onPress={handleAccept}
                activeOpacity={0.85}
                style={{ overflow: "hidden", borderRadius: 16 }}
              >
                <LinearGradient
                  colors={["#00E060", "#00A847"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.acceptBtn}
                >
                  <Feather name="check" size={20} color="#fff" />
                  <Text style={styles.acceptText}>Accept Ride</Text>
                  <Feather name="arrow-right" size={18} color="#fff" />
                </LinearGradient>
              </TouchableOpacity>
            </Animated.View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  sheetWrap: {
    paddingHorizontal: 12,
    alignItems: "stretch",
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    bottom: 0,
    borderRadius: 24,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 16,
    gap: 14,
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  headerLeft: { flex: 1, gap: 6 },
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  liveBadgeDot: { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  tripType: { fontSize: 13, fontWeight: "600" },

  ringWrap: { alignItems: "center", justifyContent: "center" },
  ringCenter: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ringNum: { fontSize: 18, fontWeight: "800", lineHeight: 20 },
  ringUnit: { fontSize: 8, fontWeight: "700", letterSpacing: 0.6 },

  riderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  riderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  riderAvatarText: { fontSize: 12, fontWeight: "800" },
  riderName: { fontSize: 14, fontWeight: "700" },
  riderMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  riderMetaText: { fontSize: 11, fontWeight: "600" },
  metaDot: { width: 3, height: 3, borderRadius: 1.5 },
  payChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#f0fdf4",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  payChipText: { fontSize: 10, fontWeight: "700" },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },

  route: { flexDirection: "row", gap: 12, paddingHorizontal: 2 },
  routeIcons: { alignItems: "center", paddingTop: 4, gap: 4 },
  routeDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#00C853",
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  routeSquare: {
    width: 11,
    height: 11,
    borderRadius: 2,
  },
  dotLine: { gap: 3, paddingVertical: 3, alignItems: "center" },
  dotLineDot: { width: 2, height: 2, borderRadius: 1 },
  routePoints: { flex: 1, gap: 10 },
  routePoint: { gap: 1 },
  routeLabel: { fontSize: 9, fontWeight: "700", letterSpacing: 0.4 },
  routeAddr: { fontSize: 14, fontWeight: "700" },
  routeSub: { fontSize: 11, fontWeight: "500" },

  fareBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  fareLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  fareAmountRow: { flexDirection: "row", alignItems: "flex-end", gap: 3, marginTop: 2 },
  fareCurrency: { fontSize: 18, fontWeight: "700", marginBottom: 3 },
  fareAmount: { fontSize: 30, fontWeight: "800", letterSpacing: -1, lineHeight: 32 },
  surgeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#FF6F00",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    marginLeft: 6,
    marginBottom: 4,
  },
  surgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  fareSub: { fontSize: 11, marginTop: 2, fontWeight: "500" },
  fareDistanceBox: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 11,
    borderWidth: 1.5,
    borderStyle: "dashed",
  },
  fareDistanceNum: { fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  fareDistanceUnit: { fontSize: 9, fontWeight: "700", letterSpacing: 0.3 },

  actions: { flexDirection: "row", gap: 10 },
  rejectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: "#fff",
  },
  rejectText: { fontSize: 14, fontWeight: "700" },
  acceptBtn: {
    height: 54,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  acceptText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
