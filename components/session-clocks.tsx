import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, Platform } from 'react-native';
import Svg, { Rect, Circle, Path, G } from 'react-native-svg';
import { useTheme } from '@/providers/theme-provider';

/**
 * The four forex sessions, as levitating coins.
 *
 * Sits above the calendar because "which desks are actually awake" is the
 * context you read the calendar through: a high-impact print lands very
 * differently into a thin Sydney book than into the London/New York overlap.
 *
 * Flags are drawn rather than emoji: emoji flags render as bare letters on
 * Windows and on some Android builds, which would show "GB" where a flag
 * should be.
 *
 * Session hours are UTC and are the conventional retail windows. They do NOT
 * track daylight saving, which shifts London and New York by an hour for part
 * of the year, so treat the countdown as indicative rather than to the minute.
 */

interface Session {
  key: string;
  city: string;
  /** Opening hour, UTC. */
  open: number;
  /** Closing hour, UTC. Wraps past midnight when close < open. */
  close: number;
  Flag: (p: { size: number }) => React.ReactElement;
}

// ── Flags ──────────────────────────────────────────────────────────────
// Square, edge to edge: the coin's round face clips them.

function FlagAU({ size }: { size: number }) {
  const star = (cx: number, cy: number, r: number) => (
    <Circle cx={cx} cy={cy} r={r} fill="#ffffff" />
  );
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <Rect width="60" height="60" fill="#00247D" />
      <G>
        <Path d="M0 0 L30 20 M30 0 L0 20" stroke="#ffffff" strokeWidth="4" />
        <Path d="M0 0 L30 20 M30 0 L0 20" stroke="#CF142B" strokeWidth="2" />
        <Rect x="12.5" y="0" width="5" height="20" fill="#ffffff" />
        <Rect x="0" y="7.5" width="30" height="5" fill="#ffffff" />
        <Rect x="13.75" y="0" width="2.5" height="20" fill="#CF142B" />
        <Rect x="0" y="8.75" width="30" height="2.5" fill="#CF142B" />
      </G>
      {star(15, 44, 4)}
      {star(44, 12, 2.6)}
      {star(50, 30, 2.6)}
      {star(41, 45, 2.6)}
      {star(46, 39, 1.6)}
    </Svg>
  );
}

function FlagJP({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <Rect width="60" height="60" fill="#ffffff" />
      <Circle cx="30" cy="30" r="15" fill="#BC002D" />
    </Svg>
  );
}

function FlagGB({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      <Rect width="60" height="60" fill="#00247D" />
      <Path d="M0 0 L60 60 M60 0 L0 60" stroke="#ffffff" strokeWidth="12" />
      <Path d="M0 0 L60 60 M60 0 L0 60" stroke="#CF142B" strokeWidth="6" />
      <Rect x="25" y="0" width="10" height="60" fill="#ffffff" />
      <Rect x="0" y="25" width="60" height="10" fill="#ffffff" />
      <Rect x="27" y="0" width="6" height="60" fill="#CF142B" />
      <Rect x="0" y="27" width="60" height="6" fill="#CF142B" />
    </Svg>
  );
}

function FlagUS({ size }: { size: number }) {
  const stripes = [];
  for (let i = 0; i < 13; i++) {
    stripes.push(
      <Rect key={i} x="0" y={(60 / 13) * i} width="60" height={60 / 13}
        fill={i % 2 === 0 ? '#B22234' : '#ffffff'} />,
    );
  }
  const stars = [];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 5; c++) {
      stars.push(<Circle key={`${r}-${c}`} cx={4 + c * 5.5} cy={4 + r * 6} r="1.5" fill="#ffffff" />);
    }
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 60 60">
      {stripes}
      <Rect x="0" y="0" width="30" height={(60 / 13) * 7} fill="#3C3B6E" />
      {stars}
    </Svg>
  );
}

const SESSIONS: Session[] = [
  { key: 'syd', city: 'SYDNEY', open: 22, close: 7, Flag: FlagAU },
  { key: 'tok', city: 'TOKYO', open: 0, close: 9, Flag: FlagJP },
  { key: 'lon', city: 'LONDON', open: 8, close: 17, Flag: FlagGB },
  { key: 'nyc', city: 'NEW YORK', open: 13, close: 22, Flag: FlagUS },
];

