import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot, Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/AnimatedSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverProvider, useDriver } from "@/contexts/DriverContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useNotifications } from "@/hooks/useNotifications";
import { firebaseAuth } from "@/utils/firebase";
import { PERMISSION_SETUP_VERSION } from "@/utils/firestore";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  useNotifications();

  const router = useRouter();
  const { authLoading, driverUid, isOtpVerified, localPermissionVersion } = useDriver();

  console.log("[BOOT] render");
  console.log("[BOOT] authLoading =",   authLoading);
  console.log("[BOOT] showOverlay =",   authLoading);
  console.log("[BOOT] driverUid =",     driverUid);
  console.log("[BOOT] isOtpVerified =", isOtpVerified);
  console.log("[BOOT] firebaseUser =",  firebaseAuth.currentUser?.uid ?? null);

  // ── Auth-policy routing ───────────────────────────────────────────────────
  //
  // This effect fires whenever authLoading, driverUid, isOtpVerified, OR
  // localPermissionVersion changes. localPermissionVersion starts null and
  // resolves to a number once the AsyncStorage boot read completes (<50 ms).
  // No routing fires while it is null, preventing premature decisions.
  //
  // Routing matrix:
  //
  //   authLoading=true          → no-op (spinner overlay is covering the screen)
  //   localPermissionVersion=null → no-op (AsyncStorage not yet read)
  //   !driverUid                → FIRST INSTALL or LOGGED-OUT driver:
  //       localVer < required   → /background-setup  (permission onboarding first)
  //       localVer >= required  → /login             (returning logged-out driver)
  //   driverUid + !isOtpVerified → /login            (OTP gate)
  //   driverUid + isOtpVerified  → handled upstream  (session restore or otp.tsx routed)
  //
  // Session restore (valid Firebase session):
  //   onAuthStateChanged → AsyncStorage check → sessionValid=true →
  //   Firestore fetch → deriveNextRoute → router.replace(nextRoute) →
  //   setAuthLoading(false). Overlay lifts onto the correct screen.
  //
  // Post-OTP fresh login:
  //   otp.tsx calls router.replace(nextRoute) after confirmOtp() succeeds.
  //   isOtpVerified=true → this effect is a no-op.
  useEffect(() => {
    if (authLoading) return;
    // Block until AsyncStorage boot read completes (resolves in <50 ms).
    if (localPermissionVersion === null) return;

    if (!driverUid || !firebaseAuth.currentUser) {
      // Not authenticated — show permission onboarding on first install;
      // go to login for returning drivers who have already completed it.
      if (localPermissionVersion < PERMISSION_SETUP_VERSION) {
        console.log("[PERMISSION_GATE] first launch — localVer =", localPermissionVersion, "→ /background-setup");
        router.replace("/background-setup");
      } else {
        console.log("[BOOT_ROUTE] chosenRoute = /login (no_session)");
        router.replace("/login");
      }
      return;
    }

    if (!isOtpVerified) {
      console.log("[BOOT_ROUTE] chosenRoute = /login (otp_required uid =", driverUid, ")");
      router.replace("/login");
      return;
    }

    // isOtpVerified=true: navigation was already handled upstream by either
    // otp.tsx (fresh OTP) or onAuthStateChanged (session restore).
    console.log("[ROUTE_DECISION] handled upstream — session restore or fresh OTP");
  }, [authLoading, driverUid, isOtpVerified, localPermissionVersion]);

  // Auth-loading overlay — disappears when authLoading becomes false.
  // authLoading is guaranteed to become false within 8 s by DriverContext timeout.
  const authOverlay = authLoading ? (
    <View style={authStyles.overlay}>
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  ) : null;

  return (
    <>
      <Stack
        initialRouteName="login"
        screenOptions={{ headerShown: false, animation: "slide_from_right" }}
      >
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="login" />
        <Stack.Screen name="otp" />
        <Stack.Screen name="vehicle-selection" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="document-upload" />
        <Stack.Screen name="onboarding-fee" />
        <Stack.Screen name="verification-pending" />
        <Stack.Screen name="background-setup" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="trip/[id]" />
        <Stack.Screen name="wallet" />
        <Stack.Screen name="subscription" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="privacy-policy" />
        <Stack.Screen name="terms-and-conditions" />
        <Stack.Screen
          name="lock-alert"
          options={{ presentation: "fullScreenModal", animation: "fade" }}
        />
        <Stack.Screen
          name="ride-request"
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="delivery-command-center"
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack>
      {authOverlay}
    </>
  );
}

const authStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFF8F5",
    alignItems:      "center",
    justifyContent:  "center",
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Feather.font,
    ...MaterialCommunityIcons.font,
  });

  const [splashVisible, setSplashVisible] = useState(true);
  const isReady = !!(fontsLoaded || fontError);

  console.log("[BOOT] showSplash =",    splashVisible);
  console.log("[BOOT] fontsLoaded =",   fontsLoaded, "fontError =", !!fontError);

  useEffect(() => {
    if (isReady) SplashScreen.hideAsync();
  }, [isReady]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={(error, stack) => console.error("[ErrorBoundary] caught:", error.message, stack)}>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <ThemeProvider>
                <DriverProvider>
                  <RootLayoutNav />
                  {splashVisible && (
                    <AnimatedSplash
                      isReady={isReady}
                      onAnimationComplete={() => setSplashVisible(false)}
                    />
                  )}
                </DriverProvider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
