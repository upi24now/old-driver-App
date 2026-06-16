import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";

export default function AccountBlockedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { accountStatus, signOut } = useDriver();

  const isBlacklisted = accountStatus === "blacklisted";

  const title   = isBlacklisted ? "Account Blacklisted" : "Account Suspended";
  const icon    = isBlacklisted ? "account-cancel"      : "account-lock";
  const message = isBlacklisted
    ? "Your account has been permanently blacklisted.\nPlease contact support for further assistance."
    : "Your account has been suspended by the admin.\nContact support to resolve this issue.";

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop:       insets.top + 24,
          paddingBottom:    insets.bottom + 24,
        },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <View style={[styles.iconWrap, { backgroundColor: colors.errorSoft }]}>
          <MaterialCommunityIcons name={icon} size={56} color={colors.error} />
        </View>

        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>

        <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.contactLabel, { color: colors.textMuted }]}>
            Need help? Contact support
          </Text>
          <Text style={[styles.contactValue, { color: colors.primary }]}>
            support@bikecourierservice.com
          </Text>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.logoutBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
        onPress={() => void signOut()}
        activeOpacity={0.7}
      >
        <Text style={[styles.logoutText, { color: colors.textSecondary }]}>Log Out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow:          1,
    alignItems:        "center",
    justifyContent:    "center",
    paddingHorizontal: 32,
    paddingVertical:   32,
  },
  iconWrap: {
    width:          100,
    height:         100,
    borderRadius:   50,
    alignItems:     "center",
    justifyContent: "center",
    marginBottom:   28,
  },
  title: {
    fontSize:     24,
    fontWeight:   "700",
    textAlign:    "center",
    marginBottom: 12,
    fontFamily:   "Inter_700Bold",
  },
  message: {
    fontSize:     15,
    lineHeight:   23,
    textAlign:    "center",
    marginBottom: 36,
    fontFamily:   "Inter_400Regular",
  },
  contactCard: {
    width:        "100%",
    borderRadius: 12,
    borderWidth:  1,
    padding:      20,
    alignItems:   "center",
    gap:          6,
  },
  contactLabel: {
    fontSize:   13,
    fontFamily: "Inter_400Regular",
  },
  contactValue: {
    fontSize:   14,
    fontWeight: "600",
    fontFamily: "Inter_600SemiBold",
  },
  logoutBtn: {
    marginHorizontal: 24,
    borderRadius:     12,
    borderWidth:      1,
    paddingVertical:  14,
    alignItems:       "center",
  },
  logoutText: {
    fontSize:   15,
    fontWeight: "500",
    fontFamily: "Inter_500Medium",
  },
});
