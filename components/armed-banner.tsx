import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Radio } from 'lucide-react-native';
import type { NewsSchedule } from '@/services/api';

/**
 * A standing reminder that something is armed.
 *
 * Anything that fires on its own, hours from now, with real money, has to say
 * so continuously. A schedule you have forgotten about is the same problem as
 * a schedule you never meant to place. So this sits on the calendar screen for
 * as long as anything is armed, counts down to the nearest one, and does not
 * hide.
 *
 * It only reads. Tapping opens the full-screen countdown; nothing here can
 * clear a schedule by accident.
 */

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function until(ms: number): string {
  if (ms <= 0) return 'now';
  const t = Math.ceil(ms / 1000);
  if (t < 60) return `${t}s`;
  const m = Math.floor(t / 60);
  if (m < 60) return `${m}:${pad(t % 60)}`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad(m % 60)}m`;
}

export function ArmedBanner({
  schedules,
  accent,
  onPress,
}: {
  schedules: NewsSchedule[];
  accent: string;
  onPress?: (s: NewsSchedule) => void;
}) {
  const [now, setNow] = useState(Date.now());

  const armed = schedules.filter((s) => s.status === 'armed');

  // Ticks only while something is armed, and only once a second.
  useEffect(() => {
    if (armed.length === 0) return;
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, [armed.length]);

  if (armed.length === 0) return null;

  const next = armed.reduce((a, b) => (a.fireAt <= b.fireAt ? a : b));
  const left = next.fireAt - now;
  // Inside the last minute it stops being a reminder and starts being urgent.
  const urgent = left <= 60_000;

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      onPress={() => onPress?.(next)}
      style={[
        styles.bar,
        { borderColor: urgent ? '#E58272' : accent, backgroundColor: urgent ? 'rgba(229,130,114,0.10)' : 'rgba(255,255,255,0.03)' },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: urgent ? '#E58272' : accent }]} />
      <Radio size={13} color={urgent ? '#E58272' : accent} strokeWidth={2.4} />
      <Text style={[styles.label, { color: urgent ? '#E58272' : accent }]}>ARMED</Text>
      <Text style={styles.detail} numberOfLines={1}>
        {armed.length > 1 ? `${armed.length} trades · ` : ''}
        {next.symbol} ×{next.count} in {until(left)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 12,
    paddingVertical: 9, paddingHorizontal: 13,
    borderRadius: 10, borderWidth: 1,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  label: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1.4 },
  detail: { flex: 1, color: '#9AA0A5', fontSize: 11.5 },
});

export default ArmedBanner;
