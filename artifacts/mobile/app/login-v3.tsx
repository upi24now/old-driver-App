/**
 * login-v3.tsx — V3 Entry Point (thin redirect)
 *
 * B2's global guard in _layout.tsx routes unauthenticated users to "/login-v3".
 * This file immediately hands off to the V3 auth stack so that all V3 screens
 * live under "/auth-v3/*" as a self-contained mini-application.
 *
 * Rule: do NOT add any auth logic here. All logic lives in app/auth-v3/*.
 */

import { Redirect } from "expo-router";

export default function LoginV3Entry() {
  return <Redirect href="/auth-v3/welcome" />;
}
