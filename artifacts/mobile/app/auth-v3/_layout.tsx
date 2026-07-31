/**
 * Authentication V3 — Stack Navigator + Flow State Provider
 *
 * Mounts V3FlowProvider so transient flow state (phone, tokens, PIN, signup
 * data) is shared cleanly between all auth-v3 screens without singletons.
 * Context is automatically cleared when the user exits the V3 stack.
 *
 * Compartment ownership:
 *   V3FlowProvider → C8 UI Layer (context)
 *   Stack          → Expo Router (routing)
 *
 * No B2 dependencies.
 */

import { Stack } from "expo-router";
import { V3FlowProvider } from "@/modules/auth-v3/ui/context/FlowContext";

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
