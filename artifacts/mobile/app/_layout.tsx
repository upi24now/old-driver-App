import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AnimatedSplash } from "@/components/AnimatedSplash";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DriverProvider } from "@/contexts/DriverContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useNotifications } from "@/hooks/useNotifications";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  // Initialize notification channels, request permission, attach listeners.
  // Must be inside DriverProvider so notifications can access router context.
  useNotifications();

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
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="trip/[id]" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="subscription" />
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
          presentation: "transparentModal",
          animation: "fade",
          contentStyle: { backgroundColor: "transparent" },
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
