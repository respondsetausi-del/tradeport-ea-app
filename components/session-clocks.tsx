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
  Flag: (p: FlagProps) => React.ReactElement;
}

// ── Flags ──────────────────────────────────────────────────────────────
// Drawn on a 3:2 canvas, the real proportion of every flag here. The coin
// crops from the same source with preserveAspectRatio="xMidYMid slice", so
// there is one definition rather than a square version and a wide version
// that can drift apart.

type FlagProps = { width: number; height: number; crop?: boolean };

const fit = (crop?: boolean) => (crop ? 'xMidYMid slice' : 'xMidYMid meet');

function FlagAU({ width, height, crop }: FlagProps) {
  const star = (cx: number, cy: number, r: number) => (
    <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="#ffffff" />
  );
  return (
    <Svg width={width} height={height} viewBox="0 0 90 60" preserveAspectRatio={fit(crop)}>
      <Rect width="90" height="60" fill="#00247D" />
      {/* Union canton fills the upper hoist quarter. */}
      <G>
        <Path d="M0 0 L45 30 M45 0 L0 30" stroke="#ffffff" strokeWidth="6" />
        <Path d="M0 0 L45 30 M45 0 L0 30" stroke="#CF142B" strokeWidth="3" />
        <Rect x="19" y="0" width="7" height="30" fill="#ffffff" />
        <Rect x="0" y="11.5" width="45" height="7" fill="#ffffff" />
        <Rect x="20.75" y="0" width="3.5" height="30" fill="#CF142B" />
        <Rect x="0" y="13.25" width="45" height="3.5" fill="#CF142B" />
      </G>
      {/* Commonwealth Star below the canton, Southern Cross on the fly. */}
      {star(22, 45, 5)}
      {star(66, 13, 3)}
      {star(76, 28, 3)}
      {star(64, 44, 3)}
      {star(71, 37, 1.8)}
    </Svg>
  );
}

function FlagJP({ width, height, crop }: FlagProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 90 60" preserveAspectRatio={fit(crop)}>
      <Rect width="90" height="60" fill="#ffffff" />
      <Circle cx="45" cy="30" r="18" fill="#BC002D" />
    </Svg>
  );
}

function FlagGB({ width, height, crop }: FlagProps) {
  return (
    <Svg width={width} height={height} viewBox="0 0 90 60" preserveAspectRatio={fit(crop)}>
      <Rect width="90" height="60" fill="#00247D" />
      <Path d="M0 0 L90 60 M90 0 L0 60" stroke="#ffffff" strokeWidth="12" />
      <Path d="M0 0 L90 60 M90 0 L0 60" stroke="#CF142B" strokeWidth="6" />
      <Rect x="37" y="0" width="16" height="60" fill="#ffffff" />
      <Rect x="0" y="22" width="90" height="16" fill="#ffffff" />
      <Rect x="40" y="0" width="10" height="60" fill="#CF142B" />
      <Rect x="0" y="25" width="90" height="10" fill="#CF142B" />
    </Svg>
  );
}

