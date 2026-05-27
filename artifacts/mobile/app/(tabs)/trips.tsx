import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

const PLACEHOLDER_TRIPS = [
  { id: "1", from: "123 Main St", to: "456 Oak Ave", fare: "$12.50", date: "Today, 9:14 AM", status: "completed" },
  { id: "2", from: "Central Park", to: "JFK Airport", fare: "$48.00", date: "Today, 7:02 AM", status: "completed" },
  { id: "3", from: "Times Square", to: "Brooklyn Bridge", fare: "$21.75", date: "Yesterday, 6:30 PM", status: "completed" },
];

export default function TripsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.headerBar,
          { paddingTop: insets.top + 16, backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.title, { color: colors.foreground }]}>Trip History</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          [ Filter / date range picker ]
        </Text>
      </View>

      <View
        style={[
          styles.summaryRow,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>—</Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Trips</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>—</Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Total Earned</Text>
        </View>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.foreground }]}>—</Text>
          <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Avg Rating</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          Recent Trips (placeholder data)
        </Text>
        {PLACEHOLDER_TRIPS.map((trip) => (
          <View
            key={trip.id}
            style={[
              styles.tripCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.tripLeft}>
              <View style={styles.routeRow}>
                <Feather name="circle" size={10} color={colors.primary} />
                <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
                  {trip.from}
                </Text>
              </View>
              <View style={[styles.routeLine, { backgroundColor: colors.border }]} />
              <View style={styles.routeRow}>
                <Feather name="map-pin" size={10} color={colors.destructive} />
                <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
                  {trip.to}
                </Text>
              </View>
              <Text style={[styles.tripDate, { color: colors.mutedForeground }]}>{trip.date}</Text>
            </View>
            <View style={styles.tripRight}>
              <Text style={[styles.tripFare, { color: colors.foreground }]}>{trip.fare}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </View>
          </View>
        ))}

        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Trip detail navigates to /trip/[id] ]
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 2,
  },
  title: { fontSize: 24, fontWeight: "700" },
  subtitle: { fontSize: 13, fontStyle: "italic" },
  summaryRow: {
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 2 },
  summaryValue: { fontSize: 18, fontWeight: "700" },
  summaryLabel: { fontSize: 11, fontWeight: "500" },
  divider: { width: 1, marginVertical: 4 },
  list: { padding: 16, gap: 10 },
  sectionLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  tripCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  tripLeft: { flex: 1, gap: 3 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { fontSize: 14, fontWeight: "500", flex: 1 },
  routeLine: { width: 1, height: 10, marginLeft: 4 },
  tripDate: { fontSize: 12, marginTop: 4 },
  tripRight: { alignItems: "flex-end", gap: 4 },
  tripFare: { fontSize: 16, fontWeight: "700" },
  placeholder: { fontSize: 13, fontStyle: "italic", textAlign: "center", marginTop: 8 },
});
