import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Rect, Circle, Path, G } from 'react-native-svg';

/**
 * The flag for a calendar currency.
 *
 * Drawn rather than bundled as images: nine flags as PNGs is nine assets to
 * ship and keep in sync, and at this size the vector versions are sharper on
 * every density. Same 3:2 canvas the session clocks use, so the two agree.
 *
 * Deliberately simplified. At 18px wide a faithful maple leaf or a real Union
 * canton is mud, so each flag keeps only what identifies it: the colours, the
 * division, and the one central device.
 */

type P = { w: number; h: number };

const FlagUS = ({ w, h }: P) => {
  const stripes = [];
  for (let i = 0; i < 13; i++) {
    stripes.push(
      <Rect key={i} x="0" y={(60 / 13) * i} width="90" height={60 / 13}
        fill={i % 2 === 0 ? '#B22234' : '#ffffff'} />,
    );
  }
  return (
    <Svg width={w} height={h} viewBox="0 0 90 60">
      {stripes}
      <Rect x="0" y="0" width="36" height={(60 / 13) * 7} fill="#3C3B6E" />
    </Svg>
  );
};

const FlagEU = ({ w, h }: P) => {
  const stars = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    stars.push(
      <Circle key={i} cx={45 + Math.cos(a) * 15} cy={30 + Math.sin(a) * 15} r="2.1" fill="#FFCC00" />,
    );
  }
  return (
    <Svg width={w} height={h} viewBox="0 0 90 60">
      <Rect width="90" height="60" fill="#003399" />
      {stars}
    </Svg>
  );
};

const FlagGB = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#00247D" />
    <Path d="M0 0 L90 60 M90 0 L0 60" stroke="#ffffff" strokeWidth="12" />
    <Path d="M0 0 L90 60 M90 0 L0 60" stroke="#CF142B" strokeWidth="6" />
    <Rect x="37" y="0" width="16" height="60" fill="#ffffff" />
    <Rect x="0" y="22" width="90" height="16" fill="#ffffff" />
    <Rect x="40" y="0" width="10" height="60" fill="#CF142B" />
    <Rect x="0" y="25" width="90" height="10" fill="#CF142B" />
  </Svg>
);

const FlagJP = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#ffffff" />
    <Circle cx="45" cy="30" r="18" fill="#BC002D" />
  </Svg>
);

const southernCross = (
  <G>
    <Circle cx="22" cy="45" r="5" fill="#ffffff" />
    <Circle cx="66" cy="13" r="3" fill="#ffffff" />
    <Circle cx="76" cy="28" r="3" fill="#ffffff" />
    <Circle cx="64" cy="44" r="3" fill="#ffffff" />
    <Circle cx="71" cy="37" r="1.8" fill="#ffffff" />
  </G>
);

const unionCanton = (
  <G>
    <Path d="M0 0 L45 30 M45 0 L0 30" stroke="#ffffff" strokeWidth="6" />
    <Path d="M0 0 L45 30 M45 0 L0 30" stroke="#CF142B" strokeWidth="3" />
    <Rect x="19" y="0" width="7" height="30" fill="#ffffff" />
    <Rect x="0" y="11.5" width="45" height="7" fill="#ffffff" />
    <Rect x="20.75" y="0" width="3.5" height="30" fill="#CF142B" />
    <Rect x="0" y="13.25" width="45" height="3.5" fill="#CF142B" />
  </G>
);

const FlagAU = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#00247D" />
    {unionCanton}
    {southernCross}
  </Svg>
);

// New Zealand: the same canton, but four red stars rather than six white ones.
const FlagNZ = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#00247D" />
    {unionCanton}
    <Circle cx="70" cy="14" r="3" fill="#CC142B" />
    <Circle cx="78" cy="30" r="3" fill="#CC142B" />
    <Circle cx="66" cy="30" r="2.6" fill="#CC142B" />
    <Circle cx="72" cy="46" r="3" fill="#CC142B" />
  </Svg>
);

const FlagCA = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#ffffff" />
    <Rect x="0" y="0" width="22.5" height="60" fill="#FF0000" />
    <Rect x="67.5" y="0" width="22.5" height="60" fill="#FF0000" />
    {/* A stylised leaf: the real one has eleven points and none survive here. */}
    <Path
      d="M45 14 L48.5 24 L55 21 L52 30 L61 33 L52 37 L54 44 L46.5 41.5 L45 48 L43.5 41.5 L36 44 L38 37 L29 33 L38 30 L35 21 L41.5 24 Z"
      fill="#FF0000"
    />
  </Svg>
);

const FlagCH = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#DA291C" />
    <Rect x="40" y="16" width="10" height="28" fill="#ffffff" />
    <Rect x="31" y="25" width="28" height="10" fill="#ffffff" />
  </Svg>
);

const FlagCN = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#DE2910" />
    <Circle cx="18" cy="17" r="7" fill="#FFDE00" />
    <Circle cx="31" cy="9" r="2.4" fill="#FFDE00" />
    <Circle cx="36" cy="17" r="2.4" fill="#FFDE00" />
    <Circle cx="35" cy="26" r="2.4" fill="#FFDE00" />
    <Circle cx="29" cy="32" r="2.4" fill="#FFDE00" />
  </Svg>
);

/** Events tagged ALL are global (G20, OPEC), so there is no one flag. */
const FlagGlobal = ({ w, h }: P) => (
  <Svg width={w} height={h} viewBox="0 0 90 60">
    <Rect width="90" height="60" fill="#1E3A5F" />
    <Circle cx="45" cy="30" r="19" fill="none" stroke="#7FB3E8" strokeWidth="3" />
    <Path d="M26 30 H64 M45 11 C36 20 36 40 45 49 C54 40 54 20 45 11"
      fill="none" stroke="#7FB3E8" strokeWidth="3" />
  </Svg>
);

const BY_CURRENCY: Record<string, (p: P) => React.ReactElement> = {
  USD: FlagUS, EUR: FlagEU, GBP: FlagGB, JPY: FlagJP,
  AUD: FlagAU, NZD: FlagNZ, CAD: FlagCA, CHF: FlagCH, CNY: FlagCN,
};

export function CurrencyFlag({ currency, width = 20 }: { currency: string; width?: number }) {
  const key = (currency || '').trim().toUpperCase();
  const Flag = BY_CURRENCY[key] ?? FlagGlobal;
  const height = Math.round((width / 3) * 2);
  return (
    <View style={[styles.frame, { width, height }]} accessibilityLabel={key || 'Global'}>
      <Flag w={width} h={height} />
    </View>
  );
}

const styles = StyleSheet.create({
  // A hairline keeps a white flag (Japan) from bleeding into a dark row.
  frame: {
    borderRadius: 2,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
});

export default CurrencyFlag;
