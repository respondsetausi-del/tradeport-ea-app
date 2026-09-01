import React from 'react';
import { View, Image, StyleSheet } from 'react-native';
import type { CalendarEvent } from '@/services/api';

/**
 * Expected volatility, drawn as bull heads — the convention every trader
 * already reads on an economic calendar.
 *
 * Two things carry the rating so it survives either being missed: the COUNT of
 * filled bulls, and their COLOUR. Three red bulls is a market mover; one grey
 * bull is background noise.
 *
 * Three slots always render. The unfilled ones stay in place at low opacity
 * rather than disappearing, so a one-bull row and a three-bull row line up and
 * the column reads at a glance instead of needing to be counted.
 *
 * Holiday sits at one, not zero. An empty slot reads as a rendering fault
 * rather than "nothing scheduled".
 */
const FILLED: Record<CalendarEvent['impact'], number> = {
  High: 3,
  Medium: 2,
  Low: 1,
  Holiday: 1,
};

/** Sampled from the supplied artwork, so the tint matches it exactly. */
const TONE: Record<CalendarEvent['impact'], string> = {
  High: '#FD2726',
  Medium: '#FEA202',
  Low: '#A2A2A4',
  Holiday: '#5B93D6',
};

/**
 * One white-on-transparent master, tinted per level, rather than three coloured
 * files. Three files would be three subtly different silhouettes — the supplied
 * red one is noticeably more compressed than the others — and this way the
 * shape is identical at every level and the colours stay themeable.
 */
const MASTER = require('@/assets/images/bull.png');

/** The artwork is 673x512, so height leads and width follows, or it squashes. */
const RATIO = 673 / 512;

export function ImpactBulls({
  impact,
  size = 13,
}: {
  impact: CalendarEvent['impact'];
  /** Height of one bull. Width is derived from the artwork's own ratio. */
  size?: number;
}) {
  const filled = FILLED[impact] ?? 1;
  const tone = TONE[impact] ?? '#A2A2A4';
  return (
    <View style={styles.row} accessibilityLabel={`${impact} impact`}>
      {[0, 1, 2].map((i) => (
        <Image
          key={i}
          source={MASTER}
          style={[
            { width: size * RATIO, height: size },
            i < filled ? { tintColor: tone } : styles.off,
          ]}
          resizeMode="contain"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  off: { tintColor: '#FFFFFF', opacity: 0.13 },
});

export default ImpactBulls;
