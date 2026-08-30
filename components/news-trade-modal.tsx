import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { X, TrendingUp, TrendingDown, Trash2 } from 'lucide-react-native';
import { useTheme } from '@/providers/theme-provider';
import { useApp } from '@/providers/app-provider';
import {
  apiService,
  scheduleNewsTrade,
  cancelNewsSchedule,
  type CalendarEvent,
  type NewsSchedule,
} from '@/services/api';

/**
 * Arm a trade against a calendar release.
 *
 * The schedule is held on the server, not here: a release is usually hours
 * away, and a timer in the app only survives while the app is open. The events
 * worth trading are the ones you are not sitting and watching.
 *
 * A symbol picker rather than deriving the pair from the event currency: an
 * NZD release does not say whether you want NZDUSD, NZDJPY or gold, and
 * guessing wrong places a real order on the wrong instrument.
 */

const LEAD_PRESETS = [5, 15, 30, 60];

export function NewsTradeModal({
  event,
  visible,
  existing,
  onClose,
  onChanged,
}: {
  event: CalendarEvent | null;
  visible: boolean;
  /** Already-armed schedules for this event, so it can offer to cancel. */
  existing: NewsSchedule[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { theme } = useTheme();
  const ac = theme.accent;
  const a = theme.accentRgb;
  const { mt5Symbols, mt5Account } = useApp();

  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'Buy' | 'Sell'>('Buy');
  const [leadSeconds, setLeadSeconds] = useState('30');
  const [count, setCount] = useState('1');
  const [lot, setLot] = useState('0.01');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The broker's full list, so this does not dead-end when nothing is
  // configured under Quotes yet.
  const [brokerSymbols, setBrokerSymbols] = useState<string[]>([]);
  const [loadingSymbols, setLoadingSymbols] = useState(false);

  const eventAt = useMemo(
    () => (event?.date ? new Date(event.date).getTime() : NaN),
    [event?.date],
  );

  useEffect(() => {
    let cancelled = false;
    const uuid = mt5Account?.uuid;
    if (!visible || !uuid) return;
    setLoadingSymbols(true);
    apiService.getMT5Symbols(uuid)
      .then((list: any) => { if (!cancelled) setBrokerSymbols(Array.isArray(list) ? list : []); })
      .catch(() => { if (!cancelled) setBrokerSymbols([]); })
      .finally(() => { if (!cancelled) setLoadingSymbols(false); });
    return () => { cancelled = true; };
  }, [visible, mt5Account?.uuid]);

  useEffect(() => {
    if (!visible || !event) return;
    const cur = (event.currency || '').toUpperCase();
    const match = mt5Symbols.find((m: any) => m.symbol.toUpperCase().includes(cur));
    setSymbol((match || mt5Symbols[0])?.symbol ?? '');
    setDirection('Buy');
    setLeadSeconds('30');
    setCount('1');
    setQuery('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, event?.id]);

  // Lot follows the symbol's saved config when it has one, but stays editable:
  // the broker list is far wider than the configured set.
  const cfg = mt5Symbols.find((m: any) => m.symbol === symbol);
  useEffect(() => {
    if (!symbol) return;
    setLot((cfg as any)?.lotSize || '0.01');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);
  const volume = parseFloat(lot) || 0;

  const configured = mt5Symbols.map((m: any) => m.symbol);
  const symbolOptions = useMemo(() => {
    const q = query.trim().toUpperCase();
    const rest = brokerSymbols.filter((x) => !configured.includes(x));
    const all = [...configured, ...rest];
    return (q ? all.filter((x) => x.toUpperCase().includes(q)) : all).slice(0, 60);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brokerSymbols, mt5Symbols]);

  const fireAt = Number.isFinite(eventAt) ? eventAt - (parseInt(leadSeconds, 10) || 0) * 1000 : NaN;
  const firesIn = Number.isFinite(fireAt) ? fireAt - Date.now() : NaN;
  const tooLate = Number.isFinite(firesIn) && firesIn <= 0;
  const armed = existing.filter((s) => s.status === 'armed');

  const handleArm = async () => {
    if (!event || !mt5Account?.uuid) { setError('Connect an MT5 account first.'); return; }
    if (!symbol) { setError('Pick a symbol first.'); return; }
    if (!(volume > 0)) { setError('Enter a lot size greater than zero.'); return; }
    setBusy(true);
    setError(null);
    try {
      await scheduleNewsTrade({
        uuid: mt5Account.uuid,
        eventId: event.id,
        eventTitle: event.title,
        currency: event.currency,
        symbol,
        direction,
        volume,
        count: parseInt(count, 10) || 1,
        leadSeconds: parseInt(leadSeconds, 10) || 0,
        eventAt,
      });
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Could not schedule that trade');
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async (s: NewsSchedule) => {
    if (!mt5Account?.uuid) return;
    setBusy(true);
    await cancelNewsSchedule(mt5Account.uuid, s.eventId, s.symbol);
    onChanged();
    setBusy(false);
  };

  const when = Number.isFinite(eventAt)
    ? new Date(eventAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const lead = (mins: number) =>
    mins < 60 ? `${Math.round(mins)}m` : `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.centre}
        >
          <View style={[styles.card, { borderColor: `rgba(${a}, 0.35)` }]}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={[styles.kicker, { color: ac }]}>TRADE THIS EVENT</Text>
                <Text style={styles.eventTitle} numberOfLines={2}>{event?.title || ''}</Text>
                <Text style={styles.eventMeta}>
                  {event?.currency}
                  {when ? ` · ${when}` : ''}
                  {event?.impact ? ` · ${event.impact.toUpperCase()} IMPACT` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={10}>
                <X color="#FFFFFF" size={17} />
              </TouchableOpacity>
            </View>

            <View style={[styles.rule, { backgroundColor: `rgba(${a}, 0.25)` }]} />

            <ScrollView keyboardShouldPersistTaps="handled" style={styles.body}>
              {armed.length > 0 && (
                <View style={styles.panel}>
                  <Text style={styles.label}>ALREADY ARMED</Text>
                  {armed.map((s) => (
                    <View key={`${s.eventId}-${s.symbol}`} style={styles.armedRow}>
                      <Text style={styles.armedText} numberOfLines={1}>
                        {s.direction.toUpperCase()} {s.symbol} ×{s.count} · {s.leadSeconds}s before
                      </Text>
                      <TouchableOpacity onPress={() => handleCancel(s)} hitSlop={10} disabled={busy}>
                        <Trash2 color="#FF1A1A" size={15} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.label}>SYMBOL</Text>
              <TextInput
                style={[styles.input, { borderColor: `rgba(${a}, 0.35)` }]}
                value={query}
                onChangeText={setQuery}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder={loadingSymbols ? 'Loading broker symbols…' : 'Search e.g. EURUSD'}
                placeholderTextColor="#666666"
              />

              {symbolOptions.length === 0 ? (
                <Text style={styles.empty}>
                  {loadingSymbols
                    ? 'Loading the broker symbol list…'
                    : brokerSymbols.length === 0
                      ? 'Could not load broker symbols. Connect MT5 under MetaTrader, or type a symbol you know and it will still arm.'
                      : `Nothing matches “${query}”.`}
                </Text>
              ) : (
                <View style={styles.chips}>
                  {symbolOptions.map((sym) => {
                    const on = sym === symbol;
                    return (
                      <TouchableOpacity
                        key={sym}
                        onPress={() => setSymbol(sym)}
                        activeOpacity={0.8}
                        style={[
                          styles.chip,
                          on && { borderColor: ac, backgroundColor: `rgba(${a}, 0.18)` },
                        ]}
                      >
                        <Text style={[styles.chipText, on && { color: ac }]}>{sym}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {/* Typed-but-unlisted symbols still arm: the broker is the final
                  authority on what exists, not our cached list. */}
              {!!query.trim() && !symbolOptions.includes(query.trim().toUpperCase()) && (
                <TouchableOpacity
                  onPress={() => setSymbol(query.trim().toUpperCase())}
                  style={[styles.useTyped, { borderColor: `rgba(${a}, 0.4)` }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.useTypedText, { color: ac }]}>
                    Use “{query.trim().toUpperCase()}” anyway
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={styles.label}>LOT SIZE</Text>
              <TextInput
                style={[styles.input, { borderColor: `rgba(${a}, 0.35)` }]}
                value={lot}
                onChangeText={setLot}
                keyboardType="decimal-pad"
                placeholder="0.01"
                placeholderTextColor="#666666"
              />

              <Text style={styles.label}>DIRECTION</Text>
              <View style={styles.dirRow}>
                {(['Buy', 'Sell'] as const).map((d) => {
                  const on = direction === d;
                  const tone = d === 'Buy' ? '#00FF88' : '#FF1A1A';
                  const Icon = d === 'Buy' ? TrendingUp : TrendingDown;
                  return (
                    <TouchableOpacity
                      key={d}
                      onPress={() => setDirection(d)}
                      activeOpacity={0.85}
                      style={[styles.dirBtn, on && { borderColor: tone, backgroundColor: tone + '1A' }]}
                    >
                      <Icon color={on ? tone : '#808080'} size={16} strokeWidth={2.4} />
                      <Text style={[styles.dirText, on && { color: tone }]}>{d.toUpperCase()}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>SECONDS BEFORE RELEASE</Text>
              <TextInput
                style={[styles.input, { borderColor: `rgba(${a}, 0.35)` }]}
                value={leadSeconds}
                onChangeText={setLeadSeconds}
                keyboardType="number-pad"
                placeholder="30"
                placeholderTextColor="#666666"
              />
              <View style={styles.presets}>
                {LEAD_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    onPress={() => setLeadSeconds(String(p))}
                    style={[styles.preset, leadSeconds === String(p) && { borderColor: ac }]}
                  >
                    <Text style={styles.presetText}>{p}s</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>NUMBER OF TRADES</Text>
              <TextInput
                style={[styles.input, { borderColor: `rgba(${a}, 0.35)` }]}
                value={count}
                onChangeText={setCount}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor="#666666"
              />

              <View style={styles.summary}>
                <Text style={styles.summaryText}>
                  {symbol ? `${count || 1} × ${direction.toUpperCase()} ${symbol} at ${lot} lot` : 'Pick a symbol'}
                </Text>
                <Text style={[styles.summaryWhen, tooLate && { color: '#FF1A1A' }]}>
                  {!Number.isFinite(firesIn)
                    ? ''
                    : tooLate
                      ? 'That moment has already passed'
                      : `Fires in ${lead(firesIn / 60000)}`}
                </Text>
              </View>

              {error && <Text style={styles.error}>{error}</Text>}
            </ScrollView>

            <TouchableOpacity
              onPress={handleArm}
              disabled={busy || !symbol || tooLate || !(volume > 0)}
              activeOpacity={0.85}
              style={[
                styles.arm,
                { backgroundColor: ac },
                (busy || !symbol || tooLate || !(volume > 0)) && styles.armDisabled,
              ]}
            >
              {busy
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : <Text style={styles.armText}>ARM THIS TRADE</Text>}
            </TouchableOpacity>
            <Text style={styles.footnote}>
              Runs on the server, so it fires whether or not the app is open.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  card: {
    width: '100%',
    maxWidth: 430,
    maxHeight: '88%',
    padding: 20,
    borderRadius: 22,
    backgroundColor: '#101010',
    borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  eventTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 6, lineHeight: 20 },
  eventMeta: { color: '#808080', fontSize: 9.5, fontWeight: '800', letterSpacing: 1.2, marginTop: 4 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  rule: { height: 1, marginTop: 14, marginBottom: 14 },
  body: { flexGrow: 0 },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 1.9, color: '#808080', marginBottom: 8, marginTop: 6 },
  input: {
    borderWidth: 1, borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    color: '#FFFFFF',
    fontSize: Platform.OS === 'web' ? 16 : 14, // 16 avoids iOS Safari focus zoom
    fontWeight: '600',
    marginBottom: 10,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  chip: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7,
  },
  chipText: { fontSize: 11.5, fontWeight: '700', color: '#B3B3B3' },
  useTyped: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 10,
    alignItems: 'center', marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  useTypedText: { fontSize: 11.5, fontWeight: '700' },
  dirRow: { flexDirection: 'row', gap: 9, marginBottom: 6 },
  dirBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 13, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  dirText: { fontSize: 11.5, fontWeight: '800', letterSpacing: 1.5, color: '#808080' },
  presets: { flexDirection: 'row', gap: 7, marginTop: -2, marginBottom: 10 },
  preset: {
    paddingHorizontal: 11, paddingVertical: 6, borderRadius: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  presetText: { fontSize: 10.5, fontWeight: '700', color: '#B3B3B3' },
  panel: {
    marginBottom: 14, padding: 12, borderRadius: 13,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  armedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  armedText: { color: '#FFFFFF', fontSize: 12, flex: 1, minWidth: 0 },
  summary: {
    marginTop: 6, padding: 12, borderRadius: 13,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', gap: 3,
  },
  summaryText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '600' },
  summaryWhen: { color: '#B3B3B3', fontSize: 11 },
  empty: { color: '#808080', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  error: { color: '#FF1A1A', fontSize: 12, marginTop: 10 },
  arm: {
    marginTop: 14, borderRadius: 16, paddingVertical: 15,
    alignItems: 'center', justifyContent: 'center',
  },
  armDisabled: { opacity: 0.45 },
  armText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1.6 },
  footnote: { color: '#666666', fontSize: 9.5, textAlign: 'center', marginTop: 9 },
});

export default NewsTradeModal;
