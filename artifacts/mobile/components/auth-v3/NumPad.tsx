/**
 * NumPad — shared numeric keypad for V3 PIN and OTP entry screens.
 * No B2 dependencies.
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["",  "0", "⌫"],
] as const;

interface NumPadProps {
  onDigit:   (digit: string) => void;
  onDelete:  () => void;
  disabled?: boolean;
}

export function NumPad({ onDigit, onDelete, disabled = false }: NumPadProps) {
  return (
    <View style={ss.grid}>
      {ROWS.map((row, ri) => (
        <View key={ri} style={ss.row}>
          {row.map((key, ci) => {
            if (key === "") return <View key={ci} style={ss.key} />;

            const isDelete = key === "⌫";
            return (
              <Pressable
                key={ci}
                style={({ pressed }) => [ss.key, pressed && !disabled && ss.keyPressed]}
                onPress={() => (isDelete ? onDelete() : onDigit(key))}
                disabled={disabled}
                accessible
                accessibilityLabel={isDelete ? "Delete" : key}
                accessibilityRole="button"
              >
                <Text style={[ss.keyLabel, isDelete && ss.deleteLabel]}>{key}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const ss = StyleSheet.create({
  grid:        { width: "100%", paddingHorizontal: 16 },
  row:         { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  key:         {
    flex: 1,
    aspectRatio: 1.8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    marginHorizontal: 4,
  },
  keyPressed:  { backgroundColor: "#F3F4F6" },
  keyLabel:    { fontSize: 24, fontWeight: "600", color: "#111111" },
  deleteLabel: { fontSize: 22 },
});
