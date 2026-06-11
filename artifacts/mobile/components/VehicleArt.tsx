import React from "react";
import Svg, {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Rect,
} from "react-native-svg";

export type VehicleArtType =
  | "bike"
  | "scooter"
  | "auto"
  | "autoCargo"
  | "car"
  | "truck";

interface Props {
  type: VehicleArtType;
  size?: number;
}

// viewBox is 100 × 72 for all vehicles.
// Wheels sit on a virtual ground at y ≈ 67.
export function VehicleArt({ type, size = 74 }: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 72"
      preserveAspectRatio="xMidYMid meet"
    >
      {type === "bike"      ? <BikeArt />      : null}
      {type === "scooter"   ? <ScooterArt />   : null}
      {type === "auto"      ? <AutoArt />      : null}
      {type === "autoCargo" ? <AutoCargoArt /> : null}
      {type === "car"       ? <CarArt />       : null}
      {type === "truck"     ? <TruckArt />     : null}
    </Svg>
  );
}

// ─── Shared wheel component ───────────────────────────────────────────────────
function Wheel({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r}           fill="#1F2937" />
      <Circle cx={cx} cy={cy} r={r * 0.55}    fill="#374151" />
      <Circle cx={cx} cy={cy} r={r * 0.22}    fill="#9CA3AF" />
    </G>
  );
}

// ─── Bike (delivery motorcycle + rear cargo box) ──────────────────────────────
// rear-wheel cx=23 cy=55 r=12   front-wheel cx=77 cy=57 r=10
function BikeArt() {
  return (
    <G>
      {/* — cargo box (orange, mounted rear) — */}
      <Rect x="4"  y="20" width="23" height="18" rx="2.5" fill="#F97316" />
      <Rect x="4"  y="20" width="23" height="5"  rx="2.5" fill="#C2410C" />
      <Rect x="8"  y="27" width="15" height="2"  rx="1"   fill="rgba(255,255,255,0.45)" />
      <Rect x="8"  y="31" width="15" height="2"  rx="1"   fill="rgba(255,255,255,0.45)" />

      {/* — rear fender arc over rear wheel — */}
      <Path
        d="M11 43 Q17 36 23 36 Q29 36 34 41"
        fill="none" stroke="#DC2626" strokeWidth="3"
        strokeLinecap="round"
      />

      {/* — seat — */}
      <Rect x="27" y="23" width="31" height="9" rx="4.5" fill="#111827" />
      <Rect x="29" y="24" width="27" height="4" rx="2"   fill="#374151" />

      {/* — engine / mid body panel — */}
      <Path
        d="M26 32 L57 28 L62 43 L42 47 L26 44 Z"
        fill="#EF4444"
      />
      {/* subtle highlight on body */}
      <Path
        d="M28 32 L56 28 L59 35 L30 36 Z"
        fill="#F87171"
      />

      {/* — rear swingarm — */}
      <Line
        x1="23" y1="55" x2="40" y2="47"
        stroke="#374151" strokeWidth="3" strokeLinecap="round"
      />

      {/* — upper frame (top tube) — */}
      <Line
        x1="56" y1="29" x2="66" y2="29"
        stroke="#374151" strokeWidth="3" strokeLinecap="round"
      />

      {/* — head tube — */}
      <Rect x="63" y="24" width="5" height="16" rx="2.5" fill="#374151" />

      {/* — front fork — */}
      <Path
        d="M66 40 L77 57"
        stroke="#374151" strokeWidth="4" strokeLinecap="round"
      />
      <Path
        d="M68 40 L79 57"
        stroke="#4B5563" strokeWidth="2" strokeLinecap="round"
      />

      {/* — handlebar — */}
      <Rect x="57" y="19" width="18" height="5" rx="2.5" fill="#111827" />

      {/* — headlight — */}
      <Ellipse cx="81" cy="54" rx="4" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="81" cy="54" rx="2" ry="2"   fill="#FFF"    opacity="0.6" />

      {/* — exhaust pipe — */}
      <Path
        d="M38 53 Q30 58 22 59"
        fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round"
      />

      {/* — wheels on top — */}
      <Wheel cx={23} cy={55} r={12} />
      <Wheel cx={77} cy={57} r={10} />
    </G>
  );
}

