import React from "react";
import { View, StyleSheet } from "react-native";

export type VehicleArtType =
  | "bike"
  | "scooter"
  | "auto"
  | "autoCargo"
  | "car"
  | "truck";

type Props = {
  type: VehicleArtType;
  size?: number;
};

export function VehicleArt({ type, size = 74 }: Props) {
  const scale = size / 74;

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View style={styles.glow} />

      {type === "bike"      ? <Bike      scale={scale} /> : null}
      {type === "scooter"   ? <Scooter   scale={scale} /> : null}
      {type === "auto"      ? <Auto      scale={scale} /> : null}
      {type === "autoCargo" ? <AutoCargo scale={scale} /> : null}
      {type === "car"       ? <Car       scale={scale} /> : null}
      {type === "truck"     ? <Truck     scale={scale} /> : null}
    </View>
  );
}

function Wheel({ left, top, scale }: { left: number; top: number; scale: number }) {
  return (
    <View
      style={[
        styles.wheel,
        {
          left:         left   * scale,
          top:          top    * scale,
          width:        13     * scale,
          height:       13     * scale,
          borderRadius: 7      * scale,
        },
      ]}
    >
      <View
        style={[
          styles.wheelInner,
          {
            width:        6 * scale,
            height:       6 * scale,
            borderRadius: 3 * scale,
          },
        ]}
      />
    </View>
  );
}

function Bike({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={13} top={48} scale={scale} />
      <Wheel left={48} top={48} scale={scale} />
      <View style={[styles.bikeBody,   scaled({ left: 22, top: 36, width: 31, height: 10, borderRadius: 7 }, scale)]} />
      <View style={[styles.bikeSeat,   scaled({ left: 29, top: 29, width: 18, height:  6, borderRadius: 4 }, scale)]} />
      <View style={[styles.bikeFront,  scaled({ left: 48, top: 28, width:  5, height: 22, borderRadius: 3 }, scale)]} />
      <View style={[styles.bikeHandle, scaled({ left: 50, top: 25, width: 15, height:  4, borderRadius: 3 }, scale)]} />
      <View style={[styles.bikeBox,    scaled({ left: 18, top: 28, width: 13, height: 13, borderRadius: 3 }, scale)]} />
    </View>
  );
}

function Scooter({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={17} top={50} scale={scale} />
      <Wheel left={48} top={50} scale={scale} />
      <View style={[styles.scooterDeck,  scaled({ left: 22, top: 43, width: 36, height:  8, borderRadius: 8 }, scale)]} />
      <View style={[styles.scooterFront, scaled({ left: 50, top: 25, width:  8, height: 25, borderRadius: 5 }, scale)]} />
      <View style={[styles.scooterSeat,  scaled({ left: 27, top: 32, width: 22, height:  7, borderRadius: 4 }, scale)]} />
      <View style={[styles.scooterBox,   scaled({ left: 19, top: 27, width: 13, height: 14, borderRadius: 4 }, scale)]} />
    </View>
  );
}

function Auto({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={14} top={49} scale={scale} />
      <Wheel left={48} top={49} scale={scale} />
      <View style={[styles.autoBase,   scaled({ left: 14, top: 36, width: 48, height: 17, borderRadius: 6 }, scale)]} />
      <View style={[styles.autoCab,    scaled({ left: 24, top: 22, width: 28, height: 18, borderRadius: 7 }, scale)]} />
      <View style={[styles.autoWindow, scaled({ left: 31, top: 26, width: 14, height: 10, borderRadius: 3 }, scale)]} />
      <View style={[styles.autoRoof,   scaled({ left: 21, top: 19, width: 34, height:  6, borderRadius: 5 }, scale)]} />
    </View>
  );
}

function AutoCargo({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={13} top={50} scale={scale} />
      <Wheel left={51} top={50} scale={scale} />
      <View style={[styles.cargoBox,    scaled({ left: 12, top: 27, width: 28, height: 25, borderRadius: 5 }, scale)]} />
      <View style={[styles.cargoCab,    scaled({ left: 40, top: 34, width: 21, height: 18, borderRadius: 5 }, scale)]} />
      <View style={[styles.cargoWindow, scaled({ left: 45, top: 37, width: 10, height:  8, borderRadius: 2 }, scale)]} />
      <View style={[styles.cargoLine,   scaled({ left: 17, top: 33, width: 18, height:  3, borderRadius: 2 }, scale)]} />
      <View style={[styles.cargoLine,   scaled({ left: 17, top: 40, width: 18, height:  3, borderRadius: 2 }, scale)]} />
    </View>
  );
}

