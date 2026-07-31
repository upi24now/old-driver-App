/**
 * Authentication V3 — Stack Navigator + Flow State Provider
 *
 * Provides the V3FlowContext to every screen in the auth stack so that
 * transient flow state (phone, tokens, PIN, signup data) is shared cleanly
 * without module-level singletons.
 *
 * The context is automatically cleared when the user exits the V3 stack.
 *
 * No B2 dependencies.
 */

import { Stack } from "expo-router";
import { V3FlowProvider } from "@/contexts/auth-v3/FlowContext";

export default function AuthV3Layout() {
  return (
    <V3FlowProvider>
      <Stack
        screenOptions={{
          headerShown:    false,
          animation:      "slide_from_right",
          gestureEnabled: true,
        }}
      />
    </V3FlowProvider>
  );
}
