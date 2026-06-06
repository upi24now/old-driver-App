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
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/AnimatedSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverProvider, useDriver } from "@/contexts/DriverContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useNotifications } from "@/hooks/useNotifications";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  // Initialize notification channels, request permission, attach listeners.
  // Must be inside DriverProvider so notifications can access router context.
  useNotifications();

  const router = useRouter();
  const {
    authLoading, driverUid, profile, vehicle,
    documentsSubmitted, verificationStatus,
    backgroundSetupShown,
  } = useDriver();

  // ── Auth-restore navigation ───────────────────────────────────────────────
  // Fires once per app session when Firebase finishes restoring a persisted
  // session. If the driver is already authenticated (no OTP needed), route
  // them to the correct onboarding step. The `hasNavigated` ref prevents this
  // effect from re-running after post-OTP navigation changes driverUid.
  const hasNavigated = useRef(false);
  useEffect(() => {
    if (authLoading)               return;
    if (hasNavigated.current)      return;
    hasNavigated.current = true;
    if (!driverUid)                return; // no session — stay on login

    if (!vehicle?.id)                            { router.replace("/vehicle-selection"); return; }
    if (!profile?.name)                          { router.replace("/profile-setup");     return; }
    if (!documentsSubmitted)                     { router.replace("/document-upload");   return; }
    if (verificationStatus !== "approved")       { router.replace("/verification-pending"); return; }
    if (!backgroundSetupShown)                   { router.replace("/background-setup");    return; }
    router.replace("/(tabs)");
  // Deps: only the values that determine when auth loading is done and who is logged in.
  // All other values (profile, vehicle, …) are read at the moment the effect runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, driverUid]);

  return (
    <Stack
      initialRouteName="login"
      screenOptions={{ headerShown: false, animation: "slide_from_right" }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="otp" />
      <Stack.Screen name="vehicle-selection" />
      <Stack.Screen name="profile-setup" />
      <Stack.Screen name="document-upload" />
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
  );
}

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