// ─── Scooter (step-through delivery scooter + small rear box) ─────────────────
// rear cx=26 cy=57 r=11   front cx=74 cy=57 r=11
function ScooterArt() {
  return (
    <G>
      {/* — small cargo box (rear, pink-orange) — */}
      <Rect x="7"  y="28" width="18" height="14" rx="2.5" fill="#F97316" />
      <Rect x="7"  y="28" width="18" height="4"  rx="2.5" fill="#C2410C" />
      <Rect x="10" y="34" width="12" height="2"  rx="1"   fill="rgba(255,255,255,0.45)" />

      {/* — rear panel / fender — */}
      <Path
        d="M10 46 Q18 38 26 38 Q32 38 37 43"
        fill="none" stroke="#DB2777" strokeWidth="3" strokeLinecap="round"
      />

      {/* — floorboard / step-through deck — */}
      <Rect x="25" y="50" width="48" height="7" rx="3.5" fill="#EC4899" />

      {/* — rear body cowl — */}
      <Path
        d="M25 42 L50 36 L56 44 L40 50 L25 50 Z"
        fill="#EC4899"
      />
      <Path
        d="M26 42 L49 36 L54 41 L30 43 Z"
        fill="#F472B6"
      />

      {/* — front shield / legshield — */}
      <Path
        d="M68 33 L74 31 L76 46 L68 48 Z"
        fill="#DB2777"
      />

      {/* — handlebar — */}
      <Rect x="64" y="22" width="18" height="5" rx="2.5" fill="#111827" />

      {/* — head tube — */}
      <Rect x="68" y="27" width="5" height="22" rx="2.5" fill="#374151" />

      {/* — seat — */}
      <Rect x="34" y="30" width="26" height="8" rx="4" fill="#111827" />
      <Rect x="36" y="31" width="22" height="4" rx="2" fill="#374151" />

      {/* — headlight — */}
      <Ellipse cx="77" cy="43" rx="4" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="77" cy="43" rx="2" ry="2"   fill="#FFF"    opacity="0.6" />

      {/* — wheels — */}
      <Wheel cx={26} cy={57} r={11} />
      <Wheel cx={74} cy={57} r={11} />
    </G>
  );
}

// ─── Auto (auto-rickshaw passenger) ──────────────────────────────────────────
// rear cx=28 cy=58 r=11   front cx=75 cy=59 r=9
function AutoArt() {
  return (
    <G>
      {/* — roof — */}
      <Rect x="22" y="12" width="48" height="5" rx="2.5" fill="#111827" />

      {/* — main cabin body — */}
      <Path
        d="M22 17 L22 52 L70 52 L70 18 Z"
        fill="#FACC15"
      />

      {/* — windscreen (front, right side) — */}
      <Path
        d="M63 18 L70 18 L70 40 L63 42 Z"
        fill="#BAE6FD"
      />
      {/* windscreen frame */}
      <Path
        d="M63 18 L70 18 L70 40 L63 42 Z"
        fill="none" stroke="#A16207" strokeWidth="1.5"
      />

      {/* — window (side open — typical auto) — */}
      <Path
        d="M26 18 L60 18 L60 38 L26 38 Z"
        fill="rgba(255,255,255,0.18)"
      />
      {/* window frame lines */}
      <Line
        x1="26" y1="38" x2="60" y2="38"
        stroke="#A16207" strokeWidth="1.5"
      />
      <Line
        x1="43" y1="18" x2="43" y2="38"
        stroke="#A16207" strokeWidth="1.5"
      />

      {/* — cabin floor / step — */}
      <Rect x="22" y="50" width="48" height="5" rx="0" fill="#CA8A04" />

      {/* — front hood / cowl — */}
      <Path
        d="M70 28 L82 28 L82 50 L70 50 Z"
        fill="#111827"
      />
      {/* — headlight (front) — */}
      <Ellipse cx="83" cy="46" rx="4" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="83" cy="46" rx="2" ry="2"   fill="#FFF"    opacity="0.6" />

      {/* — handlebar (partially visible inside) — */}
      <Rect x="71" y="32" width="8" height="3" rx="1.5" fill="#374151" />

      {/* — roof strut lines — */}
      <Line x1="22" y1="17" x2="22" y2="52" stroke="#A16207" strokeWidth="1.5" />
      <Line x1="62" y1="17" x2="62" y2="52" stroke="#A16207" strokeWidth="1.5" />

      {/* — rear wheel — */}
      <Wheel cx={28} cy={58} r={11} />
      {/* — front wheel — */}
      <Wheel cx={75} cy={59} r={9} />
    </G>
  );
}

