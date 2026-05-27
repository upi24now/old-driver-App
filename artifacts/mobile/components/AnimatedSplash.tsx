import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";

const { width } = Dimensions.get("window");

interface AnimatedSplashProps {
  isReady: boolean;
  onAnimationComplete: () => void;
}

export function AnimatedSplash({ isReady, onAnimationComplete }: AnimatedSplashProps) {
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.78)).current;
  const taglineOpacity = useRef(new Animated.Value(0)).current;

  const dot1 = useRef(new Animated.Value(0.25)).current;
  const dot2 = useRef(new Animated.Value(0.25)).current;
  const dot3 = useRef(new Animated.Value(0.25)).current;

  const screenOpacity = useRef(new Animated.Value(1)).current;

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
        makeDotPulse(dot1, 0),
        makeDotPulse(dot2, 0),
        makeDotPulse(dot3, 0),
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
    }).start(() => onAnimationComplete());
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
            <View style={styles.iconInner}>
              <Feather name="navigation" size={40} color="#00C853" />
            </View>
          </View>

          <Text style={styles.appName}>DRIVER</Text>

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

      <View style={styles.footer}>
        <Text style={styles.footerText}>Powered by DriverStack</Text>
      </View>
    </Animated.View>
  );
}

function makeDotPulse(anim: Animated.Value, _delay: number) {
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
  iconInner: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: "rgba(0, 200, 83, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(0, 200, 83, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontSize: 38,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 12,
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
  footer: {
    position: "absolute",
    bottom: 48,
  },
  footerText: {
    fontSize: 11,
    color: "rgba(255,255,255,0.18)",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
