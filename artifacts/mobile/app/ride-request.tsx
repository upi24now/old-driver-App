import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { callSupport } from "@/utils/support";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Linking,
  PanResponder,
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

const SLIDE_HEIGHT = 54;
const SLIDE_THUMB = 46;
const SLIDE_PAD = 4;

function SlideToAccept({ onAccept, disabled = false }: { onAccept: () => void; disabled?: boolean }) {
  const [trackW, setTrackW] = useState(220);
  const x = useRef(new Animated.Value(0)).current;
  const xValue = useRef(0);
  const done = useRef(false);
  const maxX = Math.max(0, trackW - SLIDE_THUMB - SLIDE_PAD * 2);

  useEffect(() => {
    const id = x.addListener(({ value }) => {
      xValue.current = value;
    });
    return () => x.removeListener(id);
  }, [x]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
      onPanResponderGrant: () => {
        x.stopAnimation((v) => {
          xValue.current = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        if (done.current) return;
        const next = Math.max(0, Math.min(maxX, xValue.current + g.dx));
        x.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        if (done.current) return;
        const final = Math.max(0, Math.min(maxX, xValue.current + g.dx));
        if (final >= maxX * 0.85) {
          done.current = true;
          Animated.timing(x, {
            toValue: maxX,
            duration: 120,
            useNativeDriver: true,
          }).start(() => onAccept());
        } else {
          Animated.spring(x, {
            toValue: 0,
            friction: 6,
            tension: 80,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        if (done.current) return;
        Animated.spring(x, {
          toValue: 0,
          friction: 6,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const labelOpacity = x.interpolate({
    inputRange: [0, maxX || 1],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });
  const fillWidth = x.interpolate({
    inputRange: [0, maxX || 1],
    outputRange: [SLIDE_THUMB + SLIDE_PAD * 2, trackW],
    extrapolate: "clamp",
  });

  if (disabled) {
    // Accepting in-flight — fill the track green and show a spinner.
    return (
      <View style={[styles.slideTrack, { overflow: "hidden" }]}>
        <LinearGradient
          colors={["#00E060", "#00A847"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
        <Text style={[styles.slideLabel, { color: "#fff", opacity: 1 }]}>
          Accepting…
        </Text>
      </View>
    );
  }

  return (
    <View
      style={styles.slideTrack}
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFillObject,
          { borderRadius: 16, overflow: "hidden", width: fillWidth },
        ]}
      >
        <LinearGradient
          colors={["#00E060", "#00A847"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <Animated.Text style={[styles.slideLabel, { opacity: labelOpacity }]}>
        Slide to Accept  →
      </Animated.Text>
      <Animated.View
        {...pan.panHandlers}
        style={[
          styles.slideThumb,
          { transform: [{ translateX: x }] },
        ]}
      >
        <Feather name="chevrons-right" size={22} color="#00A847" />
      </Animated.View>
    </View>
  );
}

export default function RideRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { incomingRide, acceptRide, rejectRide } = useDriver();

  // No fallback — ride-request must only render with a real live order.
  // When incomingRide is null (stale nav, cold-start before context hydrates)
  // the null-on-mount guard below dismisses the screen immediately.
  const ride = incomingRide;
  const riderInitials = ride
    ? (ride.passengerName || "Customer")
        .split(" ")
        .map((s) => s[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : "";

  const [seconds, setSeconds] = useState(TIMER_SECONDS);
  const [isAccepting, setIsAccepting] = useState(false);
  const slide = useRef(new Animated.Value(0)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const acceptScale = useRef(new Animated.Value(1)).current;
  const rejectScale = useRef(new Animated.Value(1)).current;
  const rejectShake = useRef(new Animated.Value(0)).current;
  const rejectFill = useRef(new Animated.Value(0)).current;

  const urgent = seconds <= 5;

  useEffect(() => {
    // No live order on mount — the null-on-mount guard will dismiss this screen.
    // Do not start animations, timer, or vibration; they serve no purpose and
    // the dismiss path runs immediately without them.
    if (!incomingRide) return;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Block Android hardware back — only Accept, Reject, timeout, or external
  // cancellation may exit this screen.  Returning true tells the OS the press
  // was handled so the default navigation-back action is suppressed.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, []);

  // auto-dismiss when timer hits zero (auto-reject)
  useEffect(() => {
    if (seconds === 0) {
      Vibration.vibrate(80);
      setTimeout(() => {
        // If the driver pressed Accept just before the timer fired, the accept
        // transaction is already in flight (didAcceptRef.current === true).
        // Do not call rejectRide() — the safe rejectOrder transaction would
        // still no-op in Firestore, but skipping it here avoids any UI race.
        // Also skip dismiss() so the accept path can handle its own navigation.
        if (didAcceptRef.current) return;
        rejectRide();
        dismiss();
      }, 600);
    }
  }, [seconds]);

  // Auto-dismiss if the order is cancelled before the driver accepts.
  // listenToDispatchedOrder sets incomingRide → null when the order disappears
  // from the dispatched query (status changed externally). Only dismiss if we
  // actually had a ride to avoid triggering on initial mount.
  //
  // didAcceptRef guards against a race: acceptRide() sets incomingRide → null
  // synchronously, which would also trigger this dismiss — navigating back to
  // the dashboard instead of forward to active-delivery. Skip dismiss when the
  // driver has already accepted.
  const hadRideRef    = useRef(incomingRide !== null);
  const didAcceptRef  = useRef(false);

  // null-on-mount guard: if the screen is opened with no live order (e.g. stale
  // navigation stack, cold-start notification tap before DriverContext hydrates,
  // or any deep-link path) dismiss immediately so the driver never sees a blank
  // or fake order card.  hadRideRef starts false here, so the existing
  // incomingRide→null watcher below does NOT overlap (it only fires when
  // hadRideRef.current is true — i.e. a real order was shown first).
  useEffect(() => {
    if (!incomingRide && !hadRideRef.current && !didAcceptRef.current) {
      dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (incomingRide !== null) { hadRideRef.current = true; return; }
    if (didAcceptRef.current) return;   // driver accepted — handleAccept handles nav
    if (hadRideRef.current) dismiss();
  }, [incomingRide]);

  function handleReject() {
    // Ignore reject tap if accept transaction is already in flight.
    if (didAcceptRef.current) return;
    Vibration.vibrate(40);
    Animated.parallel([
      Animated.sequence([
        Animated.timing(rejectShake, { toValue: 1, duration: 50, useNativeDriver: true }),
        Animated.timing(rejectShake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(rejectShake, { toValue: 0.6, duration: 50, useNativeDriver: true }),
        Animated.timing(rejectShake, { toValue: 0, duration: 50, useNativeDriver: true }),
      ]),
      Animated.timing(rejectFill, {
        toValue: 1,
        duration: 220,
        useNativeDriver: false,
      }),
      Animated.sequence([
        Animated.spring(rejectScale, { toValue: 0.94, friction: 5, useNativeDriver: true }),
        Animated.spring(rejectScale, { toValue: 1, friction: 4, useNativeDriver: true }),
      ]),
    ]).start(() => {
      rejectRide();
      dismiss();
    });
  }

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

  async function handleAccept() {
    Vibration.vibrate(50);
    const ride = incomingRide;
    if (!ride) return;

    // Show accepting spinner immediately so the driver gets visual feedback.
    setIsAccepting(true);

    // Arm the ref BEFORE awaiting the transaction so the hadRideRef useEffect
    // (which fires when incomingRide → null) does not call dismiss() to the
    // dashboard while we are still waiting for Firestore.
    didAcceptRef.current = true;

    // Atomic Firestore transaction — wait for the result before navigating.
    // acceptRide() sets incomingRide to null internally whether it succeeds or fails.
    const result = await acceptRide();

    if (!result.ok) {
      // Transaction failed — another driver claimed the order, it was reassigned,
      // or it was cancelled before we could accept.
      // Reset the arm flag so the hadRideRef useEffect can dismiss normally.
      didAcceptRef.current = false;
      setIsAccepting(false);
      Alert.alert(
        "Order Unavailable",
        "This order was already accepted or is no longer available.",
        [{ text: "OK" }],
        { cancelable: true },
      );
      // dismiss() with no arg navigates back / to dashboard.
      dismiss();
      return;
    }

    // Transaction succeeded — animate dismiss then navigate to active-delivery.
    Animated.parallel([
      Animated.timing(backdrop, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slide,    { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(() => {
      router.replace({
        pathname: "/active-delivery",
        params: {
          orderId:         ride.id,
          customer:        ride.passengerName,
          phone:           ride.customerPhone,
          parcelType:      ride.parcelType,
          parcelEmoji:     ride.parcelEmoji,
          pickup:          ride.pickup,
          pickupCity:      ride.pickupCity,
          drop:            ride.drop,
          dropCity:        ride.dropCity,
          distanceKm:      String(ride.distanceKm),
          durationMin:     String(ride.durationMin),
          earning:         String(ride.fareEstimate),
          weight:          ride.parcelWeight,
          paymentMode:     ride.paymentMode,
          surge:           String(ride.surge        ?? false),
          surgeMultiplier: String(ride.surgeMultiplier ?? 1),
        },
      });
    });
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
        {/* Backdrop is intentionally non-interactive — back/dismiss is locked
            for the duration of the timer. Only Accept, Reject, timeout, or
            external order cancellation can exit this screen. */}
        <Pressable style={{ flex: 1 }} />
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
        {/* Order card — only rendered when a live order exists.
            When incomingRide is null the null-on-mount guard dismisses the
            screen; the sheetWrap stays empty so nothing fake is ever shown. */}
        {ride && (<>
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
              {(ride.parcelType || ride.parcelWeight) && (
                <Text style={[styles.tripType, { color: colors.foreground }]}>
                  {[ride.parcelType, ride.parcelWeight].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
            <View style={{ alignItems: "center", gap: 6 }}>
              <TouchableOpacity onPress={callSupport} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Feather name="help-circle" size={16} color="rgba(0,0,0,0.35)" />
              </TouchableOpacity>
              <UrgencyRing progress={ring} seconds={seconds} urgent={urgent} />
            </View>
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
                  {Number(ride.passengerRating ?? 5).toFixed(2)}
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
              onPress={() => {
                if (!ride.customerPhone) return;
                Linking.openURL(`tel:${ride.customerPhone}`).catch(() => {});
              }}
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
                  DROP · {ride.distanceKm} km{ride.durationMin ? ` · ~${ride.durationMin} min` : ""}
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
                {ride.surge && (
                  <View style={styles.surgeBadge}>
                    <Feather name="zap" size={10} color="#fff" />
                    <Text style={styles.surgeText}>{ride.surgeMultiplier ?? 1}×</Text>
                  </View>
                )}
              </View>
              {ride.paymentMode ? (
                <Text style={[styles.fareSub, { color: colors.mutedForeground }]}>
                  {ride.paymentMode} accepted
                </Text>
              ) : null}
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
            <Animated.View
              style={{
                flex: 1,
                transform: [
                  { scale: rejectScale },
                  {
                    translateX: rejectShake.interpolate({
                      inputRange: [-1, 0, 1],
                      outputRange: [-6, 0, 6],
                    }),
                  },
                ],
              }}
            >
              <TouchableOpacity
                style={[styles.rejectBtn, { borderColor: colors.border }]}
                onPress={handleReject}
                activeOpacity={0.7}
              >
                <Animated.View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFillObject,
                    {
                      backgroundColor: "#FF3B30",
                      opacity: rejectFill.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 0.14],
                      }),
                    },
                  ]}
                />
                <Animated.View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <Feather
                    name="x"
                    size={18}
                    color={colors.foreground}
                  />
                  <Text style={[styles.rejectText, { color: colors.foreground }]}>
                    Reject
                  </Text>
                </Animated.View>
              </TouchableOpacity>
            </Animated.View>

            <View style={{ flex: 2 }}>
              <SlideToAccept onAccept={handleAccept} disabled={isAccepting} />
            </View>
          </View>
        </Animated.View>
        </>)}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 54,
    borderRadius: 16,
    borderWidth: 1.5,
    backgroundColor: "#fff",
    overflow: "hidden",
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

  slideTrack: {
    height: SLIDE_HEIGHT,
    borderRadius: 16,
    backgroundColor: "#E8F5E9",
    borderWidth: 1.5,
    borderColor: "#00C853",
    overflow: "hidden",
    justifyContent: "center",
  },
  slideLabel: {
    position: "absolute",
    alignSelf: "center",
    color: "#00A847",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  slideThumb: {
    position: "absolute",
    left: SLIDE_PAD,
    width: SLIDE_THUMB,
    height: SLIDE_THUMB,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },
});
