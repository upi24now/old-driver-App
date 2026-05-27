import { Feather } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.mapArea,
          { backgroundColor: colors.muted, flex: 1 },
        ]}
      >
        <Feather name="map" size={48} color={colors.mutedForeground} />
        <Text style={[styles.mapLabel, { color: colors.mutedForeground }]}>
          [ Map View ]
        </Text>
        <Text style={[styles.mapNote, { color: colors.mutedForeground }]}>
          react-native-maps will render here
        </Text>
      </View>

      <View
        style={[
          styles.bottomSheet,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />

        <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
          Navigation
        </Text>

        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <Text style={[styles.searchText, { color: colors.mutedForeground }]}>
            [ Search destination ]
          </Text>
        </View>

        <View style={styles.infoRow}>
          <View
            style={[
              styles.infoChip,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <Feather name="navigation" size={14} color={colors.primary} />
            <Text style={[styles.infoChipText, { color: colors.foreground }]}>
              ETA: —
            </Text>
          </View>
          <View
            style={[
              styles.infoChip,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <Feather name="map-pin" size={14} color={colors.primary} />
            <Text style={[styles.infoChipText, { color: colors.foreground }]}>
              Distance: —
            </Text>
          </View>
        </View>

        <Text style={[styles.placeholder, { color: colors.mutedForeground }]}>
          [ Start Navigation / Recenter / Traffic toggle ]
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  mapArea: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  mapLabel: { fontSize: 18, fontWeight: "600" },
  mapNote: { fontSize: 13 },
  bottomSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingTop: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 4,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchText: { fontSize: 14 },
  infoRow: { flexDirection: "row", gap: 10 },
  infoChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  infoChipText: { fontSize: 13, fontWeight: "500" },
  placeholder: { fontSize: 13, fontStyle: "italic", textAlign: "center" },
});
