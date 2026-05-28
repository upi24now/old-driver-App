import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
} from "react-native-svg";

export function DeliveryRiderIllustration({ size = 180 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <Defs>
        <SvgLinearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFE6EE" />
          <Stop offset="1" stopColor="#FFF0E8" />
        </SvgLinearGradient>
        <SvgLinearGradient id="bagGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FF4D8D" />
          <Stop offset="1" stopColor="#FF7A3D" />
        </SvgLinearGradient>
        <SvgLinearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1F2937" />
          <Stop offset="1" stopColor="#111827" />
        </SvgLinearGradient>
      </Defs>

      <Circle cx="100" cy="100" r="92" fill="url(#bgGrad)" />

      <Ellipse cx="100" cy="172" rx="62" ry="6" fill="#000" opacity="0.06" />

      <Circle cx="58" cy="148" r="20" fill="#1F2937" />
      <Circle cx="58" cy="148" r="11" fill="#F8FAFC" />
      <Circle cx="58" cy="148" r="4" fill="#1F2937" />

      <Circle cx="148" cy="148" r="20" fill="#1F2937" />
      <Circle cx="148" cy="148" r="11" fill="#F8FAFC" />
      <Circle cx="148" cy="148" r="4" fill="#1F2937" />

      <Path
        d="M58 148 L92 118 L138 118 L148 148"
        stroke="url(#bodyGrad)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <Path
        d="M138 118 L156 100"
        stroke="#1F2937"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <Rect x="150" y="92" width="14" height="6" rx="2" fill="#1F2937" />

      <Path
        d="M70 118 L80 96"
        stroke="#1F2937"
        strokeWidth="5"
        strokeLinecap="round"
      />

      <Rect
        x="76"
        y="58"
        width="44"
        height="42"
        rx="8"
        fill="url(#bagGrad)"
      />
      <Rect x="76" y="74" width="44" height="3" fill="#fff" opacity="0.35" />
      <Path
        d="M93 70 L98 76 L104 65"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <Circle cx="118" cy="74" r="14" fill="#FFD7B5" />
      <Path
        d="M106 70 Q118 56 130 70 Q130 60 118 56 Q108 58 106 70 Z"
        fill="#1F2937"
      />
      <Rect x="110" y="68" width="16" height="6" rx="3" fill="#1F2937" opacity="0.85" />

      <Path
        d="M126 84 Q138 92 138 104"
        stroke="#FF4D8D"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />

      <Circle cx="40" cy="60" r="3" fill="#FF7A3D" opacity="0.6" />
      <Circle cx="170" cy="50" r="2.5" fill="#FF4D8D" opacity="0.6" />
      <Circle cx="172" cy="120" r="2" fill="#FF7A3D" opacity="0.5" />
    </Svg>
  );
}
