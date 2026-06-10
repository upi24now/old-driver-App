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
const RING_SIZE   = 60;
const RING_STROKE = 5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC   = 2 * Math.PI * RING_RADIUS;
const SCREEN_W = Dimensions.get("window").width;
const CARD_W   = SCREEN_W - 24;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Colour palette
const MANGO      = "#F59E0B";   // earnings gradient start
const MANGO_DARK = "#F97316";   // earnings gradient end
const GREEN      = "#22C55E";   // accept slider start
const GREEN_DARK = "#16A34A";   // accept slider end
const RED        = "#EF4444";   // reject gradient start
const RED_DARK   = "#DC2626";   // reject gradient end

function UrgencyRing({
  progress,
  seconds,
}: {
  progress: Animated.Value;
  seconds: number;
  urgent: boolean;  // kept in signature for call-site compatibility
}) {
  // With 5-second total timer: mango throughout, red only at last second
  const ringColor = seconds <= 1 ? RED_DARK : MANGO_DARK;
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
          stroke="#F3F4F6"
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
        <Text style={[styles.ringUnit, { color: "#9CA3AF" }]}>sec</Text>
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
          colors={[GREEN, GREEN_DARK]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
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
      {/* Green gradient fills the full track */}
      <LinearGradient
        colors={[GREEN, GREEN_DARK]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Animated.Text style={[styles.slideLabel, { opacity: labelOpacity }]}>
        Slide to Accept  {">>"}
      </Animated.Text>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.slideThumb, { transform: [{ translateX: x }] }]}
      >
        <Feather name="chevrons-right" size={22} color={GREEN_DARK} />
      </Animated.View>
    </View>
  );
}

