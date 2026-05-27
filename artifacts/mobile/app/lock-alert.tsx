import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

const RING_DURATION = 15;

function ShakingPulsingCard({ children }: { children: React.ReactNode }) {
  const shake = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, {
      toValue: 1,
      damping: 12,
      mass: 0.8,
      stiffness: 130,
      useNativeDriver: true,
    }).start();

    // shake pattern — short burst then pause, like a ringtone vibration
    const shakeBurst = Animated.sequence([
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: -1, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0.5, duration: 50, useNativeDriver: true }),
      Animated.timing(shake, { toValue: 0, duration: 50, useNativeDriver: true }),
      Animated.delay(900),
    ]);
    const shakeLoop = Animated.loop(shakeBurst);
    shakeLoop.start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    return () => {
      shakeLoop.stop();
      pulseLoop.stop();
    };
  }, []);

  return (
    <View style={{ position: "relative" }}>
      {/* outer red glow ring (ringtone feel) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.glowOuter,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] }),
            transform: [
              {
                scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }),
              },
            ],
          },
        ]}
      />
      <Animated.View
        style={{
          opacity: enter,
          transform: [
            {
              translateY: enter.interpolate({
                inputRange: [0, 1],
                outputRange: [40, 0],
              }),
            },
            {
              translateX: shake.interpolate({
                inputRange: [-1, 1],
                outputRange: [-5, 5],
              }),
            },
          ],
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

function CountdownBar({ seconds }: { seconds: number }) {
  const progress = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 0,
      duration: seconds * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, []);
  return (
    <View style={styles.countdownTrack}>
      <Animated.View
        style={[
          styles.countdownFill,
          {
            width: progress.interpolate({
              inputRange: [0, 1],
              outputRange: ["0%", "100%"],
            }),
          },
        ]}
      />
    </View>
  );
}

function CitySkyline() {
  // simple stylized city skyline silhouette
  return (
    <Svg
      style={[StyleSheet.absoluteFillObject, { top: "auto", bottom: 0 }]}
      width="100%"
      height="180"
      viewBox="0 0 400 180"
      preserveAspectRatio="xMidYMax slice"
    >
      <Path
        d="M0 180 L0 130 L25 130 L25 100 L40 100 L40 130 L65 130 L65 80 L80 80 L80 60 L95 60 L95 80 L110 80 L110 110 L135 110 L135 70 L150 70 L150 50 L165 50 L165 70 L180 70 L180 95 L210 95 L210 75 L225 75 L225 55 L240 55 L240 75 L255 75 L255 105 L280 105 L280 85 L295 85 L295 115 L320 115 L320 90 L335 90 L335 70 L350 70 L350 90 L365 90 L365 130 L400 130 L400 180 Z"
        fill="rgba(0,0,0,0.55)"
      />
      <Path
        d="M0 180 L0 150 L30 150 L30 135 L50 135 L50 150 L80 150 L80 120 L100 120 L100 140 L130 140 L130 125 L155 125 L155 150 L185 150 L185 130 L215 130 L215 150 L245 150 L245 120 L275 120 L275 145 L305 145 L305 130 L335 130 L335 150 L370 150 L370 140 L400 140 L400 180 Z"
        fill="rgba(0,0,0,0.75)"
      />
      {/* random lit windows */}
      {[
        [35, 110], [42, 115], [70, 90], [85, 70], [115, 95], [120, 100],
        [140, 80], [155, 60], [185, 105], [215, 85], [240, 65], [260, 90],
        [285, 95], [325, 100], [340, 80], [355, 95],
      ].map(([x, y], i) => (
        <Rect key={i} x={x} y={y} width={2} height={2} fill="#ffd57a" opacity={0.7} />
      ))}
    </Svg>
  );
}

