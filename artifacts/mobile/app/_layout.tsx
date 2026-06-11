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
import { ActivityIndicator, Platform, StyleSheet, View } from "react-native";
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
import { firebaseAuth } from "@/utils/firebase";

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
    // ── Debug snapshot — logged on every dep change, including while loading ──
    console.log("[_AUTH_ROUTE] authLoading =",          authLoading);
    console.log("[_AUTH_ROUTE] firebaseUser =",         firebaseAuth.currentUser?.uid ?? null);
    console.log("[_AUTH_ROUTE] driverUid =",            driverUid);
    console.log("[_AUTH_ROUTE] vehicleId =",            vehicle?.id ?? null);
    console.log("[_AUTH_ROUTE] profileName =",          profile?.name ?? null);
    console.log("[_AUTH_ROUTE] documentsSubmitted =",   documentsSubmitted);
    console.log("[_AUTH_ROUTE] onboardingFeeStatus =",  onboardingFeeStatus);
    console.log("[_AUTH_ROUTE] verificationStatus =",   verificationStatus);

    if (authLoading) return;

    // ── Safety net: cross-check React state against the live Firebase session ──
    // Guards against stale driverUid state surviving a session expiry or any
    // edge-case where the React state and Firebase diverge (e.g. a Firestore
    // read failure that set driverUid without a valid session being present).
    const firebaseUser = firebaseAuth.currentUser;

    // Unauthenticated — always redirect to /login.
    // Placed before the hasNavigated gate so that:
    //   (a) Fresh/logged-out app start → login screen.
    //   (b) Explicit signOut() call (driverUid → null) → login screen,
    //       even though hasNavigated is already true from the prior session.
    //   (c) Firebase session missing even though driverUid state is stale → login.
    if (!driverUid || !firebaseUser) {
      console.log("[_AUTH_ROUTE] chosenRoute = /login (uid:", driverUid, "firebase:", firebaseUser?.uid ?? null, ")");
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

    if (!vehicle?.id) {
      console.log("[_AUTH_ROUTE] chosenRoute = /vehicle-selection");
      router.replace("/vehicle-selection");
      return;
    }
    if (!profile?.name) {
      console.log("[_AUTH_ROUTE] chosenRoute = /profile-setup");
      router.replace("/profile-setup");
      return;
    }

    // Approved/verified drivers skip document, fee, and verification-pending checks.
    // documentsSubmitted may be absent on manually-onboarded drivers — that must never
    // block an already-approved driver from reaching the dashboard.
    const isApproved = verificationStatus === "approved" || verificationStatus === "verified";
    if (!isApproved) {
      if (!documentsSubmitted) {
        console.log("[_AUTH_ROUTE] chosenRoute = /document-upload");
        router.replace("/document-upload");
        return;
      }
      // Fee screen: only when onboardingFeeApplies is explicitly true (brand-new signup).
      // Existing drivers never have this field set, so they always skip this branch.
      if (onboardingFeeApplies && onboardingFeeStatus !== "paid") {
        console.log("[_AUTH_ROUTE] chosenRoute = /onboarding-fee");
        router.replace("/onboarding-fee");
        return;
      }
      console.log("[_AUTH_ROUTE] chosenRoute = /verification-pending");
      router.replace("/verification-pending");
      return;
    }

    // Check real runtime permissions — backgroundSetupShown alone is not
    // sufficient because the driver may have tapped "Skip" on first visit.
    // Both notification AND GPS must be granted before the dashboard is shown.
    void (async () => {
      // Web preview: skip Android permission checks entirely — no notification
      // or location APIs exist in the browser. Approved drivers go straight to
      // the dashboard. Android APK path is completely unchanged below.
      if (Platform.OS === "web") {
        console.log("[_AUTH_ROUTE] chosenRoute = /(tabs) (web, permission check skipped)");
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
        console.log("[_AUTH_ROUTE] chosenRoute = /background-setup",
          !permsGranted ? "(perms missing)" : "(version outdated)");
        router.replace("/background-setup");
      } else {
        console.log("[_AUTH_ROUTE] chosenRoute = /(tabs)");
        router.replace("/(tabs)");
      }
    })();
  // Deps: only the values that determine when auth loading is done and who is logged in.
  // All other values (profile, vehicle, …) are read at the moment the effect runs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, driverUid]);

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
