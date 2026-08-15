import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, SafeAreaView, ScrollView, TouchableOpacity, ActivityIndicator, Platform, RefreshControl } from 'react-native';
import { ArrowLeft, RefreshCw, Landmark } from 'lucide-react-native';
import { router } from 'expo-router';
import { useTheme } from '@/providers/theme-provider';
import { PageBackground } from '@/components/page-background';
import { FundamentalEvent, apiService } from '@/services/api';

type ImpactFilter = 'ALL' | 'High' | 'Medium' | 'Low';

const IMPACT_COLORS: Record<string, string> = {
  High: '#FF4444',
  Medium: '#FFAA00',
  Low: '#00FF88',
  Holiday: '#888888',
  'Non-Economic': '#888888',
};

function impactColor(impact: string): string {
  return IMPACT_COLORS[impact] || '#888888';
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function FundamentalsScreen() {
  const { theme: thm, glassMode } = useTheme();
  const a = thm.accentRgb;
  const ac = thm.accent;
  const isNeon = glassMode === 'neon';
  const isLiquid = glassMode === 'liquid';
  const isCmd = glassMode === 'commander';

  const [events, setEvents] = useState<FundamentalEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const fetchEvents = useCallback(async (showRefreshIndicator = false) => {
    try {
      if (showRefreshIndicator) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);
      const res = await apiService.getFundamentals();
      setEvents(res.events);
      setUpdatedAt(res.updatedAt || null);
    } catch (e) {
      console.error('Error fetching fundamentals:', e);
      setError('Failed to load economic calendar. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents(false);
  }, [fetchEvents]);

  const currencies = useMemo(() => {
    const set = new Set<string>();
    events.forEach((e) => { if (e.currency) set.add(e.currency); });
    return ['ALL', ...Array.from(set).sort()];
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (impactFilter !== 'ALL' && e.impact !== impactFilter) return false;
      if (currencyFilter !== 'ALL' && e.currency !== currencyFilter) return false;
      return true;
    });
  }, [events, impactFilter, currencyFilter]);

  const groupedByDay = useMemo(() => {
    const groups: { key: string; label: string; isToday: boolean; items: FundamentalEvent[] }[] = [];
    const todayKey = dayKey(new Date().toISOString());
    filteredEvents.forEach((e) => {
      const key = dayKey(e.date);
      let group = groups.find((g) => g.key === key);
      if (!group) {
        group = { key, label: dayLabel(e.date), isToday: key === todayKey, items: [] };
        groups.push(group);
      }
      group.items.push(e);
    });
    return groups;
  }, [filteredEvents]);

  const handleBack = () => {
    router.back();
  };

  const cardWebStyle = Platform.OS === 'web'
    ? (isNeon
      ? { background: 'radial-gradient(ellipse 120% 50% at 20% 20%, rgba(255,255,255,0.12) 0%, transparent 70%), linear-gradient(180deg, rgba(' + a + ', 0.06) 0%, rgba(0,0,0,0.65) 100%)', backdropFilter: 'blur(60px) saturate(180%)', WebkitBackdropFilter: 'blur(60px) saturate(180%)', boxShadow: 'inset 0 0.5px 0 rgba(255,255,255,0.2), 0 4px 8px rgba(0,0,0,0.3)' }
      : isLiquid
        ? { background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.4) 100%)', backdropFilter: 'blur(60px) saturate(180%)', WebkitBackdropFilter: 'blur(60px) saturate(180%)', borderColor: 'rgba(' + a + ', 0.3)' }
        : isCmd
          ? { background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'rgba(' + a + ', 0.5)' }
          : { background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0.5) 100%)', backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)' })
    : undefined;

  return (
    <SafeAreaView style={[styles.container, Platform.OS === 'web' && { backgroundImage: isNeon ? 'linear-gradient(135deg, rgba(' + a + ', 0.9) 0%, rgba(' + a + ', 0.5) 30%, rgba(' + a + ', 0.1) 65%, rgba(0,0,0,0.95) 90%, #000 100%)' : isLiquid ? 'linear-gradient(160deg, #1a1a1e 0%, #111113 40%, #0a0a0c 100%)' : isCmd ? 'linear-gradient(170deg, rgba(30,10,10,0.6) 0%, #050505 40%, #000 100%)' : 'linear-gradient(160deg, rgba(' + a + ', 0.08) 0%, #050505 40%, #000 100%)' }]}>
      <PageBackground eaImage={null} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>

        <View style={styles.headerContent}>
          <View style={styles.titleContainer}>
            <Landmark color={ac} size={18} style={styles.titleIcon} />
            <Text style={[styles.headerTitle, { color: ac }]}>FUNDAMENTALS</Text>
          </View>
          <Text style={styles.subtitle}>This Week&apos;s Economic Calendar</Text>
          {updatedAt && (
            <Text style={styles.updatedText}>Updated {timeLabel(updatedAt)}</Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.refreshButton, refreshing && styles.refreshButtonDisabled]}
          onPress={() => fetchEvents(true)}
          disabled={refreshing}
          activeOpacity={refreshing ? 1 : 0.7}
        >
          <RefreshCw color={refreshing ? '#666666' : '#FFFFFF'} size={20} />
        </TouchableOpacity>
      </View>

      {/* Impact filter */}
      <View style={styles.impactRow}>
        {(['ALL', 'High', 'Medium', 'Low'] as ImpactFilter[]).map((imp) => (
          <TouchableOpacity
            key={imp}
            style={[styles.impactChip, impactFilter === imp && { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: imp === 'ALL' ? 'rgba(255,255,255,0.4)' : impactColor(imp) }]}
            onPress={() => setImpactFilter(imp)}
          >
            {imp !== 'ALL' && <View style={[styles.impactDot, { backgroundColor: impactColor(imp) }]} />}
            <Text style={[styles.impactChipText, impactFilter === imp && { color: '#FFFFFF' }]}>{imp === 'ALL' ? 'ALL' : imp.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Currency filter */}
      {currencies.length > 2 && (
        <View style={styles.currencyRowWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.currencyRow}>
            {currencies.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.currencyChip, currencyFilter === c && { backgroundColor: 'rgba(' + a + ', 0.15)', borderColor: 'rgba(' + a + ', 0.5)' }]}
                onPress={() => setCurrencyFilter(c)}
              >
                <Text style={[styles.currencyChipText, currencyFilter === c && { color: '#FFFFFF' }]}>{c}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Content */}
      <View style={styles.content}>
        {loading && !refreshing ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator testID="fundamentals-loading" size="large" color={ac} />
            <Text style={styles.loadingText}>Loading economic calendar...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => fetchEvents(false)}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchEvents(true)} tintColor={ac} colors={[ac]} />}
          >
            {groupedByDay.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No events found</Text>
                <Text style={styles.emptySubtext}>Try a different impact or currency filter</Text>
              </View>
            ) : (
              groupedByDay.map((group) => (
                <View key={group.key}>
                  <View style={styles.dayHeader}>
                    <Text style={[styles.dayHeaderText, group.isToday && { color: ac }]}>
                      {group.isToday ? 'TODAY · ' + group.label : group.label}
                    </Text>
                    <View style={[styles.dayHeaderLine, group.isToday && { backgroundColor: 'rgba(' + a + ', 0.4)' }]} />
                  </View>

                  {group.items.map((event, idx) => (
                    <View
                      key={group.key + '-' + idx}
                      style={[styles.eventCard, cardWebStyle as any]}
                    >
                      <View style={[styles.impactBar, { backgroundColor: impactColor(event.impact) }]} />
                      <View style={styles.eventBody}>
                        <View style={styles.eventTopRow}>
                          <Text style={styles.eventTime}>{timeLabel(event.date)}</Text>
                          <View style={styles.currencyBadge}>
                            <Text style={styles.currencyBadgeText}>{event.currency || '—'}</Text>
                          </View>
                          <View style={[styles.impactBadge, { borderColor: impactColor(event.impact) }]}>
                            <Text style={[styles.impactBadgeText, { color: impactColor(event.impact) }]}>
                              {event.impact.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.eventTitle}>{event.title}</Text>
                        {(event.actual || event.forecast || event.previous) && (
                          <View style={styles.valuesRow}>
                            {event.actual ? (
                              <View style={styles.valueColumn}>
                                <Text style={styles.valueLabel}>ACTUAL</Text>
                                <Text style={[styles.valueText, { color: '#FFFFFF' }]}>{event.actual}</Text>
                              </View>
                            ) : null}
                            <View style={styles.valueColumn}>
                              <Text style={styles.valueLabel}>FORECAST</Text>
                              <Text style={styles.valueText}>{event.forecast || '—'}</Text>
                            </View>
                            <View style={styles.valueColumn}>
                              <Text style={styles.valueLabel}>PREVIOUS</Text>
                              <Text style={styles.valueText}>{event.previous || '—'}</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
            <Text style={styles.sourceNote}>Source: Forex Factory calendar (free feed) · Times shown in your local timezone</Text>
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050505',
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  backButton: {
    marginRight: 16, padding: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  headerContent: { flex: 1 },
  titleContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  titleIcon: { marginRight: 8 },
  headerTitle: { fontSize: 18, fontWeight: '800', letterSpacing: 1.5 },
  subtitle: { color: '#CCCCCC', fontSize: 12, fontWeight: '500' },
  updatedText: { color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '400', marginTop: 2 },
  refreshButton: {
    padding: 10, marginLeft: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  refreshButtonDisabled: { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  impactRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingTop: 14,
  },
  impactChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  impactDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  impactChipText: { color: 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  currencyRowWrap: { paddingTop: 10 },
  currencyRow: { paddingHorizontal: 20, gap: 6 },
  currencyChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  currencyChipText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', letterSpacing: 0.5, fontFamily: 'monospace' },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 14 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  loadingText: { color: '#CCCCCC', fontSize: 16, marginTop: 16, fontWeight: '500' },
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60, paddingHorizontal: 20 },
  errorText: { color: '#FF4444', fontSize: 16, textAlign: 'center', marginBottom: 20, lineHeight: 24 },
  retryButton: {
    backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 28, paddingVertical: 14,
    borderRadius: 16, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)',
  },
  retryButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  emptyText: { color: '#CCCCCC', fontSize: 18, fontWeight: '600', marginBottom: 8 },
  emptySubtext: { color: 'rgba(255,255,255,0.4)', fontSize: 14, textAlign: 'center' },
  dayHeader: { flexDirection: 'row', alignItems: 'center', marginTop: 10, marginBottom: 12 },
  dayHeaderText: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginRight: 12 },
  dayHeaderLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(44, 44, 46, 0.65)', borderRadius: 18, marginBottom: 10,
    borderWidth: 0.5, borderColor: 'rgba(255, 255, 255, 0.12)',
    overflow: 'hidden',
    ...(Platform.OS !== 'web' && {
      shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.3, shadowRadius: 12, elevation: 4,
    }),
  },
  impactBar: { width: 3 },
  eventBody: { flex: 1, padding: 14 },
  eventTopRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  eventTime: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600', fontFamily: 'monospace', marginRight: 10 },
  currencyBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    marginRight: 8,
  },
  currencyBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 0.5 },
  impactBadge: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8,
    borderWidth: 1,
  },
  impactBadgeText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  eventTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', lineHeight: 20, marginBottom: 4 },
  valuesRow: { flexDirection: 'row', marginTop: 6 },
  valueColumn: { marginRight: 24 },
  valueLabel: { color: 'rgba(255,255,255,0.35)', fontSize: 9, fontWeight: '700', letterSpacing: 0.8, marginBottom: 3 },
  valueText: { color: '#CCCCCC', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  sourceNote: { color: 'rgba(255,255,255,0.3)', fontSize: 10, textAlign: 'center', paddingVertical: 20 },
});
