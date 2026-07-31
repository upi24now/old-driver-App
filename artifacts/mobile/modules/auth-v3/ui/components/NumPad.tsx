/**
 * COMPARTMENT 8 (UI sub-layer) — NumPad Component
 *
 * Single responsibility: render a 3×4 numeric keypad and emit digit/delete
 * callbacks. Contains zero business logic.
 *
 * Rules:
 *   ✓ Pure presentation — receives callbacks, renders nothing else
 *   ✗ No auth logic, no API calls, no navigation, no storage
 *
 * Debugging scope: if keypad buttons are mis-labelled, misaligned, or
 *   unresponsive → this file.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { COLORS } from "../../config";

// ─── Types ────────────────────────────────────────────────────────────────────

type NumPadProps = {
  onDigit:  (digit: string) => void;
  onDelete: () => void;
  disabled?: boolean;
};

// ─── Layout ───────────────────────────────────────────────────────────────────

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["",  "0", "⌫"],
] as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function NumPad({ onDigit, onDelete, disabled = false }: NumPadProps) {
  return (
    <View style={ss.grid}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={ss.row}>
          {row.map((key, ki) => {
            if (key === "") {
              return <View key={ki} style={ss.key} />;
            }
            const isDelete = key === "⌫";
            return (
              <Pressable
                key={ki}
                style={({ pressed }) => [
                  ss.key,
                  pressed && !disabled && ss.keyPressed,
                  disabled && ss.keyDisabled,
                ]}
                onPress={() => {
                  if (disabled) return;
                  isDelete ? onDelete() : onDigit(key);
                }}
                accessibilityRole="button"
                accessibilityLabel={isDelete ? "Delete" : key}
              >
                <Text style={[ss.keyLabel, isDelete && ss.deleteLabel]}>
                  {key}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const ss = StyleSheet.create({
  grid:        { paddingHorizontal: 24, gap: 4 },
  row:         { flexDirection: "row", gap: 4 },
  key:         {
    flex: 1, height: 72, borderRadius: 16,
    alignItems: "center", justifyContent: "center",
    backgroundColor: COLORS.inputBg,
  },
  keyPressed:  { backgroundColor: COLORS.border },
  keyDisabled: { opacity: 0.4 },
  keyLabel:    { fontSize: 24, fontWeight: "600", color: COLORS.text },
  deleteLabel: { fontSize: 20 },
});
