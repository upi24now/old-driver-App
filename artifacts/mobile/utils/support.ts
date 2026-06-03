import { Alert, Linking } from "react-native";

export const SUPPORT_PHONE = "8545937468";
export const SUPPORT_EMAIL = "help@bikecourierservice.in";

/**
 * Open the native phone dialer pre-filled with the support number.
 * Falls back to an Alert showing both contact options if the dialer cannot open.
 * No crash on failure.
 */
export function callSupport(): void {
  Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {
    Alert.alert(
      "Call Support",
      `Please call ${SUPPORT_PHONE} or email ${SUPPORT_EMAIL}`,
      [{ text: "OK" }],
    );
  });
}
