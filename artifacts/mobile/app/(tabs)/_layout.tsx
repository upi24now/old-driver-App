import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

// Minimal subset of BottomTabBarProps — avoids depending on @react-navigation/bottom-tabs directly
type TabBarProps = {
  state: {
    index: number;
    routes: Array<{ key: string; name: string }>;
  };
  navigation: { navigate: (name: string) => void };
  descriptors: Record<string, unknown>;
};

// ─── Per-tab accent config ────────────────────────────────────────────────────
const TAB_CFG: Record<string, { icon: string; color: string; label: string }> = {
  index:   { icon: "home",  color: "#FF4D8D", label: "Home"    },
  trips:   { icon: "list",  color: "#4A90E2", label: "Trips"   },
  map:     { icon: "map",   color: "#00BCD4", label: "Map"     },
  profile: { icon: "user",  color: "#9C27B0", label: "Profile" },
};

const BAR_H = 62;

// ─── GlassTabBar ──────────────────────────────────────────────────────────────
function GlassTabBar({ state, navigation }: TabBarProps) {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const isIOS   = Platform.OS === "ios";

  return (
    <View
      pointerEvents="box-none"
      style={[s.outer, { paddingBottom: (insets.bottom || 0) + 8 }]}
    >
      {/* ── floating pill ──────────────────────────────────────────────── */}
      <View
        style={[
          s.pill,
          {
            backgroundColor: isIOS ? "transparent" : colors.card,
            // dual shadow: wide-soft layer
            shadowColor: "#000",
          },
        ]}
      >
        {/* frosted glass (iOS only) */}
        {isIOS && (
          <BlurView
            intensity={75}
            tint="systemUltraThinMaterial"
            style={StyleSheet.absoluteFill}
          />
        )}

        {/* hairline border overlay */}
        <View
          style={[
            s.border,
            {
              borderColor: isIOS
                ? "rgba(255,255,255,0.35)"
                : colors.border,
            },
          ]}
        />

        {/* ── tabs row ─────────────────────────────────────────────────── */}
        <View style={s.row}>
          {state.routes.map((route, idx) => {
            const cfg    = TAB_CFG[route.name] ?? { icon: "circle", color: "#888", label: route.name };
            const active = state.index === idx;

            return (
              <Pressable
                key={route.key}
                onPress={() => navigation.navigate(route.name)}
                style={s.tab}
                android_ripple={{ color: cfg.color + "33", borderless: true, radius: 38 }}
              >
                {/* colored glow capsule behind active icon */}
                {active && (
                  <View
                    style={[
                      s.glowCapsule,
                      {
                        backgroundColor: cfg.color + "1c",
                        shadowColor: cfg.color,
                      },
                    ]}
                  />
                )}

                {/* icon — lifted + larger when active */}
                <View style={[s.iconWrap, active && s.iconActive]}>
                  <Feather
                    name={cfg.icon as any}
                    size={active ? 24 : 21}
                    color={active ? cfg.color : colors.mutedForeground}
                  />
                </View>

                <Text
                  style={[
                    s.label,
                    {
                      color:      active ? cfg.color : colors.mutedForeground,
                      fontWeight: active ? "700" : "500",
                    },
                  ]}
                >
                  {cfg.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  outer: {
    position: "absolute",
    left:     12,
    right:    12,
    bottom:   0,
  },
  pill: {
    height:       BAR_H,
    borderRadius: 32,
    overflow:     "hidden",
    // wide-soft shadow
    shadowOffset:  { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius:  28,
    elevation:     22,
  },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 32,
    borderWidth:  StyleSheet.hairlineWidth,
    pointerEvents: "none" as any,
  },
  row: {
    flex:           1,
    flexDirection:  "row",
    alignItems:     "center",
  },
  tab: {
    flex:            1,
    height:          BAR_H,
    alignItems:      "center",
    justifyContent:  "center",
    gap:             2,
  },
  glowCapsule: {
    position:      "absolute",
    width:         56,
    height:        44,
    borderRadius:  16,
    shadowOpacity: 0.45,
    shadowRadius:  12,
    shadowOffset:  { width: 0, height: 2 },
  },
  iconWrap: {
    alignItems:     "center",
    justifyContent: "center",
    zIndex:         1,
  },
  iconActive: {
    transform: [{ translateY: -1 }],
  },
  label: {
    fontSize:     10,
    letterSpacing: 0.1,
    zIndex:        1,
  },
});

// ─── Layout ───────────────────────────────────────────────────────────────────
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index"   options={{ title: "Home"    }} />
      <Tabs.Screen name="trips"   options={{ title: "Trips"   }} />
      <Tabs.Screen name="map"     options={{ title: "Map"     }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
