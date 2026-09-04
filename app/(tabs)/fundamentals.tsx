import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { CalendarDays, RefreshCw, AlertTriangle, Menu, ArrowLeft } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTheme } from '@/providers/theme-provider';
import { useSidebar } from '@/providers/sidebar-provider';
import { useApp } from '@/providers/app-provider';
import { getFundamentals, getNewsSchedules, type CalendarEvent, type NewsSchedule } from '@/services/api';
import { SessionClocks } from '@/components/session-clocks';
import { ImpactBulls } from '@/components/impact-bulls';
import { CurrencyFlag } from '@/components/currency-flag';
import { NewsTradeModal } from '@/components/news-trade-modal';

/**
 * Fundamentals — this week's economic calendar.
 *
 * The releases that actually move price: rate decisions, CPI, NFP. Grouped by
 * day with the high-impact ones marked, so a trader can see what's coming
 * before arming a bot into it. Tap an event to schedule a trade against it.
 *
 * Data comes through our own /api/fundamentals proxy: the upstream feed sends
 * no CORS header and would be blocked in the browser/PWA.
 */

type DayFilter = 'today' | 'tomorrow' | 'all';

/**
 * How long a release stays listed after its moment. A few minutes, because the
 * figure lands on the minute and traders look at the row immediately after.
 */
const EXPIRY_GRACE_MS = 5 * 60_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Is this release inside the chosen window? `all` is the rest of the week. */
function inWindow(iso: string, filter: DayFilter): boolean {
  if (filter === 'all') return true;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return true; // undated: never hide it
  const today = startOfDay(new Date());
  const day = startOfDay(new Date(t));
  const DAY = 86_400_000;
  return filter === 'today' ? day === today : day === today + DAY;
}

const IMPACT_COLOR: Record<CalendarEvent['impact'], string> = {
  High: '#FF1A1A',
  Medium: '#FFB800',
  Low: '#808080',
  Holiday: '#00BFFF',
};

const dayKey = (iso: string) => new Date(iso).toDateString();

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  if (d.toDateString() === tomorrow.toDateString()) return 'TOMORROW';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase();
};

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * Live wall clock, twinned with the impact filter.
 *
 * Its own component so the per-second tick re-renders eight characters rather
 * than the whole calendar list underneath it.
 */
