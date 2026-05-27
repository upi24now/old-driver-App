import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const MENU_SECTIONS = [
  {
    title: "Account",
    items: [
      { icon: "user", label: "Personal Info", note: "Name, phone, email" },
      { icon: "credit-card", label: "Payment Methods", note: "Bank, payout settings" },
      { icon: "file-text", label: "Documents", note: "License, insurance" },
    ],
  },
  {
    title: "Vehicle",
    items: [
      { icon: "truck", label: "My Vehicle", note: "Car details, inspection" },
      { icon: "shield", label: "Insurance", note: "Coverage details" },
    ],
  },
  {
    title: "App",
    items: [
      { icon: "bell", label: "Notifications", note: "Trip alerts, promotions" },
      { icon: "help-circle", label: "Help & Support", note: "FAQ, contact" },
      { icon: "info", label: "About", note: "Version 1.0.0" },
    ],
  },
];

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}
    >
      <View
        style={[
          styles.profileCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
          <Feather name="user" size={32} color={colors.mutedForeground} />
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: colors.foreground }]}>
            Driver Name
          </Text>
          <Text style={[styles.profileSub, { color: colors.mutedForeground }]}>
            driver@example.com
          </Text>
          <View style={styles.ratingRow}>
            <Feather name="star" size={13} color={colors.primary} />
            <Text style={[styles.ratingText, { color: colors.foreground }]}>4.92</Text>
            <Text style={[styles.ratingCount, { color: colors.mutedForeground }]}>
              (1,204 trips)
            </Text>
          </View>
        </View>
        <TouchableOpacity>
          <Feather name="edit-2" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.earningsCard,
          { backgroundColor: colors.primary },
        ]}
      >
        <Text style={[styles.earningsLabel, { color: "rgba(255,255,255,0.75)" }]}>
          This Week's Earnings
        </Text>
        <Text style={[styles.earningsValue, { color: "#FFFFFF" }]}>$—</Text>
        <Text style={[styles.placeholder, { color: "rgba(255,255,255,0.6)" }]}>
          [ Earnings breakdown / payout CTA ]
        </Text>
      </View>

      {MENU_SECTIONS.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {section.title.toUpperCase()}
          </Text>
          <View
            style={[
              styles.sectionCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            {section.items.map((item, idx) => (
              <View key={item.label}>
                <TouchableOpacity style={styles.menuRow}>
                  <View
                    style={[
                      styles.iconWrap,
                      { backgroundColor: colors.secondary },
                    ]}
                  >
                    <Feather name={item.icon as any} size={16} color={colors.primary} />
                  </View>
                  <View style={styles.menuText}>
                    <Text style={[styles.menuLabel, { color: colors.foreground }]}>
                      {item.label}
                    </Text>
                    <Text style={[styles.menuNote, { color: colors.mutedForeground }]}>
                      {item.note}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
                {idx < section.items.length - 1 && (
                  <View style={[styles.separator, { backgroundColor: colors.border }]} />
                )}
              </View>
            ))}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[
          styles.logoutBtn,
          { borderColor: colors.destructive },
        ]}
      >
        <Feather name="log-out" size={16} color={colors.destructive} />
        <Text style={[styles.logoutText, { color: colors.destructive }]}>Sign Out</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, gap: 16 },
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  profileInfo: { flex: 1, gap: 2 },
  profileName: { fontSize: 18, fontWeight: "700" },
  profileSub: { fontSize: 13 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  ratingText: { fontSize: 13, fontWeight: "600" },
  ratingCount: { fontSize: 12 },
  earningsCard: {
    borderRadius: 14,
    padding: 18,
    gap: 4,
  },
  earningsLabel: { fontSize: 13, fontWeight: "500" },
  earningsValue: { fontSize: 32, fontWeight: "800" },
  section: { gap: 6 },
  sectionLabel: { fontSize: 11, fontWeight: "600", letterSpacing: 0.6, paddingLeft: 4 },
  sectionCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: { flex: 1, gap: 1 },
  menuLabel: { fontSize: 15, fontWeight: "500" },
  menuNote: { fontSize: 12 },
  separator: { height: 1, marginLeft: 58 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 14,
    marginTop: 4,
  },
  logoutText: { fontSize: 15, fontWeight: "600" },
  placeholder: { fontSize: 12, fontStyle: "italic", marginTop: 4 },
});
