import { Feather } from "@expo/vector-icons";
import { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useDriver } from "@/contexts/DriverContext";
import { useColors } from "@/hooks/useColors";
import { getDriverCompletedTrips, type CompletedTrip } from "@/utils/firestore";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDeliveredAt(ms: number | null): string {
  if (!ms) return "—";
  const d     = new Date(ms);
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yest  = new Date(today.getTime() - 86_400_000);
  const dDay  = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });

  if (dDay.getTime() === today.getTime()) return `Today, ${time}`;
  if (dDay.getTime() === yest.getTime())  return `Yesterday, ${time}`;

  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + `, ${time}`;
}

function fmt(n: number): string {
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

// ─── TripCard ──────────────────────────────────────────────────────────────────
function TripCard({ trip }: { trip: CompletedTrip }) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: "#fff", borderColor: colors.border }]}>
      {/* Header row: customer + badge */}
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <View style={[styles.avatarCircle, { backgroundColor: "#e8f5e9" }]}>
            <Feather name="user" size={13} color="#2e7d32" />
          </View>
          <View>
            <Text style={[styles.customerName, { color: colors.foreground }]} numberOfLines={1}>
              {trip.customerName || "Customer"}
            </Text>
            <Text style={[styles.deliveredAt, { color: colors.mutedForeground }]}>
              {formatDeliveredAt(trip.deliveredAt)}
            </Text>
          </View>
        </View>
        <View style={styles.deliveredBadge}>
          <Feather name="check-circle" size={10} color="#2e7d32" />
          <Text style={styles.deliveredBadgeText}>Delivered</Text>
        </View>
      </View>

      {/* Route */}
      <View style={[styles.routeBox, { borderColor: colors.border }]}>
        <View style={styles.routeRow}>
          <View style={styles.routeDotGreen} />
          <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
            {trip.pickupAddress || "Pickup"}
          </Text>
        </View>
        <View style={[styles.routeConnector, { backgroundColor: colors.border }]} />
        <View style={styles.routeRow}>
          <View style={styles.routeDotRed} />
          <Text style={[styles.routeText, { color: colors.foreground }]} numberOfLines={1}>
            {trip.dropAddress || "Drop"}
          </Text>
        </View>
      </View>

      {/* Footer row: fare + payment mode + distance */}
      <View style={styles.cardFooter}>
        <Text style={[styles.fare, { color: colors.foreground }]}>
          ₹{fmt(trip.fareEstimate)}
        </Text>
        <View style={styles.footerMeta}>
          {trip.distanceKm != null && (
            <>
              <View style={[styles.metaPill, { backgroundColor: "#f5f5f5" }]}>
                <Feather name="map" size={10} color={colors.mutedForeground} />
                <Text style={[styles.metaPillText, { color: colors.mutedForeground }]}>
                  {trip.distanceKm.toFixed(1)} km
                </Text>
              </View>
            </>
          )}
          <View style={[
            styles.metaPill,
            { backgroundColor: trip.paymentMode === "Cash" ? "#fff8f0" : "#e3f2fd" },
          ]}>
            <Feather
              name={trip.paymentMode === "Cash" ? "dollar-sign" : "smartphone"}
              size={10}
              color={trip.paymentMode === "Cash" ? "#b75d00" : "#1976D2"}
            />
            <Text style={[
              styles.metaPillText,
              { color: trip.paymentMode === "Cash" ? "#b75d00" : "#1976D2" },
            ]}>
              {trip.paymentMode || "Cash"}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function TripsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { driverUid } = useDriver();

  const [trips,     setTrips]     = useState<CompletedTrip[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [refreshing,setRefreshing]= useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [indexMissing, setIndexMissing] = useState(false);

  const loadTrips = useCallback(async (isRefresh = false) => {
    if (!driverUid) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    setIndexMissing(false);
    try {
      const data = await getDriverCompletedTrips(driverUid, 20);
      setTrips(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Firestore missing-index errors contain "FAILED_PRECONDITION" or "requires an index"
      if (msg.includes("FAILED_PRECONDITION") || msg.includes("requires an index") || msg.includes("index")) {
        setIndexMissing(true);
      } else {
        setError("Could not load trips. Please try again.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driverUid]);

  useEffect(() => { loadTrips(); }, [loadTrips]);

  // ── Summary calculations ────────────────────────────────────────────────────
  const totalTrips  = trips.length;
  const totalEarned = trips.reduce((sum, t) => sum + (t.fareEstimate ?? 0), 0);
  const avgTrip     = totalTrips > 0 ? Math.round(totalEarned / totalTrips) : 0;

  // ── Render helpers ──────────────────────────────────────────────────────────
  const renderBody = () => {
    if (loading) {
      return (
        <View style={styles.centeredState}>
          <ActivityIndicator size="large" color="#00C853" />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Loading trips…
          </Text>
        </View>
      );
    }

    if (indexMissing) {
      return (
        <View style={[styles.indexBox, { borderColor: "#ffd54f", backgroundColor: "#fffde7" }]}>
          <Feather name="alert-triangle" size={22} color="#f57f17" />
          <Text style={styles.indexTitle}>Firestore Index Required</Text>
          <Text style={styles.indexBody}>
            The trips query needs a composite index. Create it in the Firebase Console:
          </Text>
          <View style={styles.indexSpec}>
            <Text style={styles.indexSpecText}>Collection: <Text style={styles.indexSpecBold}>orders</Text></Text>
            <Text style={styles.indexSpecText}>driverUid   — Ascending</Text>
            <Text style={styles.indexSpecText}>status      — Ascending</Text>
            <Text style={styles.indexSpecText}>deliveredAt — Descending</Text>
          </View>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={() => loadTrips()}
            activeOpacity={0.75}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (error) {
      return (
        <View style={styles.centeredState}>
          <Feather name="wifi-off" size={28} color={colors.mutedForeground} />
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>{error}</Text>
          <TouchableOpacity
            style={[styles.retryBtn, { alignSelf: "center" }]}
            onPress={() => loadTrips()}
            activeOpacity={0.75}
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (trips.length === 0) {
      return (
        <View style={styles.centeredState}>
          <Feather name="package" size={36} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No completed trips yet
          </Text>
          <Text style={[styles.stateText, { color: colors.mutedForeground }]}>
            Completed deliveries will appear here.
          </Text>
        </View>
      );
    }

    return trips.map((t) => <TripCard key={t.orderId} trip={t} />);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>Trip History</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Last {totalTrips > 0 ? `${totalTrips} delivered orders` : "20 orders"}
          </Text>
        </View>
        {!loading && (
          <TouchableOpacity
            onPress={() => loadTrips(false)}
            style={[styles.refreshBtn, { backgroundColor: "#f5f5f5" }]}
            activeOpacity={0.7}
          >
            <Feather name="refresh-cw" size={15} color="#0a0a0a" />
          </TouchableOpacity>
        )}
      </View>

      {/* Summary cards */}
      <View style={[styles.summaryRow, { backgroundColor: "#fff", borderBottomColor: colors.border }]}>
        {[
          { label: "Total Trips",  value: loading ? "—" : `${totalTrips}` },
          { label: "Total Earned", value: loading ? "—" : `₹${fmt(totalEarned)}` },
          { label: "Avg Trip",     value: loading ? "—" : totalTrips > 0 ? `₹${fmt(avgTrip)}` : "—" },
        ].map((s, i, arr) => (
          <View key={s.label} style={{ flex: 1, flexDirection: "row" }}>
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: colors.foreground }]}>{s.value}</Text>
              <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
            </View>
            {i < arr.length - 1 && (
              <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            )}
          </View>
        ))}
      </View>

      {/* List with pull-to-refresh */}
      <ScrollView
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadTrips(true)}
            tintColor="#00C853"
            colors={["#00C853"]}
          />
        }
      >
        {renderBody()}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1 },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  title:    { fontSize: 22, fontWeight: "800", color: "#0a0a0a", letterSpacing: -0.3 },
  subtitle: { fontSize: 12, fontWeight: "500", marginTop: 1 },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
  },

  summaryRow: {
    flexDirection: "row",
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  summaryItem:    { flex: 1, alignItems: "center", gap: 2 },
  summaryValue:   { fontSize: 17, fontWeight: "800", letterSpacing: -0.2 },
  summaryLabel:   { fontSize: 10, fontWeight: "600", letterSpacing: 0.2 },
  summaryDivider: { width: 1, marginVertical: 4 },

  list: { padding: 14, gap: 10, paddingBottom: 32 },

  // States
  centeredState: {
    paddingVertical: 48,
    alignItems: "center",
    gap: 10,
  },
  stateText:  { fontSize: 13, fontWeight: "500", textAlign: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", marginTop: 4 },

  retryBtn: {
    marginTop: 6,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "#0a0a0a",
    borderRadius: 20,
  },
  retryBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },

  indexBox: {
    margin: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  indexTitle:    { fontSize: 15, fontWeight: "800", color: "#f57f17" },
  indexBody:     { fontSize: 12, fontWeight: "500", color: "#795548", textAlign: "center", lineHeight: 18 },
  indexSpec: {
    alignSelf: "stretch",
    backgroundColor: "#fff8e1",
    borderRadius: 8,
    padding: 10,
    gap: 3,
    marginTop: 2,
  },
  indexSpecText: { fontSize: 12, color: "#5d4037" },
  indexSpecBold: { fontWeight: "700" },

  // Trip card
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  cardHeader:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardHeaderLeft:{ flexDirection: "row", alignItems: "center", gap: 9, flex: 1 },
  avatarCircle:  { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  customerName:  { fontSize: 13, fontWeight: "700" },
  deliveredAt:   { fontSize: 11, fontWeight: "500", marginTop: 1 },

  deliveredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#e8f5e9",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  deliveredBadgeText: { fontSize: 10, fontWeight: "700", color: "#2e7d32" },

  routeBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
    backgroundColor: "#fafafa",
  },
  routeRow:      { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText:     { fontSize: 12, fontWeight: "600", flex: 1 },
  routeDotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#00C853", flexShrink: 0 },
  routeDotRed:   { width: 8, height: 8, borderRadius: 4, backgroundColor: "#F44336", flexShrink: 0 },
  routeConnector:{ width: 1, height: 8, marginLeft: 3.5, backgroundColor: "#e0e0e0" },

  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  fare:       { fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },
  footerMeta: { flexDirection: "row", gap: 6 },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  metaPillText: { fontSize: 10, fontWeight: "700" },
});