function ClockPill({ accent, accentRgb }: { accent: string; accentRgb: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <View style={[styles.pill, { borderColor: accent, backgroundColor: `rgba(${accentRgb}, 0.12)` }]}>
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <Text style={[styles.pillText, styles.clockText, { color: accent }]}>
        {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
      </Text>
    </View>
  );
}

export default function FundamentalsScreen() {
  const { theme, glassMode } = useTheme();
  const { open: openSidebar } = useSidebar();
  const { mt5Account } = useApp();
  const ac = theme.accent;
  const a = theme.accentRgb;
  const isNeon = glassMode === 'neon';

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highOnly, setHighOnly] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      setEvents(await getFundamentals());
    } catch (e: any) {
      setError(e?.message || 'Could not load the economic calendar.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const [dayFilter, setDayFilter] = useState<DayFilter>('all');
  // Re-evaluates once a minute so a release drops off the list as its time
  // passes, rather than lingering until the next manual refresh.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const h = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(h);
  }, []);

  // Group by day, honouring the impact and day filters.
  //
  // A release that has already happened is dropped outright. The list exists to
  // show what is still coming; once the moment passes there is nothing left to
  // arm, and a stale row invites a trade that can no longer be placed.
  const days = useMemo(() => {
    const now = Date.now();
    const upcoming = events.filter((e) => {
      const t = new Date(e.date).getTime();
      return !Number.isFinite(t) || t >= now - EXPIRY_GRACE_MS;
    });
    const byImpact = highOnly ? upcoming.filter((e) => e.impact === 'High') : upcoming;
    const filtered = byImpact.filter((e) => inWindow(e.date, dayFilter));
    const map = new Map<string, CalendarEvent[]>();
    for (const e of filtered) {
      const k = dayKey(e.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return [...map.entries()];
  }, [events, highOnly, dayFilter, tick]);

  const highCount = useMemo(() => {
    const now = Date.now();
    return events.filter((e) => {
      const t = new Date(e.date).getTime();
      return e.impact === 'High' && (!Number.isFinite(t) || t >= now - EXPIRY_GRACE_MS);
    }).length;
  }, [events, tick]);

  // Scheduled news trades live on the server; this mirrors them so rows can
  // show what is armed without asking on every render.
  const [tradeEvent, setTradeEvent] = useState<CalendarEvent | null>(null);
  const [schedules, setSchedules] = useState<NewsSchedule[]>([]);

  const refreshSchedules = useCallback(async () => {
    const uuid = mt5Account?.uuid;
    if (!uuid) { setSchedules([]); return; }
    setSchedules(await getNewsSchedules(uuid));
  }, [mt5Account?.uuid]);

  useEffect(() => { void refreshSchedules(); }, [refreshSchedules]);

  const armedFor = useCallback(
    (eventId: string) => schedules.filter((x) => x.eventId === eventId && x.status === 'armed'),
    [schedules],
  );

  const cardGlass = Platform.OS === 'web'
    ? (isNeon
      ? ({ background: `linear-gradient(180deg, rgba(${a}, 0.06) 0%, rgba(0,0,0,0.65) 100%)`, backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' } as any)
      : ({ background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.5) 100%)', backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)' } as any))
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {/* Back leads, menu follows. Unlike EA Converter this corner was
            already taken, so the two sit side by side rather than the back
            control displacing the menu.

            Goes to Home rather than router.back(): this screen is reached
            from the home row and from the drawer, so "back" is ambiguous
            but "home" is not. */}
        <View style={styles.headerTop}>
          <TouchableOpacity
            onPress={() => router.replace('/(tabs)')}
            style={styles.iconBtn}
            activeOpacity={0.7}
            testID="fundamentals-back"
          >
            <ArrowLeft size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <TouchableOpacity onPress={openSidebar} style={styles.iconBtn} activeOpacity={0.7}>
            <Menu size={20} color="#FFFFFF" />
          </TouchableOpacity>
        </View>
        <View style={styles.titleRow}>
          <CalendarDays size={16} color={ac} strokeWidth={2.3} />
          <Text style={[styles.title, { color: ac }]}>FUNDAMENTALS</Text>
        </View>
        <Text style={styles.subtitle}>This week&apos;s economic calendar</Text>
      </View>

      {/* Which desks are awake, above the calendar it frames. */}
      <SessionClocks />

      <View style={styles.controls}>
        <View style={styles.pillRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => setHighOnly((v) => !v)}
            style={[
              styles.pill,
              highOnly && { borderColor: ac, backgroundColor: `rgba(${a}, 0.12)` },
            ]}
          >
            <View style={[styles.dot, { backgroundColor: IMPACT_COLOR.High }]} />
            <Text style={[styles.pillText, highOnly && { color: ac }]}>
              HIGH IMPACT{highCount ? ` · ${highCount}` : ''}
            </Text>
          </TouchableOpacity>

          <ClockPill accent={ac} accentRgb={a} />
        </View>

        <TouchableOpacity activeOpacity={0.7} onPress={() => load(true)} style={styles.refreshBtn}>
          <RefreshCw size={15} color="#B3B3B3" strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      {/* Day window. `ALL` is the rest of the week, which is as far as
          the feed goes, so it doubles as the default. */}
      <View style={styles.dayRow}>
        {([['today', 'TODAY'], ['tomorrow', 'TOMORROW'], ['all', 'ALL WEEK']] as const).map(([key, label]) => {
          const on = dayFilter === key;
          return (
            <TouchableOpacity
              key={key}
              activeOpacity={0.8}
              onPress={() => setDayFilter(key)}
              style={[styles.dayChip, on && { borderColor: ac + 'AA', backgroundColor: ac + '18' }]}
            >
              <Text style={[styles.dayChipText, on && { color: ac }]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator color={ac} />
          <Text style={styles.centreText}>Loading calendar…</Text>
        </View>
      ) : error ? (
        <View style={styles.centre}>
          <AlertTriangle size={22} color="#FFB800" />
          <Text style={styles.centreText}>{error}</Text>
          <TouchableOpacity onPress={() => load(true)} style={[styles.retry, { borderColor: ac }]}>
            <Text style={[styles.retryText, { color: ac }]}>RETRY</Text>
          </TouchableOpacity>
        </View>
      ) : days.length === 0 ? (
        <View style={styles.centre}>
          <Text style={styles.centreText}>
            {highOnly ? 'No high-impact releases this week.' : 'No events scheduled this week.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={ac} />
          }
        >
          {days.map(([key, items]) => (
            <View key={key} style={styles.daySection}>
              <Text style={[styles.dayLabel, { color: ac }]}>{dayLabel(items[0].date)}</Text>

              {items.map((e) => {
                const armed = armedFor(e.id);
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={[styles.row, cardGlass]}
                    activeOpacity={0.75}
                    onPress={() => setTradeEvent(e)}
                  >
                    <View style={styles.rowLeft}>
                      <Text style={styles.time}>{timeLabel(e.date)}</Text>
                      <ImpactBulls impact={e.impact} />
                    </View>

                    <View style={styles.rowBody}>
                      <View style={styles.rowTitleLine}>
                        <Text style={[styles.currency, { color: ac }]}>{e.currency}</Text>
                        <Text style={styles.eventTitle} numberOfLines={2}>{e.title}</Text>
                      </View>

                      {/* Only the figures that exist — a row of dashes is
                          noise, not information. */}
                      {(e.actual || e.forecast || e.previous) ? (
                        <View style={styles.figures}>
                          {!!e.actual && (
                            <Text style={styles.figure}>
                              <Text style={styles.figureLabel}>ACT </Text>
                              <Text style={{ color: '#00FF88' }}>{e.actual}</Text>
                            </Text>
                          )}
                          {!!e.forecast && (
                            <Text style={styles.figure}>
                              <Text style={styles.figureLabel}>FC </Text>{e.forecast}
                            </Text>
                          )}
                          {!!e.previous && (
                            <Text style={styles.figure}>
                              <Text style={styles.figureLabel}>PREV </Text>{e.previous}
                            </Text>
                          )}
                        </View>
                      ) : null}

                      {/* What's armed on this release, so the row says so
                          without needing to be opened. */}
                      {armed.length > 0 && (
                        <View style={styles.armedRow}>
                          {armed.map((x) => (
                            <View
                              key={`${x.eventId}-${x.symbol}`}
                              style={[
                                styles.armedChip,
                                { borderColor: x.direction === 'Buy' ? '#00FF88' : '#FF1A1A' },
                              ]}
                            >
                              <Text
                                style={styles.armedChipText}
                              >
                                {x.symbol} ×{x.count} · {x.leadSeconds}s
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>

                    {/* Trailing corner: whose currency this release moves.
                        Aligned to the top so it tracks the title line rather
                        than drifting down as the figures wrap. */}
                    <View style={styles.rowFlag}>
                      <CurrencyFlag currency={e.currency} />
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}

          <Text style={styles.footnote}>Times shown in your local timezone.</Text>
        </ScrollView>
      )}

      <NewsTradeModal
        event={tradeEvent}
        visible={!!tradeEvent}
        existing={tradeEvent ? armedFor(tradeEvent.id) : []}
        onClose={() => setTradeEvent(null)}
        onChanged={refreshSchedules}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#050505' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  iconBtn: {
    padding: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: 2 },
  subtitle: { color: '#808080', fontSize: 12, marginTop: 6 },

  dayRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingBottom: 10 },
  dayChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.03)',
  },
  dayChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#6B7280' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pillText: { fontSize: 9.5, fontWeight: '800', letterSpacing: 1.6, color: '#B3B3B3' },
  clockText: { letterSpacing: 1.2, fontVariant: ['tabular-nums'] },
  dot: { width: 7, height: 7, borderRadius: 4 },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 12 },
  centreText: { color: '#B3B3B3', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retry: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 22, paddingVertical: 10 },
  retryText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.6 },

  list: { paddingHorizontal: 16, paddingBottom: 40 },
  daySection: { marginBottom: 20 },
  dayLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 10 },
  row: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'rgba(44, 44, 46, 0.65)',
    borderRadius: 18,
    padding: 14,
    marginBottom: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  rowLeft: { alignItems: 'center', gap: 7, width: 60 },
  time: { color: '#B3B3B3', fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  rowBody: { flex: 1, minWidth: 0 },
  rowFlag: { paddingLeft: 10, paddingTop: 1, alignSelf: 'flex-start' },
  rowTitleLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  currency: { fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 1 },
  eventTitle: { color: '#FFFFFF', fontSize: 13, flex: 1, lineHeight: 18 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6 },
  figure: { color: '#B3B3B3', fontSize: 11, fontVariant: ['tabular-nums'] },
  figureLabel: { color: '#666666', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },

  armedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 },
  armedChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  armedChipText: { fontSize: 8.5, fontWeight: '800', letterSpacing: 0.8 },

  footnote: { color: '#666666', fontSize: 10, textAlign: 'center', marginTop: 6 },
});
