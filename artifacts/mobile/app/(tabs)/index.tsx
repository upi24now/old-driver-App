import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + 16 },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.greeting, { color: colors.mutedForeground }]}>
          Good morning
        </Text>
        <Text style={[styles.name, { color: colors.foreground }]}>
          Driver Dashboard
        </Text>
      </View>

      <View
        style={[
          styles.statusCard,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={styles.statusRow}>
          <View
            style={[styles.statusDot, { backgroundColor: colors.offline }]}
          />
          <Text style={[styles.statusLabel, { color: colors.mutedForeground }]}>
            Status
          </Text>
        </View>
        <Text style={[styles.statusValue, { color: colors.foreground }]}>
          Offline
        </Text>
        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Go Online / Offline toggle ]
        </Text>
      </View>

      <View style={styles.statsRow}>
        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="dollar-sign" size={20} color={colors.primary} />
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            —
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Today's Earnings
          </Text>
        </View>

        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="navigation" size={20} color={colors.primary} />
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            —
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Trips Today
          </Text>
        </View>

        <View
          style={[
            styles.statCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="star" size={20} color={colors.primary} />
          <Text style={[styles.statValue, { color: colors.foreground }]}>
            —
          </Text>
          <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
            Rating
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.section,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Incoming Request
        </Text>
        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Trip request card with Accept / Decline ]
        </Text>
      </View>

      <View
        style={[
          styles.section,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          Active Trip
        </Text>
        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Active trip status, pickup / dropoff info, navigation CTA ]
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  greeting: {
    fontSize: 14,
    fontWeight: "500",
  },
  name: {
    fontSize: 24,
    fontWeight: "700",
  },
  statusCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  statusValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
  },
  statCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  statLabel: {
    fontSize: 10,
    fontWeight: "500",
    textAlign: "center",
  },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
  },
  placeholder: {
    fontSize: 13,
    fontStyle: "italic",
  },
});
