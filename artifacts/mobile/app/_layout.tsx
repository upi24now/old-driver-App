import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
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

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  // Initialize notification channels, request permission, attach listeners.
  // Must be inside DriverProvider so notifications can access router context.
  useNotifications();

  const router = useRouter();
  const { authLoading, driverUid, isOtpVerified } = useDriver();

  // ── BOOT diagnostics — logged on every render ─────────────────────────────
  console.log("[BOOT] render");
  console.log("[BOOT] authLoading =",   authLoading);
  console.log("[BOOT] showOverlay =",   authLoading);
  console.log("[BOOT] driverUid =",     driverUid);
  console.log("[BOOT] isOtpVerified =", isOtpVerified);
  console.log("[BOOT] firebaseUser =",  firebaseAuth.currentUser?.uid ?? null);

  // ── Auth-policy routing ───────────────────────────────────────────────────
  //
  // NEW STRICT RULE: Every app launch always starts from /login.
  //
  // A persisted Firebase session (restored by onAuthStateChanged on cold start)
  // does NOT bypass the login screen. Only a successful confirmOtp() call in
  // the current session sets isOtpVerified=true, which is the sole gate that
  // allows the app to advance past /login.
  //
  // Why: driverUid is set by onAuthStateChanged for ANY user who previously
  // logged in — even a new phone opening the app for the first time would
  // end up at vehicle-selection if _layout.tsx auto-routed on session restore.
  //
  // Responsibility split:
  //   - _layout.tsx (here): ONLY routes to /login when the OTP gate is closed.
  //   - confirmOtp() in DriverContext: computes the correct post-OTP route and
  //     sets isOtpVerified=true. otp.tsx then calls router.replace(nextRoute).
  //   - signOut(): resets isOtpVerified=false so the next launch re-gates.
  useEffect(() => {
    console.log("[_AUTH_ROUTE] authLoading =",    authLoading);
    console.log("[_AUTH_ROUTE] driverUid =",      driverUid);
    console.log("[_AUTH_ROUTE] isOtpVerified =",  isOtpVerified);
    console.log("[_AUTH_ROUTE] firebaseUser =",   firebaseAuth.currentUser?.uid ?? null);

    if (authLoading) return;

    if (!driverUid || !firebaseAuth.currentUser) {
      console.log("[AUTH_POLICY] route login — no_session");
      router.replace("/login");
      return;
    }

    if (!isOtpVerified) {
      console.log("[AUTH_POLICY] route login — session_exists_otp_required uid =", driverUid);
      router.replace("/login");
      return;
    }

    // isOtpVerified=true: confirmOtp() succeeded this session.
    // Routing to the correct post-OTP screen is owned by otp.tsx via
    // router.replace(result.nextRoute). _layout.tsx does not interfere.
    console.log("[_AUTH_ROUTE] otp_verified_this_session — post-otp route owned by otp.tsx");
  }, [authLoading, driverUid, isOtpVerified]);

  // ── Auth-loading overlay ──────────────────────────────────────────────────
  // Sits on top of the Stack while Firebase is resolving the persisted session.
  // Prevents any route (vehicle-selection, profile-setup, etc.) that was last
  // active in the previous session from being visible before the routing guard
  // fires. Without this a fresh browser tab opened at /vehicle-selection would
  // briefly — or permanently — show that screen before the login redirect lands.
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
        options={{
          presentation: "fullScreenModal",
          animation: "fade",
        }}
      />
      <Stack.Screen
        name="ride-request"
        options={{
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
          // Disable swipe-down / swipe-back gesture dismissal so the driver
          // cannot exit the request screen without explicitly accepting,
          // rejecting, or waiting for the 15-second timer to expire.
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

  console.log("[BOOT] showSplash =", splashVisible);
  console.log("[BOOT] fontsLoaded =", fontsLoaded, "fontError =", !!fontError);

  useEffect(() => {
    if (isReady) {
      SplashScreen.hideAsync();
    }
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
