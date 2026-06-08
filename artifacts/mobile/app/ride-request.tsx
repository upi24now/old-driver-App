import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { fetchOrderById } from "@/utils/firestore";
import type { OrderDoc } from "@/utils/firestore";
import type { IncomingRide } from "@/contexts/DriverContext";
import { cancelIncomingOrderNotification } from "@/utils/notifications";
import { callSupport } from "@/utils/support";
import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
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
const SCREEN_W = Dimensions.get("window").width;
const CARD_W   = SCREEN_W - 24;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Payment badge colour map
const PAY_BADGE: Record<string, { bg: string; fg: string }> = {
  CASH:   { bg: "#FEF3C7", fg: "#92400E" },
  ONLINE: { bg: "#D1FAE5", fg: "#065F46" },
  COD:    { bg: "#DBEAFE", fg: "#1E40AF" },
};

function UrgencyRing({
  progress,
  seconds,
}: {
  progress: Animated.Value;
  seconds: number;
  urgent: boolean;  // kept in signature for call-site compatibility
}) {
  const colors = useColors();
  // 3-colour urgency: green >10 s, orange 5–10 s, red ≤5 s
  const ringColor =
    seconds <= 5 ? "#DC2626" : seconds <= 10 ? "#D97706" : "#059669";
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
        <Text style={[styles.ringNum, { color: ringColor }]}>{seconds}</Text>
        <Text style={[styles.ringUnit, { color: colors.mutedForeground }]}>sec</Text>
      </View>
    </View>
  );
}

const SLIDE_HEIGHT = 54;
const SLIDE_THUMB  = 46;
const SLIDE_PAD    = 4;

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
    return (
      <View style={[styles.slideTrack, { overflow: "hidden" }]}>
        <LinearGradient
          colors={["#059669", "#047857"]}
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
        <Feather name="chevrons-right" size={22} color="#059669" />
      </Animated.View>
    </View>
  );
}

