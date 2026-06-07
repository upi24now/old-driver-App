import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

/**
 * Root index screen — owns path "/" and prevents app/(tabs)/index.tsx
 * from being the initial route on a cold Android launch (no deep link).
 *
 * app/_layout.tsx is the single routing authority. It routes to /login,
 * /background-setup, or /(tabs) once Firebase auth resolves.
 * This screen just holds a spinner while that routing fires.
 *
 * Safety net: if authLoading is done and there is no session, redirect
 * to /login directly (covers any edge-case where _layout.tsx is slow).
 */
export default function Index() {
  const { authLoading, driverUid } = useDriver();
  const colors = useColors();

  if (!authLoading && !driverUid) {
    return <Redirect href="/login" />;
  }

  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.background,
      }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}
