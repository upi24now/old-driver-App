import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  View,
} from "react-native";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const LOGO     = require("../assets/images/logo.png") as number;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FALLBACK = require("../assets/images/icon.png") as number;

interface AnimatedSplashProps {
  isReady: boolean;
  onAnimationComplete: () => void;
}

export function AnimatedSplash({ isReady, onAnimationComplete }: AnimatedSplashProps) {
  const [logoError, setLogoError] = useState(false);

  const logoOpacity    = useRef(new Animated.Value(0)).current;
  const logoScale      = useRef(new Animated.Value(0.78)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  const dot1 = useRef(new Animated.Value(0.25)).current;
  const dot2 = useRef(new Animated.Value(0.25)).current;
  const dot3 = useRef(new Animated.Value(0.25)).current;

  const screenOpacity = useRef(new Animated.Value(1)).current;

  // Guard: ensure onAnimationComplete is called exactly once, regardless of
  // whether the normal animation path or the 4-second timeout fires first.
  const hasFinishedRef     = useRef(false);
  const onCompleteRef      = useRef(onAnimationComplete);
  useEffect(() => { onCompleteRef.current = onAnimationComplete; }, [onAnimationComplete]);

  useEffect(() => {
    console.log("[SPLASH] mounted");
  }, []);

  // Hard 4-second cutoff — if isReady never becomes true (font load failure,
  // slow network, cold bundle) the splash is force-dismissed immediately so
  // the app is never stuck on a black/gradient screen.
  useEffect(() => {
    const tid = setTimeout(() => {
      if (hasFinishedRef.current) return;
      hasFinishedRef.current = true;
      console.log("[SPLASH_TIMEOUT_FALLBACK] fired — forcing splash dismiss after 4s");
      screenOpacity.setValue(0);
      onCompleteRef.current();
    }, 4000);
    return () => clearTimeout(tid);
  }, []);

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(logoScale, {
          toValue: 1,
          friction: 7,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.timing(taglineOpacity, {
        toValue: 1,
        duration: 400,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        makeDotPulse(dot1),
        makeDotPulse(dot2),
        makeDotPulse(dot3),
        Animated.delay(400),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  useEffect(() => {
    if (!isReady) return;
    Animated.timing(screenOpacity, {
      toValue: 0,
      duration: 500,
      delay: 300,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => {
      if (hasFinishedRef.current) return; // timeout already fired
      hasFinishedRef.current = true;
      console.log("[SPLASH] finished");
      onCompleteRef.current();
    });
  }, [isReady]);

  return (
    <Animated.View style={[styles.container, { opacity: screenOpacity }]}>
      <LinearGradient
        colors={["#080c08", "#0a140a", "#0d1a0e", "#0f1f10"]}
        locations={[0, 0.3, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.centerContent}>
        <Animated.View
          style={[
            styles.logoGroup,
            { opacity: logoOpacity, transform: [{ scale: logoScale }] },
          ]}
        >
          <View style={styles.iconRing}>
            <Image
              source={logoError ? FALLBACK : LOGO}
              onError={() => setLogoError(true)}
              style={styles.logo}
              resizeMode="contain"
            />
          </View>

          <View style={styles.accentLine} />
        </Animated.View>

        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
          On your terms
        </Animated.Text>
      </View>

      <View style={styles.loaderContainer}>
        <Dot anim={dot1} />
        <Dot anim={dot2} />
        <Dot anim={dot3} />
      </View>
    </Animated.View>
  );
}

function makeDotPulse(anim: Animated.Value) {
  return Animated.sequence([
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }),
    Animated.timing(anim, {
      toValue: 0.25,
      duration: 220,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }),
  ]);
}

function Dot({ anim }: { anim: Animated.Value }) {
  return (
    <Animated.View style={[styles.dot, { opacity: anim }]} />
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 999,
  },
  centerContent: {
    alignItems: "center",
    gap: 20,
  },
  logoGroup: {
    alignItems: "center",
    gap: 18,
  },
  iconRing: {
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1.5,
    borderColor: "rgba(0, 200, 83, 0.25)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#00C853",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 28,
    elevation: 12,
  },
  logo: {
    width: 82,
    height: 82,
  },
  accentLine: {
    width: 48,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: "#00C853",
  },
  tagline: {
    fontSize: 14,
    color: "rgba(255,255,255,0.45)",
    letterSpacing: 3,
    textTransform: "uppercase",
    fontWeight: "500",
  },
  loaderContainer: {
    position: "absolute",
    bottom: 100,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "#00C853",
  },
});