// ─── Auto Cargo (3-wheeler cargo loader) ─────────────────────────────────────
// rear cx=26 cy=57 r=12   front cx=78 cy=58 r=9
function AutoCargoArt() {
  return (
    <G>
      {/* — cargo box (main, orange) — */}
      <Rect x="4"  y="18" width="46" height="34" rx="3" fill="#F97316" />
      {/* box top panel (darker) */}
      <Rect x="4"  y="18" width="46" height="6"  rx="3" fill="#C2410C" />
      {/* cargo stripes */}
      <Rect x="9"  y="27" width="36" height="3"  rx="1.5" fill="rgba(255,255,255,0.4)" />
      <Rect x="9"  y="34" width="36" height="3"  rx="1.5" fill="rgba(255,255,255,0.4)" />
      <Rect x="9"  y="41" width="36" height="3"  rx="1.5" fill="rgba(255,255,255,0.4)" />
      {/* door line */}
      <Line
        x1="27" y1="24" x2="27" y2="52"
        stroke="rgba(0,0,0,0.25)" strokeWidth="2"
      />

      {/* — cab (green, right side) — */}
      <Rect x="48" y="26" width="28" height="26" rx="3" fill="#16A34A" />
      {/* cab window */}
      <Rect x="52" y="30" width="20" height="15" rx="2" fill="#BAE6FD" />
      <Rect x="52" y="30" width="20" height="15" rx="2"
            fill="none" stroke="#15803D" strokeWidth="1.5" />
      {/* window reflections */}
      <Line
        x1="55" y1="30" x2="55" y2="45"
        stroke="rgba(255,255,255,0.4)" strokeWidth="1.5"
      />

      {/* — front hood — */}
      <Path
        d="M74 38 L82 38 L82 52 L74 52 Z"
        fill="#111827"
      />
      {/* headlight */}
      <Ellipse cx="83" cy="49" rx="4" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="83" cy="49" rx="2" ry="2"   fill="#FFF"    opacity="0.6" />

      {/* — floor panel — */}
      <Rect x="4" y="50" width="74" height="5" rx="0" fill="#15803D" />

      {/* — wheels — */}
      <Wheel cx={26} cy={57} r={12} />
      <Wheel cx={78} cy={58} r={9}  />
    </G>
  );
}

// ─── Car (compact sedan) ──────────────────────────────────────────────────────
// rear cx=20 cy=57 r=11   front cx=78 cy=57 r=11
function CarArt() {
  return (
    <G>
      {/* — body lower (sill / floor) — */}
      <Rect x="10" y="46" width="80" height="14" rx="5" fill="#2563EB" />

      {/* — body upper (cabin) — */}
      <Path
        d="M28 46 C30 28 40 20 56 20 C68 20 76 26 80 36 L80 46 Z"
        fill="#3B82F6"
      />
      {/* cabin roof highlight */}
      <Path
        d="M32 44 C34 30 42 23 56 23 C66 23 73 28 77 38 L77 44 Z"
        fill="#60A5FA"
      />

      {/* — windscreen — */}
      <Path
        d="M56 23 C67 23 73 28 76 37 L59 37 Z"
        fill="#BAE6FD"
      />
      <Path
        d="M56 23 C67 23 73 28 76 37 L59 37 Z"
        fill="none" stroke="#1E40AF" strokeWidth="1.5"
      />

      {/* — rear window — */}
      <Path
        d="M32 44 C34 30 40 24 52 23 L52 37 L32 44 Z"
        fill="#BAE6FD"
        opacity="0.85"
      />
      <Path
        d="M32 44 C34 30 40 24 52 23 L52 37 L32 44 Z"
        fill="none" stroke="#1E40AF" strokeWidth="1.5"
      />

      {/* — side window — */}
      <Rect x="53" y="24" width="5" height="13" rx="1" fill="#93C5FD" />

      {/* — door line — */}
      <Line
        x1="54" y1="37" x2="54" y2="46"
        stroke="#1D4ED8" strokeWidth="1.5"
      />

      {/* — headlight — */}
      <Ellipse cx="86" cy="47" rx="5" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="86" cy="47" rx="2.5" ry="2" fill="#FFF"    opacity="0.7" />

      {/* — tail-light — */}
      <Ellipse cx="12" cy="47" rx="4" ry="3" fill="#FCA5A5" />

      {/* — door handles — */}
      <Rect x="37" y="43" width="8" height="2" rx="1" fill="#1E40AF" />
      <Rect x="61" y="43" width="8" height="2" rx="1" fill="#1E40AF" />

      {/* — wheels — */}
      <Wheel cx={20} cy={57} r={11} />
      <Wheel cx={78} cy={57} r={11} />
    </G>
  );
}