function Car({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={17} top={49} scale={scale} />
      <Wheel left={48} top={49} scale={scale} />
      <View style={[styles.carBase,   scaled({ left: 14, top: 39, width: 48, height: 16, borderRadius: 8 }, scale)]} />
      <View style={[styles.carTop,    scaled({ left: 25, top: 28, width: 28, height: 16, borderRadius: 7 }, scale)]} />
      <View style={[styles.carWindow, scaled({ left: 30, top: 31, width: 18, height:  8, borderRadius: 3 }, scale)]} />
      <View style={[styles.carLight,  scaled({ left: 57, top: 44, width:  5, height:  4, borderRadius: 2 }, scale)]} />
    </View>
  );
}

function Truck({ scale }: { scale: number }) {
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel left={14} top={50} scale={scale} />
      <Wheel left={51} top={50} scale={scale} />
      <View style={[styles.truckBox,    scaled({ left: 10, top: 25, width: 34, height: 27, borderRadius: 5 }, scale)]} />
      <View style={[styles.truckCab,    scaled({ left: 43, top: 34, width: 20, height: 18, borderRadius: 5 }, scale)]} />
      <View style={[styles.truckWindow, scaled({ left: 48, top: 37, width: 10, height:  8, borderRadius: 2 }, scale)]} />
      <View style={[styles.truckStripe, scaled({ left: 15, top: 33, width: 24, height:  4, borderRadius: 2 }, scale)]} />
    </View>
  );
}

function scaled(base: Record<string, number>, scale: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const key of Object.keys(base)) {
    result[key] = base[key]! * scale;
  }
  return result;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems:      "center",
    justifyContent:  "center",
  },
  glow: {
    position:        "absolute",
    width:           "86%",
    height:          "86%",
    borderRadius:    999,
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  wheel: {
    position:        "absolute",
    backgroundColor: "#111827",
    alignItems:      "center",
    justifyContent:  "center",
  },
  wheelInner: {
    backgroundColor: "#CBD5E1",
  },

  bikeBody:   { position: "absolute", backgroundColor: "#EF4444" },
  bikeSeat:   { position: "absolute", backgroundColor: "#111827" },
  bikeFront:  { position: "absolute", backgroundColor: "#111827" },
  bikeHandle: { position: "absolute", backgroundColor: "#111827" },
  bikeBox:    { position: "absolute", backgroundColor: "#F97316" },

  scooterDeck:  { position: "absolute", backgroundColor: "#EC4899" },
  scooterFront: { position: "absolute", backgroundColor: "#111827" },
  scooterSeat:  { position: "absolute", backgroundColor: "#111827" },
  scooterBox:   { position: "absolute", backgroundColor: "#F97316" },

  autoBase:   { position: "absolute", backgroundColor: "#16A34A" },
  autoCab:    { position: "absolute", backgroundColor: "#FACC15" },
  autoWindow: { position: "absolute", backgroundColor: "#DBEAFE" },
  autoRoof:   { position: "absolute", backgroundColor: "#111827" },

  cargoBox:    { position: "absolute", backgroundColor: "#F97316" },
  cargoCab:    { position: "absolute", backgroundColor: "#16A34A" },
  cargoWindow: { position: "absolute", backgroundColor: "#DBEAFE" },
  cargoLine:   { position: "absolute", backgroundColor: "rgba(255,255,255,0.75)" },

  carBase:   { position: "absolute", backgroundColor: "#2563EB" },
  carTop:    { position: "absolute", backgroundColor: "#60A5FA" },
  carWindow: { position: "absolute", backgroundColor: "#DBEAFE" },
  carLight:  { position: "absolute", backgroundColor: "#FACC15" },

  truckBox:    { position: "absolute", backgroundColor: "#F97316" },
  truckCab:    { position: "absolute", backgroundColor: "#2563EB" },
  truckWindow: { position: "absolute", backgroundColor: "#DBEAFE" },
  truckStripe: { position: "absolute", backgroundColor: "rgba(255,255,255,0.75)" },
});