function FlagUS({ width, height, crop }: FlagProps) {
  const stripes = [];
  for (let i = 0; i < 13; i++) {
    stripes.push(
      <Rect key={i} x="0" y={(60 / 13) * i} width="90" height={60 / 13}
        fill={i % 2 === 0 ? '#B22234' : '#ffffff'} />,
    );
  }
  const stars = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      stars.push(
        <Circle key={`${r}-${c}`} cx={4 + c * 6} cy={3.5 + r * 6} r="1.6" fill="#ffffff" />,
      );
    }
  }
  return (
    <Svg width={width} height={height} viewBox="0 0 90 60" preserveAspectRatio={fit(crop)}>
      {stripes}
      <Rect x="0" y="0" width="38" height={(60 / 13) * 7} fill="#3C3B6E" />
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
        Animated.timing(rise, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(rise, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
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
          <Flag width={SIZE} height={SIZE} crop />
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

/**
 * The open session's flag, full and flying.
 *
 * The coins below crop each flag into a disc, which is right for a row of four
 * but loses the flag itself. This shows the current one whole, at proper 3:2,
 * with a flutter.
 *
 * The flutter is a skew oscillation plus a travelling highlight rather than a
 * real cloth simulation: React Native cannot distort per-column, and at this
 * size a skew and a moving sheen read as fabric while a mesh warp would be a
 * lot of machinery for a 100px flag.
 *
 * When more than one desk is open it cycles through them, because "the current
 * session" is genuinely plural during the London/New York overlap and picking
 * one would be arbitrary.
 */
function CurrentSessionFlag({
  openRows,
  accent,
}: {
  openRows: { session: Session; mins: number }[];
  accent: string;
}) {
  const [index, setIndex] = useState(0);
  const wave = useRef(new Animated.Value(0)).current;
  const sheen = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  // Flutter: a continuous, slightly irregular skew so it does not read as a
  // metronome.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(wave, { toValue: -1, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(wave, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [wave]);

  // A highlight crossing the cloth, on a longer beat than the flutter.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(sheen, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(sheen, { toValue: 0, duration: 0, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sheen]);

  // Cycle through the open desks, cross-fading.
  useEffect(() => {
    if (openRows.length < 2) { setIndex(0); return; }
    const id = setInterval(() => {
      Animated.sequence([
        Animated.timing(fade, { toValue: 0, duration: 260, useNativeDriver: false }),
        Animated.timing(fade, { toValue: 1, duration: 320, useNativeDriver: false }),
      ]).start();
      // Swap at the darkest point so the change is not seen mid-fade.
      setTimeout(() => setIndex((i) => (i + 1) % openRows.length), 260);
    }, 4200);
    return () => clearInterval(id);
  }, [openRows.length, fade]);

  if (openRows.length === 0) return null;

  const row = openRows[Math.min(index, openRows.length - 1)];
  const { Flag } = row.session;
  const W = 108;
  const H = 72;

  const tilt = wave.interpolate({ inputRange: [-1, 1], outputRange: ['-2.2deg', '2.2deg'] });
  const furl = wave.interpolate({ inputRange: [-1, 1], outputRange: [0.955, 1] });
  const lift = wave.interpolate({ inputRange: [-1, 1], outputRange: [2, -2] });
  const sheenX = sheen.interpolate({ inputRange: [0, 1], outputRange: [-W, W * 1.3] });

  return (
    <Animated.View style={[heroStyles.wrap, { opacity: fade }]}>
      <Animated.View
        style={[
          heroStyles.cloth,
          { borderColor: accent, transform: [{ rotate: tilt }, { scaleX: furl }, { translateY: lift }] },
        ]}
      >
        <Flag width={W} height={H} />
        {/* Travelling sheen, clipped to the cloth. */}
        <Animated.View
          style={[heroStyles.sheen, { transform: [{ translateX: sheenX }, { rotate: '14deg' }] }]}
          pointerEvents="none"
        />
      </Animated.View>

      <Text style={[heroStyles.city, { color: accent }]} numberOfLines={1}>
        {row.session.city} OPEN
      </Text>
      <Text style={heroStyles.sub} numberOfLines={1}>
        {openRows.length > 1
          ? `${openRows.length} desks trading · closes in ${formatFlip(row.mins)}`
          : `Closes in ${formatFlip(row.mins)}`}
      </Text>
    </Animated.View>
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

  // The next desk to open, by name. "2 OPEN" says how many but not what is
  // coming, which is the thing you plan around.
  const upcoming = rows
    .filter((r) => !r.open)
    .sort((a, b) => a.mins - b.mins)[0];

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.label}>MARKET SESSIONS</Text>
        <View style={styles.headRight}>
          <Text style={[styles.count, openCount > 0 && { color: theme.accent }]}>
            {openCount === 0 ? 'ALL CLOSED' : `${openCount} OPEN`}
          </Text>
          {!!upcoming && (
            <Text style={styles.next} numberOfLines={1}>
              NEXT · {upcoming.session.city} IN {formatFlip(upcoming.mins)}
            </Text>
          )}
        </View>
      </View>

      <CurrentSessionFlag openRows={rows.filter((r) => r.open)} accent={theme.accent} />

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
  headRight: { alignItems: 'flex-end' },
  next: { fontSize: 8, fontWeight: '700', letterSpacing: 1, color: '#6d7a72', marginTop: 3 },
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

const heroStyles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 18 },
  cloth: {
    width: 108,
    height: 72,
    borderRadius: 6,
    borderWidth: 1.5,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  sheen: {
    position: 'absolute',
    top: -30,
    bottom: -30,
    width: 26,
    backgroundColor: 'rgba(255,255,255,0.30)',
  },
  city: { marginTop: 10, fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  sub: { marginTop: 3, fontSize: 9.5, fontWeight: '600', color: '#7a8880', letterSpacing: 0.4 },
});

export default SessionClocks;
