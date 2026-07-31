/**
 * Authentication V3 — Stack Navigator
 *
 * This layout owns all V3 auth screens. It is completely independent from
 * the main app's navigation — it is a self-contained mini-application.
 *
 * Screens under this layout are exempted from B2's root guard via the
 * pathname.startsWith("/auth-v3") check in app/_layout.tsx.
 */

import { Stack } from "expo-router";

export default function AuthV3Layout() {
  return (
    <Stack
      screenOptions={{
        headerShown:  false,
        animation:    "slide_from_right",
        gestureEnabled: true,
      }}
    />
  );
}
