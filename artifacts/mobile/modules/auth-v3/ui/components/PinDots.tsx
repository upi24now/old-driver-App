/**
 * COMPARTMENT 8 (UI sub-layer) — PinDots Component
 *
 * Single responsibility: render filled/empty/error PIN progress dots.
 * Zero business logic — driven entirely by props.
 *
 * Rules:
 *   ✓ Pure presentation
 *   ✗ No auth logic, no API calls, no navigation, no storage
 *
 * Debugging scope: if PIN dots are the wrong colour, count, or size → this file.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import { COLORS } from "../../config";

// ─── Types ────────────────────────────────────────────────────────────────────

type PinDotsProps = {
  length: number;
  filled: number;
  error?: boolean;
};

// ─── Component ───────────────────────────────────────────────────────────────

export function PinDots({ length, filled, error = false }: PinDotsProps) {
  return (
    <View style={ss.row}>
      {Array.from({ length }).map((_, i) => (
        <View
          key={i}
          style={[
            ss.dot,
            i < filled && (error ? ss.dotError : ss.dotFilled),
          ]}
        />
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  row:       {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    paddingVertical: 24,
  },
  dot:       {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: COLORS.border,
    borderWidth: 1.5, borderColor: COLORS.border,
  },
  dotFilled: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  dotError:  { backgroundColor: COLORS.error,   borderColor: COLORS.error },
});
