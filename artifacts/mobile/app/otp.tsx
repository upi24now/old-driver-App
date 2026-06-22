/**
 * otp.tsx — dead route stub
 *
 * OTP is now handled inline in login.tsx (combined phone + OTP screen).
 * This file exists only because Stack.Screen name="otp" is still registered
 * in _layout.tsx. Any direct navigation to /otp will redirect to /login.
 */

import { useEffect } from "react";
import { useRouter } from "expo-router";
import { View, ActivityIndicator } from "react-native";

export default function OtpRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF8F5" }}>
      <ActivityIndicator size="large" color="#F59E0B" />
    </View>
  );
}