export default function RideRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { incomingRide, pendingRides, acceptRide, rejectRide, recoverIncomingRide } = useDriver();

  // FCM tap recovery — orderId + order fields forwarded from handleNotificationResponse
  // so the screen can fetch the order from Firestore if incomingRide is not yet set.
  const params = useLocalSearchParams<{
    orderId?:      string;
    nativeAction?: string;  // "accept" | "reject" — set by FullScreenOrderActionReceiver
    customer?:     string;
    pickup?:       string;
    pickupCity?:   string;
    drop?:         string;
    dropCity?:     string;
    earning?:      string;
    distanceKm?:   string;
    durationMin?:  string;
  }>();

  const [fetchedRide,  setFetchedRide]  = useState<IncomingRide | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchFailed,  setFetchFailed]  = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Slider scroll ref — used to programmatically clamp position when a card
  // is removed (accepted/rejected) and the index needs adjusting.
  const scrollRef = useRef<ScrollView>(null);

  // Primary source: pendingRides from DriverContext (ALL simultaneously-dispatched
  // orders for this driver — the real fix for the single-card bug).
  // Fallback: single incomingRide (Firestore listener) or FCM-tap fetchedRide.
  const ride  = incomingRide ?? fetchedRide;
  const rides = pendingRides.length > 0 ? pendingRides : (ride ? [ride] : []);

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

  // Stable player instance for the alert ringtone — created once per screen mount.
  const player = useAudioPlayer(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../assets/ringtone.wav") as Parameters<typeof useAudioPlayer>[0]
  );

  const urgent = seconds <= 5;

  // Prevents the animation/ringtone/timer block from firing more than once
  // (guard needed because we now watch `ride !== null` instead of `[]`).
  const animStartedRef = useRef(false);

  useEffect(() => {
    // No live order yet — either incomingRide is null and fetch hasn't completed,
    // or we're still waiting on the Firestore listener.  Do not start animations.
    if (!ride || animStartedRef.current) return;
    animStartedRef.current = true;

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

    // Ringtone — configure audio mode then start looping immediately.
    // playsInSilentMode: true  — audible even when device ringer is off.
    // shouldPlayInBackground: true — keeps playing if driver backgrounds the app.
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
      allowsRecording: false,
      shouldRouteThroughEarpiece: false,
    })
      .then(() => {
        player.loop = true;
        player.volume = 1.0;
        player.muted = false;
        player.play();
      })
      .catch(() => {});

    // Continuous vibration: 1200ms on, 200ms off, repeating for full alert duration.
    Vibration.vibrate([0, 1200, 200, 1200, 200, 1200, 500], true);

    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      clearInterval(t);
      try { player.pause(); } catch {}
      Vibration.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride !== null]);   // fires once when ride transitions null → non-null

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
  // Prevents the native-action useEffect from re-firing on re-renders once
  // the action has been dispatched.
  const nativeActionFiredRef = useRef(false);

  // null-on-mount guard: dismiss immediately when there is no live order AND no
  // orderId param to fetch.  If params.orderId is present we skip this — the
  // fetch effect below will either deliver the order or dismiss on failure.
  useEffect(() => {
    if (params.orderId) return;
    if (!incomingRide && !hadRideRef.current && !didAcceptRef.current) {
      dismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Watch both incomingRide (Firestore listener) and fetchedRide (FCM tap fetch)
  // so dismiss fires correctly whichever source delivers the order.
  // Guard: do NOT dismiss if pendingRides still has cards — the driver is viewing
  // remaining orders. Only dismiss once all pending cards are gone.
  useEffect(() => {
    if (ride !== null) { hadRideRef.current = true; return; }
    if (didAcceptRef.current) return;
    if (pendingRides.length > 0) return;
    if (hadRideRef.current) dismiss();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRide, fetchedRide, pendingRides.length]);

  // ─── Local OrderDoc → IncomingRide mapping (mirrors DriverContext.orderDocToRide)
  function orderDocToIncomingRide(order: OrderDoc): IncomingRide {
    return {
      id:               order.id,
      pickup:           order.pickup,
      pickupSub:        order.pickupSub         ?? "",
      pickupCity:       order.pickupCity,
      drop:             order.drop,
      dropSub:          order.dropSub           ?? "",
      dropCity:         order.dropCity,
      distanceKm:       order.distanceKm        ?? 0,
      pickupDistanceKm: order.pickupDistanceKm  ?? 0,
      durationMin:      order.durationMin       ?? 0,
      fareEstimate:     order.fareEstimate      ?? 0,
      paymentMode:      order.paymentMode,
      surge:            order.surge             ?? false,
      surgeMultiplier:  order.surgeMultiplier   ?? 1,
      passengerName:    order.customerName    ?? "Customer",
      customerPhone:    order.customerPhone   ?? "",
      passengerRating:  order.customerRating  ?? 5,
      parcelType:       order.parcelType      ?? "Parcel",
      parcelEmoji:      order.parcelEmoji     ?? "📦",
      parcelWeight:     order.parcelWeight    ?? "Package",
    };
  }

  // FCM tap recovery: fetch the order from Firestore when the screen was opened
  // from a notification tap and the Firestore listener hasn't delivered incomingRide
  // yet (backgrounded or killed app).  Once fetched, injects into DriverContext via
  // recoverIncomingRide so acceptRide() / rejectRide() work normally.
  useEffect(() => {
    if (incomingRide) return;            // listener already delivered the ride
    if (!params.orderId) return;         // no orderId from notification tap
    if (fetchedRide || fetchLoading) return; // already in progress or done

    let cancelled = false;
    setFetchLoading(true);

    fetchOrderById(params.orderId)
      .then((order) => {
        if (cancelled) return;
        if (!order || order.status !== "dispatched") {
          setFetchFailed(true);
          setFetchLoading(false);
          return;
        }
        const recovered = orderDocToIncomingRide(order);
        setFetchedRide(recovered);
        recoverIncomingRide(recovered); // inject into context so acceptRide() works
        setFetchLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFetchFailed(true);
        setFetchLoading(false);
      });

    return () => { cancelled = true; };
  // Re-evaluates if the Firestore listener delivers incomingRide first — in that
  // case incomingRide is non-null and the effect exits immediately.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingRide]);

  // ── Native action recovery ─────────────────────────────────────────────────
  // When the screen is opened via deep link from FullScreenOrderActionReceiver
  // (lock-screen Accept / Reject button tap), params.nativeAction is "accept"
  // or "reject". Execute once the ride is available — Firestore listener or
  // the FCM tap recovery fetch above will set it before this fires.
  useEffect(() => {
    if (!params.nativeAction) return;
    if (nativeActionFiredRef.current) return;
    if (!ride) return; // wait: Firestore or fetch hasn't delivered the order yet
    nativeActionFiredRef.current = true;
    if (params.nativeAction === "accept") {
      void handleAccept();
    } else if (params.nativeAction === "reject") {
      handleReject();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ride, params.nativeAction]);

  // Auto-dismiss after a brief pause when the order is no longer available.
  useEffect(() => {
    if (!fetchFailed) return;
    const t = setTimeout(() => dismiss(), 2500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFailed]);

  // When pendingRides changes (a card was accepted or rejected and Firestore
  // removed it), clamp the index and sync incomingRide to the newly focused card
  // so acceptRide() always acts on whatever card is currently shown.
  const pendingRidesKey = pendingRides.map((r) => r.id).join(",");
  useEffect(() => {
    if (pendingRides.length === 0) return;
    const clamped = Math.min(currentIndex, pendingRides.length - 1);
    if (clamped !== currentIndex) {
      setCurrentIndex(clamped);
      scrollRef.current?.scrollTo({ x: clamped * SCREEN_W, animated: true });
    }
    // Sync incomingRide only when no accept is in flight (didAcceptRef guards
    // against resetting it while the transaction is still awaiting).
    if (!didAcceptRef.current) {
      recoverIncomingRide(pendingRides[clamped]!);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRidesKey]);

  // Stop ringtone + vibration immediately on any exit path.
  function stopAlert() {
    try { player.pause(); } catch {}
    Vibration.cancel();
  }

  function handleReject() {
    // Ignore reject tap if accept transaction is already in flight.
    if (didAcceptRef.current) return;
    // Capture count BEFORE the async rejectRide() state update so we can decide
    // whether to dismiss — if >1 card is pending, the screen stays open for the rest.
    const moreCardsRemain = pendingRides.length > 1;
    stopAlert();
    Vibration.vibrate(40); // short haptic feedback for the reject gesture
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
      // Only dismiss when no more cards remain — the pendingRides useEffect above
      // will clamp the index and sync incomingRide to the next card automatically.
      if (!moreCardsRemain) dismiss();
      else {
        // Reset shake / fill animation so the button is ready for the next card.
        rejectFill.setValue(0);
      }
    });
  }

  function dismiss(replaceRoute?: string) {
    stopAlert();
    cancelIncomingOrderNotification().catch(() => {});
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
    // The viewed card may not be incomingRide if the driver swiped.
    // recoverIncomingRide was called on every scroll-end, so incomingRide should
    // already reflect the viewed card. But use rides[currentIndex] as the
    // navigation source so we always route to the correct order's delivery screen.
    const viewedRide = rides[currentIndex] ?? incomingRide ?? fetchedRide;
    const ride = viewedRide;
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

    // Transaction succeeded — stop alert then animate dismiss to active-delivery.
    stopAlert();
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

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.root}>
      {/* Backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          { opacity: backdrop.interpolate({ inputRange: [0, 1], outputRange: [0, 0.7] }) },
        ]}
      >
        <Pressable style={{ flex: 1 }} />
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.sheetWrap,
          {
            paddingBottom: insets.bottom + 12,
            transform: [{ translateY: cardTranslate }],
          },
        ]}
      >
        {/* ── Loading state ── */}
        {fetchLoading && !ride && (
          <View style={styles.fetchStateBox}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.fetchStateText, { color: colors.mutedForeground }]}>
              Loading order…
            </Text>
          </View>
        )}

        {/* ── Error state ── */}
        {fetchFailed && !ride && (
          <View style={styles.fetchStateBox}>
            <Text style={[styles.fetchStateHeading, { color: colors.error }]}>
              Order unavailable
            </Text>
            <Text style={[styles.fetchStateText, { color: colors.mutedForeground }]}>
              This order is no longer available.
            </Text>
          </View>
        )}

        {/* ── Slider ── */}
        {rides.length > 0 && (
          <>
            {/* Pulsing glow halo */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.glow,
                {
                  backgroundColor: urgent ? "#DC2626" : colors.primary,
                  opacity: pulseOpacity,
                  transform: [{ scale: pulseScale }],
                },
              ]}
            />

            {/* Pagination row — always shown when at least one card is present */}
            <View style={styles.paginationRow}>
              {rides.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.paginationDot,
                    i === currentIndex && styles.paginationDotActive,
                  ]}
                />
              ))}
              <Text style={[styles.paginationCount, { color: colors.mutedForeground }]}>
                {currentIndex + 1} / {rides.length}
              </Text>
            </View>

            {/* Horizontal swipe slider */}
            <ScrollView
              ref={scrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              scrollEventThrottle={16}
              style={styles.slider}
              onMomentumScrollEnd={(e) => {
                const newIdx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
                setCurrentIndex(newIdx);
                // Sync incomingRide to the newly visible card so acceptRide()
                // (which reads incomingRide internally) acts on the correct order.
                const viewed = rides[newIdx];
                if (viewed) recoverIncomingRide(viewed);
              }}
            >
              {rides.map((r, idx) => {
                const payKey  = (r.paymentMode ?? "").toUpperCase();
                const payBadge = PAY_BADGE[payKey] ?? { bg: "#F3F4F6", fg: "#374151" };

                return (
                  <Animated.View
                    key={r.id ?? idx}
                    style={[
                      styles.card,
                      {
                        borderColor: urgent ? "#DC2626" : colors.primary,
                        transform: [{ scale: pulseScale }],
                      },
                    ]}
                  >
                    {/* ── HEADER ── */}
                    <View style={styles.header}>
                      <View style={styles.headerLeft}>
                        {/* Urgency badge */}
                        <View
                          style={[
                            styles.liveBadge,
                            { backgroundColor: urgent ? "#FEE2E2" : "#f0fdf4" },
                          ]}
                        >
                          <View
                            style={[
                              styles.liveBadgeDot,
                              { backgroundColor: urgent ? "#DC2626" : "#059669" },
                            ]}
                          />
                          <Text
                            style={[
                              styles.liveBadgeText,
                              { color: urgent ? "#DC2626" : "#059669" },
                            ]}
                          >
                            {urgent ? "HURRY!" : "NEW ORDER"}
                          </Text>
                        </View>
                        {/* Parcel info */}
                        {(r.parcelType || r.parcelEmoji) ? (
                          <Text
                            style={[styles.parcelType, { color: colors.mutedForeground }]}
                            numberOfLines={1}
                          >
                            {r.parcelEmoji} {r.parcelType}
                          </Text>
                        ) : null}
                      </View>

                      {/* Help + timer */}
                      <View style={styles.headerRight}>
                        <TouchableOpacity
                          onPress={callSupport}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Feather name="help-circle" size={16} color="rgba(0,0,0,0.3)" />
                        </TouchableOpacity>
                        <UrgencyRing progress={ring} seconds={seconds} urgent={urgent} />
                      </View>
                    </View>

                    {/* ── ROUTE ── */}
                    <View style={[styles.route, { borderColor: colors.border }]}>
                      <View style={styles.routeIcons}>
                        <View style={[styles.routeDot, { backgroundColor: "#059669" }]} />
                        <View style={styles.dotLine}>
                          {Array.from({ length: 4 }).map((_, i) => (
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
                            PICKUP
                            {r.pickupDistanceKm ? ` · ${r.pickupDistanceKm} km away` : ""}
                          </Text>
                          <Text
                            style={[styles.routeAddr, { color: colors.foreground }]}
                            numberOfLines={2}
                          >
                            {r.pickup}
                          </Text>
                          {r.pickupSub ? (
                            <Text
                              style={[styles.routeSub, { color: colors.mutedForeground }]}
                              numberOfLines={1}
                            >
                              {r.pickupSub}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.routePoint}>
                          <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>
                            DROP
                          </Text>
                          <Text
                            style={[styles.routeAddr, { color: colors.foreground }]}
                            numberOfLines={2}
                          >
                            {r.drop}
                          </Text>
                          {r.dropSub ? (
                            <Text
                              style={[styles.routeSub, { color: colors.mutedForeground }]}
                              numberOfLines={1}
                            >
                              {r.dropSub}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    </View>

                    {/* ── EARNINGS HERO ── */}
                    <LinearGradient
                      colors={["#059669", "#10B981"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.earningsHero}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={styles.earningsAmountRow}>
                          <Text style={styles.earningsCurrency}>₹</Text>
                          <Text style={styles.earningsAmount}>{r.fareEstimate}</Text>
                          {r.surge ? (
                            <View style={styles.surgeBadge}>
                              <Feather name="zap" size={10} color="#fff" />
                              <Text style={styles.surgeText}>
                                {r.surgeMultiplier ?? 1}×
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.earningsLabel}>Estimated Earnings</Text>
                        <Text style={styles.earningsMeta}>
                          {r.distanceKm} km
                          {r.durationMin ? ` • ${r.durationMin} min` : ""}
                        </Text>
                      </View>

                      {/* Payment badge */}
                      <View style={[styles.payBadge, { backgroundColor: payBadge.bg }]}>
                        <Text style={[styles.payBadgeText, { color: payBadge.fg }]}>
                          {payKey || "CASH"}
                        </Text>
                      </View>
                    </LinearGradient>

                    {/* ── ACTIONS ── */}
                    <View style={styles.actions}>
                      {/* Reject — secondary */}
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
                                backgroundColor: "#DC2626",
                                opacity: rejectFill.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0, 0.14],
                                }),
                              },
                            ]}
                          />
                          <Feather name="x" size={18} color={colors.foreground} />
                          <Text style={[styles.rejectText, { color: colors.foreground }]}>
                            Reject
                          </Text>
                        </TouchableOpacity>
                      </Animated.View>

                      {/* Slide to Accept — primary, wider */}
                      <View style={{ flex: 2.5 }}>
                        <SlideToAccept onAccept={handleAccept} disabled={isAccepting} />
                      </View>
                    </View>
                  </Animated.View>
                );
              })}
            </ScrollView>
          </>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root:    { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  sheetWrap: {
    // No horizontal padding — the slider is full-bleed; cards carry their own margin
  },
  glow: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    bottom: 0,
    borderRadius: 24,
  },

  // ── Pagination ──────────────────────────────────────────────────────────────
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#D1D5DB",
  },
  paginationDotActive: {
    width: 18,
    borderRadius: 3,
    backgroundColor: "#059669",
  },
  paginationCount: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginLeft: 4,
  },

  // ── Slider / card ───────────────────────────────────────────────────────────
  slider: {
    // Full screen width — each page = SCREEN_W, card = CARD_W with 12px side margins
  },
  card: {
    width: CARD_W,
    marginHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 22,
    padding: 10,
    gap: 8,
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  headerLeft: { flex: 1, gap: 4 },
  headerRight: { alignItems: "center", gap: 6 },

  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  liveBadgeDot:  { width: 6, height: 6, borderRadius: 3 },
  liveBadgeText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.6 },
  parcelType:    { fontSize: 12, fontWeight: "600" },

  // ── Ring ────────────────────────────────────────────────────────────────────
  ringWrap: { alignItems: "center", justifyContent: "center" },
  ringCenter: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  ringNum:  { fontSize: 18, fontWeight: "800", lineHeight: 20 },
  ringUnit: { fontSize: 8,  fontWeight: "700", letterSpacing: 0.6 },

  // ── Route ───────────────────────────────────────────────────────────────────
  route: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 2,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  routeIcons:  { alignItems: "center", paddingTop: 4, gap: 3 },
  routeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#059669",
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  routeSquare: { width: 10, height: 10, borderRadius: 2 },
  dotLine:     { gap: 3, paddingVertical: 2, alignItems: "center" },
  dotLineDot:  { width: 2, height: 2, borderRadius: 1 },
  routePoints: { flex: 1, gap: 8 },
  routePoint:  { gap: 1 },
  routeLabel:  { fontSize: 9,  fontWeight: "700", letterSpacing: 0.4 },
  routeAddr:   { fontSize: 13, fontWeight: "700", lineHeight: 18 },
  routeSub:    { fontSize: 11, fontWeight: "500" },

  // ── Earnings hero ───────────────────────────────────────────────────────────
  earningsHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
  },
  earningsAmountRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  earningsCurrency: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 3,
  },
  earningsAmount: {
    fontSize: 42,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -2,
    lineHeight: 44,
  },
  earningsLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 2,
  },
  earningsMeta: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.9)",
    marginTop: 3,
    letterSpacing: 0.1,
  },
  surgeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "#D97706",
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 7,
    marginLeft: 6,
    marginBottom: 4,
  },
  surgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },

  // ── Payment badge — rendered inside the earnings hero gradient ──────────────
  payBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  payBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: "#fff",
  },

  // ── Actions ─────────────────────────────────────────────────────────────────
  actions:   { flexDirection: "row", gap: 10 },
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

  // ── Slide to accept ─────────────────────────────────────────────────────────
  slideTrack: {
    height: SLIDE_HEIGHT,
    borderRadius: 16,
    backgroundColor: "#D1FAE5",
    borderWidth: 1.5,
    borderColor: "#059669",
    overflow: "hidden",
    justifyContent: "center",
  },
  slideLabel: {
    position: "absolute",
    alignSelf: "center",
    color: "#059669",
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

  // ── Fetch state ─────────────────────────────────────────────────────────────
  fetchStateBox: {
    marginHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: "#fff",
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "#eaeaea",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fetchStateHeading: { fontSize: 16, fontWeight: "700" },
  fetchStateText:    { fontSize: 13, fontWeight: "500", marginTop: 10, textAlign: "center" },
});