export default function LockAlertScreen() {
  const colors = useColors();
  const router = useRouter();
  const { incomingRide, acceptRide, rejectRide } = useDriver();
  const [now] = useState(new Date());

  const ride = incomingRide;

  useEffect(() => {
    const t = setTimeout(() => {
      if (incomingRide) {
        rejectRide();
        router.back();
      }
    }, (RING_DURATION + 1) * 1000);
    return () => clearTimeout(t);
  }, []);

  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  function onAccept() {
    acceptRide();
    router.replace("/trip/active");
  }
  function onReject() {
    rejectRide();
    router.back();
  }

  return (
    <View style={styles.container}>
      {/* wallpaper */}
      <LinearGradient
        colors={["#1a2540", "#0d1424", "#040810"]}
        style={StyleSheet.absoluteFill}
      />
      <CitySkyline />
      {/* subtle light halo */}
      <View style={styles.halo} />

      {/* fake status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusBarTime}>{hh}:{mm}</Text>
        <View style={styles.statusBarRight}>
          <Feather name="wifi" size={13} color="#fff" />
          <View style={styles.batteryShell}>
            <View style={styles.batteryFill} />
          </View>
        </View>
      </View>

      {/* lock + carrier */}
      <View style={styles.lockedRow}>
        <View style={styles.lockedBadge}>
          <Feather name="lock" size={11} color="#fff" />
          <Text style={styles.lockedText}>Locked</Text>
        </View>
      </View>

      {/* lock screen clock */}
      <View style={styles.clockBlock}>
        <Text style={styles.clockTime}>
          {hh}:{mm}
        </Text>
        <Text style={styles.clockDate}>{dateStr}</Text>
      </View>

      {/* swipe down hint */}
      <View style={styles.swipeHint}>
        <Feather name="chevron-up" size={14} color="rgba(255,255,255,0.45)" />
        <Text style={styles.swipeHintText}>Swipe up to view</Text>
      </View>

      {/* the alert notification */}
      <View style={styles.alertWrap}>
        <ShakingPulsingCard>
          <View style={styles.alertCard}>
            {/* notification header */}
            <View style={styles.notifHeader}>
              <View style={styles.appIcon}>
                <LinearGradient
                  colors={["#00C853", "#00897B"]}
                  style={StyleSheet.absoluteFill}
                />
                <Feather name="navigation" size={14} color="#fff" />
              </View>
              <Text style={styles.appName}>DRIVER</Text>
              <View style={styles.urgentDot} />
              <Text style={styles.timeAgo}>now</Text>
              <View style={{ flex: 1 }} />
              <View style={styles.urgentBadge}>
                <Feather name="zap" size={9} color="#fff" />
                <Text style={styles.urgentText}>URGENT</Text>
              </View>
            </View>

            {/* title */}
            <Text style={styles.alertTitle}>New ride request</Text>
            <Text style={styles.alertSub}>
              ₹{ride?.fareEstimate ?? 186} · {ride?.pickupDistanceKm ?? 1.2} km away · {Math.max(1, Math.round((ride?.pickupDistanceKm ?? 1.2) * 3))} min to pickup
            </Text>

            {/* countdown bar */}
            <View style={styles.countdownRow}>
              <Text style={styles.countdownLabel}>AUTO-REJECT IN {RING_DURATION}s</Text>
              <CountdownBar seconds={RING_DURATION} />
            </View>

            {/* rider mini card */}
            <View style={styles.riderCard}>
              <View style={styles.riderAvatar}>
                <Text style={styles.riderAvatarText}>{(ride?.passengerName ?? "P")[0]}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.riderNameRow}>
                  <Text style={styles.riderName}>{ride?.passengerName ?? "Priya S."}</Text>
                  <Feather name="star" size={10} color="#FFB300" />
                  <Text style={styles.riderRating}>{(ride?.passengerRating ?? 4.87).toFixed(2)}</Text>
                </View>
                <View style={styles.routeRow}>
                  <View style={[styles.routeDot, { backgroundColor: "#00C853" }]} />
                  <Text style={styles.routeText} numberOfLines={1}>
                    {ride?.pickup ?? "Indiranagar Metro"}
                  </Text>
                </View>
                <View style={styles.routeRow}>
                  <View style={[styles.routeDot, { backgroundColor: "#FF3B30" }]} />
                  <Text style={styles.routeText} numberOfLines={1}>
                    {ride?.drop ?? "Phoenix Marketcity"} · {ride?.distanceKm ?? 8.4} km
                  </Text>
                </View>
              </View>
              <View style={styles.fareBlock}>
                <Text style={styles.fareValue}>₹{ride?.fareEstimate ?? 186}</Text>
                <Text style={styles.fareLabel}>fare</Text>
              </View>
            </View>

            {/* action buttons */}
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={onReject}
                activeOpacity={0.85}
              >
                <Feather name="x" size={20} color="#fff" />
                <Text style={styles.actionText}>Reject</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.acceptBtn]}
                onPress={onAccept}
                activeOpacity={0.85}
              >
                <Feather name="check" size={20} color="#fff" />
                <Text style={styles.actionText}>Accept</Text>
              </TouchableOpacity>
            </View>

            {/* slide hint */}
            <View style={styles.slideHint}>
              <Feather name="chevrons-right" size={12} color="rgba(255,255,255,0.4)" />
              <Text style={styles.slideHintText}>Hold to preview · Swipe for actions</Text>
            </View>
          </View>
        </ShakingPulsingCard>
      </View>

      {/* bottom lock screen footer */}
      <View style={styles.bottomBar}>
        <View style={styles.bottomIconBtn}>
          <Feather name="zap-off" size={16} color="rgba(255,255,255,0.8)" />
        </View>
        <View style={styles.homeIndicator} />
        <View style={styles.bottomIconBtn}>
          <Feather name="camera" size={16} color="rgba(255,255,255,0.8)" />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },

  halo: {
    position: "absolute",
    top: -100,
    left: -50,
    right: -50,
    height: 360,
    borderRadius: 200,
    backgroundColor: "rgba(80,140,200,0.12)",
  },

  statusBar: {
    paddingTop: 14,
    paddingHorizontal: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusBarTime: { color: "#fff", fontSize: 14, fontWeight: "700", letterSpacing: 0.3 },
  statusBarRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  batteryShell: {
    width: 24,
    height: 11,
    borderWidth: 1,
    borderColor: "#fff",
    borderRadius: 3,
    padding: 1,
  },
  batteryFill: { flex: 1, backgroundColor: "#fff", borderRadius: 1 },

  lockedRow: {
    alignItems: "center",
    marginTop: 26,
  },
  lockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(0,0,0,0.4)",
    borderRadius: 14,
  },
  lockedText: { color: "#fff", fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },

  clockBlock: { alignItems: "center", marginTop: 16 },
  clockTime: {
    color: "#fff",
    fontSize: 78,
    fontWeight: "200",
    letterSpacing: -3,
    lineHeight: 86,
  },
  clockDate: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 16,
    fontWeight: "600",
    marginTop: 0,
    letterSpacing: 0.2,
  },

  swipeHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 18,
  },
  swipeHintText: { color: "rgba(255,255,255,0.45)", fontSize: 11, fontWeight: "500" },

  alertWrap: {
    marginTop: 28,
    paddingHorizontal: 12,
  },

  glowOuter: {
    position: "absolute",
    top: -6,
    left: -6,
    right: -6,
    bottom: -6,
    borderRadius: 26,
    backgroundColor: "transparent",
    borderWidth: 3,
    borderColor: "#FF3B30",
    shadowColor: "#FF3B30",
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },

  alertCard: {
    backgroundColor: "rgba(28,28,30,0.92)",
    borderRadius: 22,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  notifHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  appIcon: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  appName: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  urgentDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "rgba(255,255,255,0.5)" },
  timeAgo: { color: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: "600" },
  urgentBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FF3B30",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  urgentText: { color: "#fff", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },

  alertTitle: {
    color: "#fff",
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginTop: 2,
  },
  alertSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: -4,
  },

  countdownRow: { gap: 5, marginTop: 2 },
  countdownLabel: {
    color: "#FF3B30",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  countdownTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  countdownFill: {
    height: "100%",
    backgroundColor: "#FF3B30",
    borderRadius: 2,
  },

  riderCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 10,
    borderRadius: 13,
  },
  riderAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FFB300",
    alignItems: "center",
    justifyContent: "center",
  },
  riderAvatarText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  riderNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  riderName: { color: "#fff", fontSize: 13, fontWeight: "800" },
  riderRating: { color: "rgba(255,255,255,0.7)", fontSize: 10, fontWeight: "700" },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  routeDot: { width: 6, height: 6, borderRadius: 3 },
  routeText: { color: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: "600", flex: 1 },
  fareBlock: { alignItems: "flex-end" },
  fareValue: { color: "#00C853", fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  fareLabel: { color: "rgba(255,255,255,0.5)", fontSize: 9, fontWeight: "700", letterSpacing: 0.4 },

  actionsRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  actionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  rejectBtn: { backgroundColor: "#FF3B30" },
  acceptBtn: {
    backgroundColor: "#00C853",
    shadowColor: "#00C853",
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  slideHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  slideHintText: { color: "rgba(255,255,255,0.4)", fontSize: 10, fontWeight: "600" },

  bottomBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 28,
    paddingTop: 14,
    paddingBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bottomIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  homeIndicator: {
    width: 110,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
});
