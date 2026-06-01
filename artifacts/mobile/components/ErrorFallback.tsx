import { Feather } from "@expo/vector-icons";
import { reloadAppAsync } from "expo";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Hardcoded fallback palette — never depends on ThemeProvider.
// ErrorFallback is rendered by ErrorBoundary which sits OUTSIDE ThemeProvider,
// so useColors() / useTheme() would throw "must be used within ThemeProvider".
const C = {
  background:        "#FFFFFF",
  card:              "#F9FAFB",
  foreground:        "#111827",
  mutedForeground:   "#6B7280",
  primary:           "#FF4D8D",
  primaryForeground: "#FFFFFF",
  border:            "#E5E7EB",
  errorBg:           "#FEF2F2",
  errorBorder:       "#FECACA",
  errorText:         "#991B1B",
  stackBg:           "#1E1E1E",
  stackText:         "#D4D4D4",
} as const;

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

const monoFont = Platform.select({
  ios:     "Menlo",
  android: "monospace",
  default: "monospace",
});

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const insets = useSafeAreaInsets();

  const handleRestart = async () => {
    try {
      await reloadAppAsync();
    } catch {
      resetError();
    }
  };

  const message = error?.message ?? "(no message)";
  const stack   = error?.stack   ?? "(no stack)";

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: C.background,
          paddingTop:    insets.top    + 16,
          paddingBottom: insets.bottom + 16,
        },
      ]}
    >
      {/* ── Header ── */}
      <View style={styles.header}>
        <Feather name="alert-triangle" size={24} color={C.errorText} />
        <Text style={[styles.title, { color: C.foreground }]}>
          Something went wrong
        </Text>
      </View>

      {/* ── Error message (always visible) ── */}
      <View style={[styles.messageBubble, { backgroundColor: C.errorBg, borderColor: C.errorBorder }]}>
        <Text style={[styles.label, { color: C.errorText }]}>ERROR MESSAGE</Text>
        <Text
          style={[styles.messageText, { color: C.errorText, fontFamily: monoFont }]}
          selectable
        >
          {message}
        </Text>
      </View>

      {/* ── Stack trace (scrollable, selectable) ── */}
      <Text style={[styles.label, { color: C.mutedForeground, marginLeft: 4 }]}>
        STACK TRACE
      </Text>
      <ScrollView
        style={[styles.stackScroll, { backgroundColor: C.stackBg }]}
        contentContainerStyle={styles.stackContent}
        showsVerticalScrollIndicator
        nestedScrollEnabled
      >
        <Text
          style={[styles.stackText, { fontFamily: monoFont, color: C.stackText }]}
          selectable
        >
          {stack}
        </Text>
      </ScrollView>

      {/* ── Try Again button ── */}
      <Pressable
        onPress={handleRestart}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: C.primary,
            opacity:   pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          },
        ]}
      >
        <Text style={[styles.buttonText, { color: C.primaryForeground }]}>
          Try Again
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems:    "center",
    gap: 10,
    marginBottom: 4,
  },
  title: {
    fontSize:   20,
    fontWeight: "700",
  },
  label: {
    fontSize:    10,
    fontWeight:  "700",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  messageBubble: {
    borderWidth:  1,
    borderRadius: 8,
    padding:      12,
    gap: 4,
  },
  messageText: {
    fontSize:   13,
    lineHeight: 20,
  },
  stackScroll: {
    flex:         1,
    borderRadius: 8,
    minHeight:    120,
  },
  stackContent: {
    padding: 12,
  },
  stackText: {
    fontSize:   11,
    lineHeight: 17,
  },
  button: {
    paddingVertical:   14,
    paddingHorizontal: 24,
    borderRadius:      8,
    alignItems:        "center",
  },
  buttonText: {
    fontSize:   16,
    fontWeight: "600",
  },
});
