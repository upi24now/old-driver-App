import { Alert, Linking } from "react-native";

/**
 * Support phone number — replace before production release.
 * Used by callSupport() across all screens.
 */
export const SUPPORT_PHONE = "+91XXXXXXXXXX";

/**
 * Open the native phone dialer pre-filled with the support number.
 * Falls back to an Alert showing the number if the dialer cannot open.
 * No crash on failure.
 */
export function callSupport(): void {
  Linking.openURL(`tel:${SUPPORT_PHONE}`).catch(() => {
    Alert.alert(
      "Call Support",
      `Unable to open the phone app. Please call us at ${SUPPORT_PHONE}.`,
      [{ text: "OK" }],
    );
  });
}