// ─── Truck (delivery mini-truck) ─────────────────────────────────────────────
// rear cx=20 cy=55 r=13   front cx=79 cy=56 r=10
function TruckArt() {
  return (
    <G>
      {/* — cargo box (main body, orange) — */}
      <Rect x="4"  y="14" width="52" height="40" rx="3" fill="#F97316" />
      {/* roof highlight */}
      <Rect x="4"  y="14" width="52" height="7"  rx="3" fill="#C2410C" />
      {/* horizontal stripes (branding) */}
      <Rect x="8"  y="25" width="44" height="4"  rx="2" fill="rgba(255,255,255,0.35)" />
      <Rect x="8"  y="33" width="44" height="4"  rx="2" fill="rgba(255,255,255,0.35)" />
      <Rect x="8"  y="41" width="44" height="4"  rx="2" fill="rgba(255,255,255,0.35)" />
      {/* rear doors split */}
      <Line
        x1="30" y1="21" x2="30" y2="54"
        stroke="rgba(0,0,0,0.2)" strokeWidth="2"
      />
      {/* rear door handles */}
      <Rect x="19" y="38" width="6" height="2.5" rx="1.5" fill="rgba(0,0,0,0.3)" />
      <Rect x="32" y="38" width="6" height="2.5" rx="1.5" fill="rgba(0,0,0,0.3)" />

      {/* — cab (blue) — */}
      <Rect x="54" y="24" width="30" height="30" rx="4" fill="#2563EB" />
      {/* cab window */}
      <Rect x="58" y="28" width="22" height="16" rx="2" fill="#BAE6FD" />
      <Rect x="58" y="28" width="22" height="16" rx="2"
            fill="none" stroke="#1D4ED8" strokeWidth="1.5" />
      {/* window highlight */}
      <Line
        x1="62" y1="28" x2="62" y2="44"
        stroke="rgba(255,255,255,0.45)" strokeWidth="2"
      />

      {/* — front bumper / hood — */}
      <Rect x="82" y="38" width="8" height="16" rx="3" fill="#1E40AF" />
      {/* headlight */}
      <Ellipse cx="87" cy="48" rx="4.5" ry="3.5" fill="#FDE68A" />
      <Ellipse cx="87" cy="48" rx="2"   ry="2"   fill="#FFF"    opacity="0.7" />

      {/* — roof cap (joins cab to box) — */}
      <Path
        d="M54 24 L54 28 L58 28 L58 24 Z"
        fill="#1D4ED8"
      />

      {/* — floor sill — */}
      <Rect x="4" y="52" width="86" height="5" rx="0" fill="#1D4ED8" />

      {/* — fuel tank (small, under cab) — */}
      <Rect x="56" y="51" width="14" height="5" rx="2" fill="#1E40AF" />

      {/* — wheels — */}
      <Wheel cx={20} cy={55} r={13} />
      <Wheel cx={79} cy={56} r={10} />
    </G>
  );
}
