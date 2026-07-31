import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";
import { useFonts } from "expo-font";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot, Stack, useRouter, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverProvider, useDriver } from "@/contexts/DriverContext";
import { AuthV3Provider } from "@/contexts/AuthV3Context";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useNotifications } from "@/hooks/useNotifications";
import { firebaseAuth } from "@/utils/firebase";
import { PERMISSION_SETUP_VERSION } from "@/utils/firestore";

// Build marker — printed once at bundle evaluation so the live deployment can be
// verified as the latest source from the JS console / Expo Go logs.

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  useNotifications();

  const router = useRouter();
  const pathname = usePathname();
  const { authLoading, driverUid, isOtpVerified, isOtpVerifying, localPermissionVersion } = useDriver();

  // ── [FP_TRACE] render counter — increments on every re-render of this component
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const rc = renderCountRef.current;

  // ── [FP_TRACE] dense render log — shows every state snapshot in sequence ──────
  // Filter on "[FP_TRACE]" in the Expo console to see the forgot-PIN execution path.
  console.log(
    `[FP_TRACE][LAYOUT_RENDER #${rc}] ts=${Date.now()}`,
    `| pathname=${pathname}`,
    `| authLoading=${authLoading}`,
    `| driverUid=${driverUid ? "SET" : "null"}`,
    `| isOtpVerified=${isOtpVerified}`,
    `| isOtpVerifying=${isOtpVerifying}`,
    `| localPermVer=${localPermissionVersion}`,
    `| firebaseUser=${firebaseAuth.currentUser?.uid ? "SET" : "null"}`,
  );

  console.log("[GUARD] pathname =", pathname, "| driverUid =", driverUid ? "present" : "null", "| isOtpVerified =", isOtpVerified, "| isOtpVerifying =", isOtpVerifying, "| authLoading(isLoading) =", authLoading);
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
  //   otp.tsx calls router.back() + router.replace(nextRoute) after confirmOtp() succeeds.
  //   back() pops /otp; replace() swaps /login with the destination — stack ends as [nextRoute].
  //   isOtpVerified=true → this effect is a no-op.
  // Capture render count at the time the effect *closure* is created so the
  // effect log matches the render that scheduled it.
  const renderCountAtEffect = useRef(0);
  renderCountAtEffect.current = rc;

  useEffect(() => {
    const effectRc = renderCountAtEffect.current;
    // ─────────────────────────────────────────────────────────────────────────
    // [AUTH_STATE_L1] _layout.tsx effect fired — full snapshot of all 5 deps
    // plus pathname (NOT a dep — captured from closure; may be stale if router
    // navigated without triggering a dep change).
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[AUTH_STATE_L1] _layout.tsx useEffect FIRED",
      "| #:", effectRc,
      "| authLoading:", authLoading,
      "| driverUid:", driverUid ? "SET(" + driverUid + ")" : "null",
      "| isOtpVerified:", isOtpVerified,
      "| isOtpVerifying:", isOtpVerifying,
      "| localPermVer:", localPermissionVersion,
      "| firebaseUser:", firebaseAuth.currentUser?.uid ?? "null",
      "| pathname:", pathname,
      "| ts:", Date.now(),
    );
    console.log(
      `[FP_TRACE][LAYOUT_EFFECT #${effectRc}] ts=${Date.now()}`,
      `| authLoading=${authLoading}`,
      `| driverUid=${driverUid ? "SET" : "null"}`,
      `| isOtpVerified=${isOtpVerified}`,
      `| isOtpVerifying=${isOtpVerifying}`,
      `| localPermVer=${localPermissionVersion}`,
      `| firebaseUser=${firebaseAuth.currentUser?.uid ? "SET" : "null"}`,
    );

    if (authLoading) {
      console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → early-return: authLoading=true`);
      // ─────────────────────────────────────────────────────────────────────
      // [AUTH_STATE_L2] authLoading=true — effect is a no-op. Spinner overlay.
      // ─────────────────────────────────────────────────────────────────────
      console.log("[AUTH_STATE_L2] BRANCH authLoading=true → early-return (no routing)",
        "| ts:", Date.now(),
      );
      return;
    }
    // Block until AsyncStorage boot read completes (resolves in <50 ms).
    if (localPermissionVersion === null) {
      console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → early-return: localPermissionVersion=null`);
      // ─────────────────────────────────────────────────────────────────────
      // [AUTH_STATE_L3] localPermissionVersion=null — AsyncStorage not yet read.
      // ─────────────────────────────────────────────────────────────────────
      console.log("[AUTH_STATE_L3] BRANCH localPermissionVersion=null → early-return (no routing)",
        "| ts:", Date.now(),
      );
      return;
    }

    // ── Flash guard ───────────────────────────────────────────────────────────
    // confirmOtp() sets isOtpVerifying=true BEFORE calling signInWithCustomToken.
    // onAuthStateChanged fires inside that call and sets driverUid, which would
    // normally trigger this effect with isOtpVerified=false → /login redirect.
    // While isOtpVerifying=true the guard below blocks all routing; the flag is
    // cleared together with setIsOtpVerified(true) in the same React render batch,
    // so the next effect fire sees isOtpVerified=true and becomes a no-op.
    if (isOtpVerifying) {
      console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → early-return: isOtpVerifying=true (flash guard active)`);
      console.log("[LAYOUT_SKIP_DURING_OTP]", "[LOGIN_FLASH_BLOCKED]", "— isOtpVerifying=true; route guard suspended to prevent /login flash");
      // ─────────────────────────────────────────────────────────────────────
      // [AUTH_STATE_L4] isOtpVerifying=true — flash guard ACTIVE. No routing.
      // If we reach L4, the flash guard is working correctly.
      // If we NEVER see L4 during the OTP flow, the flash guard is NOT committed
      // to React state in time → it will appear as L6 or L7 (wrong redirect).
      // ─────────────────────────────────────────────────────────────────────
      console.log("[AUTH_STATE_L4] BRANCH isOtpVerifying=true → flash guard ACTIVE (no routing)",
        "| ts:", Date.now(),
      );
      return;
    }

    // ── V3 auth screens manage their own routing — skip global guard ──────────
    if (pathname.startsWith("/auth-v3")) {
      console.log(`[AUTH_V3][LAYOUT_EFFECT #${effectRc}] BRANCH → V3-auth early-return: pathname=${pathname}`);
      console.log("[AUTH_STATE_L5] BRANCH pathname=auth-screen → no routing",
        "| pathname:", pathname,
        "| ts:", Date.now(),
      );
      return;
    }

    if (!driverUid || !firebaseAuth.currentUser) {
      // Not authenticated — show permission onboarding on first install;
      // go to login for returning drivers who have already completed it.
      if (localPermissionVersion < PERMISSION_SETUP_VERSION) {
        console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → /background-setup (no driverUid, first install)`);
        console.log("[PERMISSION_GATE] first launch — localVer =", localPermissionVersion, "→ /background-setup");
        console.log("[RUNTIME_NAVIGATION_20260730] _layout.tsx | RootLayoutNav effect | destination: /background-setup");
        router.replace("/background-setup");
      } else {
        console.log(`[AUTH_V3][LAYOUT_EFFECT #${effectRc}] BRANCH → /login-v3 (no driverUid, no_session)`);
        console.log("[BOOT_ROUTE] chosenRoute = /login-v3 (no_session)");
        console.log("[RUNTIME_NAVIGATION_20260730] _layout.tsx | RootLayoutNav effect | destination: /login-v3 (no_session)");
        console.log("[AUTH_STATE_L6] BRANCH !driverUid → router.replace('/login-v3')",
          "| driverUid:", driverUid ?? "null",
          "| firebaseAuth.currentUser:", firebaseAuth.currentUser?.uid ?? "null",
          "| isOtpVerifying:", isOtpVerifying,
          "| pathname:", pathname,
          "| ts:", Date.now(),
        );
        router.replace("/auth-v3/welcome" as never);
      }
      return;
    }

    if (!isOtpVerified) {
      console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → /login (driverUid=SET but isOtpVerified=false, isOtpVerifying=false) ← THIS KILLS FORGOT-PIN IF IT FIRES`);
      console.log("[GUARD] REDIRECT → /login-v3 | reason = otp_required (driverUid present but isOtpVerified=false) | from pathname =", pathname);
      console.log("[BOOT_ROUTE] chosenRoute = /login-v3 (otp_required uid =", driverUid, ")");
      console.log("[RUNTIME_NAVIGATION_20260730] _layout.tsx | RootLayoutNav effect | destination: /login-v3 (otp_required)");
      console.log("[AUTH_STATE_L7] BRANCH driverUid=SET + isOtpVerified=false → router.replace('/login-v3')",
        "| driverUid:", driverUid,
        "| isOtpVerifying:", isOtpVerifying,
        "| pathname:", pathname,
        "| ts:", Date.now(),
      );
      router.replace("/auth-v3/welcome" as never);
      return;
    }

    // isOtpVerified=true: navigation was already handled upstream by either
    // otp.tsx (fresh OTP) or onAuthStateChanged (session restore).
    console.log(`[FP_TRACE][LAYOUT_EFFECT #${effectRc}] BRANCH → no-op (isOtpVerified=true, handled upstream)`);
    console.log("[ROUTE_DECISION] handled upstream — session restore or fresh OTP");
    // ─────────────────────────────────────────────────────────────────────────
    // [AUTH_STATE_L8] isOtpVerified=true — effect is a no-op.
    // This is the HAPPY PATH. Every dep-change that fires the effect after a
    // successful login should land here.
    // ─────────────────────────────────────────────────────────────────────────
    console.log("[AUTH_STATE_L8] BRANCH isOtpVerified=true → no-op (happy path)",
      "| driverUid:", driverUid,
      "| pathname:", pathname,
      "| ts:", Date.now(),
    );
  }, [authLoading, driverUid, isOtpVerified, isOtpVerifying, localPermissionVersion]);

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
        initialRouteName="index"
        screenOptions={{ headerShown: false, animation: "slide_from_right" }}
      >
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="registration" />
        <Stack.Screen name="vehicle-selection" />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="document-upload" />
        <Stack.Screen name="onboarding-fee" />
        <Stack.Screen name="verification-pending" />
        <Stack.Screen name="account-blocked" />
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

  const isReady = !!(fontsLoaded || fontError);

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
                <AuthV3Provider>
                  <DriverProvider>
                    <RootLayoutNav />
                  </DriverProvider>
                </AuthV3Provider>
              </ThemeProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
