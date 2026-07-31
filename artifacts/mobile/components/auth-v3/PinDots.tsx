/**
 * PinDots — row of filled/empty circles visualising PIN progress.
 * Used by pin.tsx, create-pin.tsx, confirm-pin.tsx.
 * No B2 dependencies.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

interface PinDotsProps {
  length:  number;   // total number of dots (typically 6)
  filled:  number;   // how many are filled (= digits entered so far)
  error?:  boolean;  // when true, filled dots turn red
}

export function PinDots({ length, filled, error = false }: PinDotsProps) {
  return (
    <View style={ss.row}>
      {Array.from({ length }).map((_, i) => (
        <View
          key={i}
          style={[
            ss.dot,
            i < filled
              ? error ? ss.dotError : ss.dotFilled
              : ss.dotEmpty,
          ]}
        />
      ))}
    </View>
  );
}

const ss = StyleSheet.create({
  row:       { flexDirection: "row", justifyContent: "center", gap: 14, marginVertical: 28 },
  dot:       { width: 18, height: 18, borderRadius: 9 },
  dotFilled: { backgroundColor: "#FF6B00" },
  dotError:  { backgroundColor: "#DC2626" },
  dotEmpty:  { backgroundColor: "transparent", borderWidth: 2, borderColor: "#D1D5DB" },
});
