import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, View, ScrollView, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function TripDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Trip Detail
        </Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.tripId, { color: colors.mutedForeground }]}>
          Trip #{id ?? "—"}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Route</Text>
          <View style={styles.routeRow}>
            <Feather name="circle" size={10} color={colors.primary} />
            <View style={styles.routeText}>
              <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Pickup</Text>
              <Text style={[styles.routeValue, { color: colors.foreground }]}>
                [ Pickup address ]
              </Text>
            </View>
          </View>
          <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
          <View style={styles.routeRow}>
            <Feather name="map-pin" size={10} color={colors.destructive} />
            <View style={styles.routeText}>
              <Text style={[styles.routeLabel, { color: colors.mutedForeground }]}>Dropoff</Text>
              <Text style={[styles.routeValue, { color: colors.foreground }]}>
                [ Dropoff address ]
              </Text>
            </View>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Fare Breakdown</Text>
          {[
            { label: "Base fare", value: "—" },
            { label: "Distance", value: "—" },
            { label: "Time", value: "—" },
            { label: "Surge", value: "—" },
            { label: "Tips", value: "—" },
          ].map((row) => (
            <View key={row.label} style={styles.fareRow}>
              <Text style={[styles.fareLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
              <Text style={[styles.fareValue, { color: colors.foreground }]}>{row.value}</Text>
            </View>
          ))}
          <View style={[styles.fareDivider, { backgroundColor: colors.border }]} />
          <View style={styles.fareRow}>
            <Text style={[styles.fareTotal, { color: colors.foreground }]}>Total</Text>
            <Text style={[styles.fareTotal, { color: colors.primary }]}>$—</Text>
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Rider</Text>
          <View style={styles.riderRow}>
            <View style={[styles.riderAvatar, { backgroundColor: colors.muted }]}>
              <Feather name="user" size={20} color={colors.mutedForeground} />
            </View>
            <View style={styles.riderInfo}>
              <Text style={[styles.riderName, { color: colors.foreground }]}>Rider Name</Text>
              <View style={styles.ratingRow}>
                <Feather name="star" size={12} color={colors.primary} />
                <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>4.8</Text>
              </View>
            </View>
          </View>
        </View>

        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Map snapshot of route, Report issue CTA ]
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  content: { padding: 16, gap: 14 },
  tripId: { fontSize: 13, fontWeight: "500" },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  routeRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  routeText: { flex: 1, gap: 1 },
  routeLabel: { fontSize: 11, fontWeight: "500" },
  routeValue: { fontSize: 14, fontWeight: "500" },
  routeLine: { width: 1, height: 10, marginLeft: 4 },
  fareRow: { flexDirection: "row", justifyContent: "space-between" },
  fareLabel: { fontSize: 14 },
  fareValue: { fontSize: 14, fontWeight: "500" },
  fareDivider: { height: 1 },
  fareTotal: { fontSize: 16, fontWeight: "700" },
  riderRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  riderAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  riderInfo: { gap: 2 },
  riderName: { fontSize: 15, fontWeight: "600" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  ratingText: { fontSize: 12 },
  placeholder: { fontSize: 13, fontStyle: "italic", textAlign: "center", paddingVertical: 8 },
});
