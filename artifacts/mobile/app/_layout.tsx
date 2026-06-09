import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/AnimatedSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverProvider, useDriver } from "@/contexts/DriverContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useNotifications } from "@/hooks/useNotifications";
import { checkNotificationPermissions } from "@/utils/notifications";
import { PERMISSION_SETUP_VERSION } from "@/utils/firestore";

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
    backgroundSetupShown, permissionSetupVersion,
    onboardingFeeApplies, onboardingFeeStatus,
  } = useDriver();

  // ── Auth-restore navigation ───────────────────────────────────────────────
  // Fires when authLoading clears (app start) or driverUid changes (login /
  // logout). The `hasNavigated` ref prevents the onboarding routing logic from
  // re-running after subsequent profile/vehicle/status field updates, but the
  // unauthenticated redirect must bypass that gate so logout always lands on
  // /login even after the initial auth-restore has already run.
  const hasNavigated = useRef(false);
  useEffect(() => {
    if (authLoading) return;

    // Unauthenticated — always redirect to /login.
    // Placed before the hasNavigated gate so that:
    //   (a) Fresh/logged-out app start → login screen.
    //   (b) Explicit signOut() call (driverUid → null) → login screen,
    //       even though hasNavigated is already true from the prior session.
    if (!driverUid) {
      console.log("[Auth] no session → login");
      router.replace("/login");
      return;
    }

    // Authenticated — only run the onboarding routing logic once per session.
    // Prevents re-routing when profile/vehicle/status fields update after the
    // initial navigation has already resolved.
    if (hasNavigated.current) return;
    hasNavigated.current = true;

    console.log("[Auth] routing:", {
      uid: driverUid.slice(-4),
      vehicle: !!vehicle?.id, profile: !!profile?.name,
      documentsSubmitted, verificationStatus, backgroundSetupShown,
    });

    if (!vehicle?.id)   { console.log("[Auth] → vehicle-selection"); router.replace("/vehicle-selection"); return; }
    if (!profile?.name) { console.log("[Auth] → profile-setup");     router.replace("/profile-setup");     return; }

    // Approved/verified drivers skip document, fee, and verification-pending checks.
    // documentsSubmitted may be absent on manually-onboarded drivers — that must never
    // block an already-approved driver from reaching the dashboard.
    const isApproved = verificationStatus === "approved" || verificationStatus === "verified";
    if (!isApproved) {
      if (!documentsSubmitted) { console.log("[Auth] → document-upload");      router.replace("/document-upload");      return; }
      // Fee screen: only when onboardingFeeApplies is explicitly true (brand-new signup).
      // Existing drivers never have this field set, so they always skip this branch.
      if (onboardingFeeApplies && onboardingFeeStatus !== "paid") {
                                 console.log("[Auth] → onboarding-fee");       router.replace("/onboarding-fee");       return; }
                                 console.log("[Auth] → verification-pending"); router.replace("/verification-pending"); return;
    }

    // Check real runtime permissions — backgroundSetupShown alone is not
    // sufficient because the driver may have tapped "Skip" on first visit.
    // Both notification AND GPS must be granted before the dashboard is shown.
    void (async () => {
      // Web preview: skip Android permission checks entirely — no notification
      // or location APIs exist in the browser. Approved drivers go straight to
      // the dashboard. Android APK path is completely unchanged below.
      if (Platform.OS === "web") {
        console.log("[Auth] web → (tabs) (permission check skipped)");
        router.replace("/(tabs)");
        return;
      }
      const [notifOk, locStatus] = await Promise.all([
        checkNotificationPermissions().catch(() => false),
        Location.getForegroundPermissionsAsync().catch(() => ({ granted: false })),
      ]);
      const permsGranted     = notifOk && locStatus.granted;
      const setupVersionOk   = permissionSetupVersion >= PERMISSION_SETUP_VERSION;
      console.log("[Auth] perms:", {
        notifOk,
        locationGranted: locStatus.granted,
        permissionSetupVersion,
        required: PERMISSION_SETUP_VERSION,
      });
      if (!permsGranted || !setupVersionOk) {
        console.log("[Auth] → background-setup",
          !permsGranted ? "(perms missing)" : "(version outdated)");
        router.replace("/background-setup");
      } else {
        console.log("[Auth] → (tabs)");
        router.replace("/(tabs)");
      }
    })();
  // Deps: only the values that determine when auth loading is done and who is logged in.
  // All other values (profile, vehicle, …) are read at the moment the effect runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, driverUid]);

  return (
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