export default function RideRequestScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { driverUid, incomingRide, pendingRides, acceptRide, rejectRide, timeoutRide, recoverIncomingRide } = useDriver();

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
    require("../assets/old_telephone_ring.mp3") as Parameters<typeof useAudioPlayer>[0]
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

  // auto-dismiss when timer hits zero (timeout — NOT an explicit rejection)
  useEffect(() => {
    if (seconds === 0) {
      Vibration.vibrate(80);
      setTimeout(() => {
        // If the driver pressed Accept just before the timer fired, the accept
        // transaction is already in flight — skip to avoid any UI race.
        if (didAcceptRef.current) return;
        // Use timeoutRide (not rejectRide) so the driver is NOT added to
        // rejectedBy and may receive the same order again in the next cycle.
        timeoutRide();
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
  // Keep in sync with DriverContext.orderDocToRide whenever fallback fields change.
  function orderDocToIncomingRide(order: OrderDoc): IncomingRide {
    // Address fallbacks — customer app may write pickupAddress / deliveryAddress.
    const pickup = (typeof order.pickup === "string" && order.pickup.trim()
      ? order.pickup.trim()
      : typeof order.pickupAddress === "string" && order.pickupAddress.trim()
        ? order.pickupAddress.trim()
        : "");
    const drop = (typeof order.drop === "string" && order.drop.trim()
      ? order.drop.trim()
      : typeof order.deliveryAddress === "string" && order.deliveryAddress.trim()
        ? order.deliveryAddress.trim()
        : typeof order.dropAddress === "string" && order.dropAddress.trim()
          ? order.dropAddress.trim()
          : "");

    // Fare fallbacks — customer app may use totalAmount, price, amount, deliveryFee.
    const toNum = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : undefined);
    const fareEstimate =
      toNum(order.fareEstimate) ??
      toNum(order.totalAmount)  ??
      toNum(order.price)        ??
      toNum(order.amount)       ??
      toNum(order.deliveryFee)  ??
      0;

    return {
      id:               order.id,
      pickup,
      pickupSub:        order.pickupSub         ?? "",
      pickupCity:       order.pickupCity,
      drop,
      dropSub:          order.dropSub           ?? "",
      dropCity:         order.dropCity,
      distanceKm:       order.distanceKm        ?? 0,
      pickupDistanceKm: order.pickupDistanceKm  ?? 0,
      durationMin:      order.durationMin       ?? 0,
      fareEstimate,
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
        // Phase 2: order is valid if this driver is still in the offer list.
        // (Phase 1 used status==="dispatched"; that field is no longer set.)
        const inOffer = order != null && driverUid != null &&
          (order.activeOfferDriverUids ?? []).includes(driverUid);
        if (!inOffer) {
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

            {/* Counter pill — dark pill above dots */}
            <View style={styles.counterPill}>
              <Text style={styles.counterText}>{currentIndex + 1} / {rides.length}</Text>
            </View>

            {/* Pagination dots — always shown */}
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
                const payKey = (r.paymentMode ?? "CASH").toUpperCase();

                return (
                  <Animated.View
                    key={r.id ?? idx}
                    style={[styles.card, { transform: [{ scale: pulseScale }] }]}
                  >
                    {/* ── HEADER: badges + timer ── */}
                    <View style={styles.header}>
                      <View style={styles.headerBadges}>
                        <View style={styles.newOrderBadge}>
                          <View style={styles.newOrderDot} />
                          <Text style={styles.newOrderText}>NEW ORDER</Text>
                        </View>
                        {urgent && (
                          <View style={styles.hurryBadge}>
                            <Feather name="zap" size={10} color="#fff" />
                            <Text style={styles.hurryText}>HURRY!</Text>
                          </View>
                        )}
                      </View>
                      <View style={styles.headerRight}>
                        <TouchableOpacity
                          onPress={callSupport}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Feather name="help-circle" size={16} color="rgba(0,0,0,0.25)" />
                        </TouchableOpacity>
                        <UrgencyRing progress={ring} seconds={seconds} urgent={urgent} />
                      </View>
                    </View>

                    {/* ── PICKUP block — light green bg ── */}
                    <View style={styles.pickupBlock}>
                      <View style={styles.locationIconWrapGreen}>
                        <Feather name="map-pin" size={14} color={GREEN_DARK} />
                      </View>
                      <View style={styles.locationContent}>
                        <Text style={styles.pickupLabel}>PICKUP</Text>
                        <Text style={styles.locationAddr} numberOfLines={2}>
                          {r.pickup}
                        </Text>
                      </View>
                      {r.pickupDistanceKm ? (
                        <View style={styles.kmPillGreen}>
                          <Text style={styles.kmPillGreenText}>{r.pickupDistanceKm} km</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* ── DROP block — light red bg ── */}
                    <View style={styles.dropBlock}>
                      <View style={styles.locationIconWrapRed}>
                        <Feather name="map-pin" size={14} color={RED_DARK} />
                      </View>
                      <View style={styles.locationContent}>
                        <Text style={styles.dropLabel}>DROP</Text>
                        <Text style={styles.locationAddr} numberOfLines={2}>
                          {r.drop}
                        </Text>
                      </View>
                      <View style={styles.kmPillRed}>
                        <Text style={styles.kmPillRedText}>{r.distanceKm} km</Text>
                      </View>
                    </View>

                    {/* ── EARNINGS HERO — mango gradient, strongest element ── */}
                    <LinearGradient
                      colors={[MANGO, MANGO_DARK]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.earningsHero}
                    >
                      <View style={styles.earningsLeft}>
                        <View style={styles.earningsAmountRow}>
                          <Text style={styles.earningsCurrency}>₹</Text>
                          <Text style={styles.earningsAmount}>{r.fareEstimate}</Text>
                          {r.surge ? (
                            <View style={styles.surgeBadge}>
                              <Feather name="zap" size={9} color="#fff" />
                              <Text style={styles.surgeText}>{r.surgeMultiplier ?? 1}×</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text style={styles.earningsMeta}>
                          {r.distanceKm} km
                          {r.durationMin ? `  ·  ${r.durationMin} min ETA` : ""}
                        </Text>
                        <Text style={styles.earningsLabel}>Estimated Earnings</Text>
                      </View>
                      <View style={styles.payBadge}>
                        <Text style={styles.payBadgeText}>₹ {payKey}</Text>
                      </View>
                    </LinearGradient>

                    {/* ── ACTIONS ── */}
                    <View style={styles.actions}>
                      {/* Reject — red gradient, fixed width */}
                      <Animated.View
                        style={{
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
                          onPress={handleReject}
                          activeOpacity={0.85}
                          style={{ borderRadius: 14, overflow: "hidden" }}
                        >
                          <LinearGradient
                            colors={[RED, RED_DARK]}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={styles.rejectBtn}
                          >
                            <Animated.View
                              pointerEvents="none"
                              style={[
                                StyleSheet.absoluteFillObject,
                                {
                                  backgroundColor: "#fff",
                                  opacity: rejectFill.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [0, 0.2],
                                  }),
                                },
                              ]}
                            />
                            <View style={styles.rejectIconCircle}>
                              <Feather name="x" size={13} color={RED_DARK} />
                            </View>
                            <Text style={styles.rejectText}>Reject</Text>
                          </LinearGradient>
                        </TouchableOpacity>
                      </Animated.View>

                      {/* Accept — green gradient slider */}
                      <View style={{ flex: 1 }}>
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
    top: 0, left: 12, right: 12, bottom: 0,
    borderRadius: 24,
  },

  // ── Counter pill + pagination dots ─────────────────────────────────────────
  counterPill: {
    alignSelf: "center",
    backgroundColor: "#1C1C1E",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginBottom: 8,
  },
  counterText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginBottom: 10,
  },
  paginationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#9CA3AF",
  },
  paginationDotActive: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: MANGO_DARK,
  },

  // ── Slider / card ──────────────────────────────────────────────────────────
  slider: {},
  card: {
    width: CARD_W,
    marginHorizontal: 12,
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 10,
    gap: 7,
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 9,
  },

  // ── Header: single row — badges left, help + ring right ────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  newOrderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#F0FDF4",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  newOrderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GREEN_DARK,
  },
  newOrderText: {
    fontSize: 10,
    fontWeight: "800",
    color: GREEN_DARK,
    letterSpacing: 0.4,
  },
  hurryBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: MANGO_DARK,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 7,
  },
  hurryText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.4,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  // ── Ring ───────────────────────────────────────────────────────────────────
  ringWrap: { alignItems: "center", justifyContent: "center" },
  ringCenter: { position: "absolute", alignItems: "center", justifyContent: "center" },
  ringNum:  { fontSize: 20, fontWeight: "800", lineHeight: 22 },
  ringUnit: { fontSize: 8,  fontWeight: "700", letterSpacing: 0.4, marginTop: -2 },

  // ── Pickup block — light green background ──────────────────────────────────
  pickupBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F0FDF4",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  locationIconWrapGreen: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#DCFCE7",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  locationContent: { flex: 1, gap: 1 },
  pickupLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: GREEN_DARK,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  locationAddr: {
    fontSize: 13,
    fontWeight: "700",
    color: "#111827",
    lineHeight: 17,
  },

  // ── Drop block — light red background ──────────────────────────────────────
  dropBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#FFF5F5",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  locationIconWrapRed: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  dropLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: RED_DARK,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  // Distance km pills
  kmPillGreen: {
    backgroundColor: "#DCFCE7",
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  kmPillGreenText: { fontSize: 11, fontWeight: "700", color: GREEN_DARK },
  kmPillRed: {
    backgroundColor: "#FEE2E2",
    borderRadius: 7,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  kmPillRedText: { fontSize: 11, fontWeight: "700", color: RED_DARK },

  // ── Earnings hero — mango gradient, dominant element ───────────────────────
  earningsHero: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
  },
  earningsLeft: { flex: 1, gap: 2 },
  earningsAmountRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 1,
  },
  earningsCurrency: {
    fontSize: 20,
    fontWeight: "800",
    color: "#fff",
    marginBottom: 3,
  },
  earningsAmount: {
    fontSize: 46,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -2,
    lineHeight: 48,
  },
  surgeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(0,0,0,0.22)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 5,
    marginLeft: 5,
    marginBottom: 4,
  },
  surgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  earningsMeta: {
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.88)",
    marginTop: 1,
  },
  earningsLabel: {
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.68)",
    letterSpacing: 0.3,
  },

  // Payment badge — white pill on gradient
  payBadge: {
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  payBadgeText: {
    fontSize: 12,
    fontWeight: "900",
    color: MANGO_DARK,
    letterSpacing: 0.4,
  },

  // ── Actions ────────────────────────────────────────────────────────────────
  actions: { flexDirection: "row", gap: 8 },

  // Reject — red gradient, fixed width
  rejectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    height: SLIDE_HEIGHT,
    width: 108,
    borderRadius: 14,
  },
  rejectIconCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  rejectText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },

  // Slide to accept — green gradient
  slideTrack: {
    height: SLIDE_HEIGHT,
    borderRadius: 14,
    overflow: "hidden",
    justifyContent: "center",
  },
  slideLabel: {
    position: "absolute",
    alignSelf: "center",
    color: "#fff",
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  slideThumb: {
    position: "absolute",
    left: SLIDE_PAD,
    width: SLIDE_THUMB,
    height: SLIDE_THUMB,
    borderRadius: 11,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 3,
  },

  // ── Fetch state ────────────────────────────────────────────────────────────
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