function isOpen(s: Session, utcHour: number): boolean {
  return s.close < s.open
    ? utcHour >= s.open || utcHour < s.close // wraps midnight
    : utcHour >= s.open && utcHour < s.close;
}

/**
 * Minutes until the session flips state.
 *
 * Whole hours made anything under an hour read "0h", which looks like a stuck
 * clock at exactly the moment the number matters most.
 */
function minutesUntilFlip(s: Session, utcHour: number, utcMin: number): number {
  const target = isOpen(s, utcHour) ? s.close : s.open;
  const mins = (target * 60 - (utcHour * 60 + utcMin) + 1440) % 1440;
  return mins === 0 ? 1440 : mins;
}

const formatFlip = (mins: number) =>
  mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h`;

function SessionCoin({
  session, open, mins, accent, accentRgb, index,
}: {
  session: Session;
  open: boolean;
  mins: number;
  accent: string;
  accentRgb: string;
  index: number;
}) {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Staggered so the row breathes rather than bobbing in lockstep.
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(index * 380),
        Animated.timing(rise, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(rise, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [rise, index]);

  const y = rise.interpolate({ inputRange: [0, 1], outputRange: [0, -5] });
  const shadowScale = rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const shadowFade = rise.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.45] });

  const { Flag } = session;
  const SIZE = 46;

  // Open desks wear the accent ring and its glow; closed ones sit dormant so
  // they read as asleep rather than missing.
  const ring = open
    ? { borderColor: accent, ...(Platform.OS === 'web'
        ? ({ boxShadow: `0 0 10px rgba(${accentRgb}, 0.55), 0 0 22px rgba(${accentRgb}, 0.3)` } as any)
        : { shadowColor: accent, shadowOpacity: 0.6, shadowRadius: 8, elevation: 8 }) }
    : { borderColor: 'rgba(255,255,255,0.14)' };

  return (
    <View style={styles.coin}>
      <Animated.View style={{ transform: [{ translateY: y }] }}>
        <View style={[styles.face, ring, !open && styles.dormant]}>
          <Flag size={SIZE} />
        </View>
      </Animated.View>

      <Animated.View
        style={[styles.cast, { opacity: shadowFade, transform: [{ scaleX: shadowScale }] }]}
        pointerEvents="none"
      />

      <Text style={[styles.city, open && styles.cityOpen]} numberOfLines={1}>
        {session.city}
      </Text>
      <Text style={[styles.state, open && { color: accent }]} numberOfLines={1}>
        {open ? `OPEN · ${formatFlip(mins)}` : `IN ${formatFlip(mins)}`}
      </Text>
    </View>
  );
}

export function SessionClocks() {
  const { theme } = useTheme();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // A minute is plenty: these only change on the hour.
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();

  const rows = useMemo(
    () => SESSIONS.map((s) => ({
      session: s,
      open: isOpen(s, utcHour),
      mins: minutesUntilFlip(s, utcHour, utcMin),
    })),
    [utcHour, utcMin],
  );

  const openCount = rows.filter((r) => r.open).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>MARKET SESSIONS</Text>
        <Text style={[styles.count, openCount > 0 && { color: theme.accent }]}>
          {openCount === 0 ? 'ALL CLOSED' : `${openCount} OPEN`}
        </Text>
      </View>

      <View style={styles.row}>
        {rows.map((r, i) => (
          <SessionCoin
            key={r.session.key}
            session={r.session}
            open={r.open}
            mins={r.mins}
            accent={theme.accent}
            accentRgb={theme.accentRgb}
            index={i}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingBottom: 14 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 1.9, color: '#808080' },
  count: { fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: '#808080' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  coin: { alignItems: 'center', flex: 1 },
  face: {
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    overflow: 'hidden',
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dormant: { opacity: 0.42 },
  cast: {
    width: 34,
    height: 5,
    marginTop: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    ...(Platform.OS === 'web' ? ({ filter: 'blur(3px)' } as any) : null),
  },
  city: { marginTop: 7, fontSize: 8, fontWeight: '800', letterSpacing: 1.1, color: '#808080' },
  cityOpen: { color: '#FFFFFF' },
  state: {
    marginTop: 2,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.6,
    color: '#555555',
    fontVariant: ['tabular-nums'],
  },
});

export default SessionClocks;
