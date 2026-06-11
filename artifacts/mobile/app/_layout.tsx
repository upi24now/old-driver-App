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

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  useNotifications();

  const router = useRouter();
  const { authLoading, driverUid, isOtpVerified } = useDriver();

  console.log("[BOOT] render");
  console.log("[BOOT] authLoading =",   authLoading);
  console.log("[BOOT] showOverlay =",   authLoading);
  console.log("[BOOT] driverUid =",     driverUid);
  console.log("[BOOT] isOtpVerified =", isOtpVerified);
  console.log("[BOOT] firebaseUser =",  firebaseAuth.currentUser?.uid ?? null);

  // ── Auth-policy routing ───────────────────────────────────────────────────
  //
  // Every app launch always starts from /login.
  // A persisted Firebase session does NOT bypass the login screen.
  // Only a successful confirmOtp() call sets isOtpVerified=true.
  //
  // Firebase auth state resolution is guaranteed within 5 s by the timeout
  // in DriverContext — authLoading=false is always reached.
  useEffect(() => {
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

    console.log("[AUTH_POLICY] otp_verified — post-otp route owned by otp.tsx");
  }, [authLoading, driverUid, isOtpVerified]);

  // Auth-loading overlay — disappears when authLoading becomes false.
  // authLoading is guaranteed to become false within 5 s by DriverContext timeout.
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
