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
import { X, Timer, Coins, Trash2, Search, Layers } from 'lucide-react-native';
import { useTheme } from '@/providers/theme-provider';
import { useApp } from '@/providers/app-provider';
import { NewsCountdown } from './news-countdown';
import {
  apiService,
  scheduleNewsTrade,
  cancelNewsSchedule,
  getNewsSchedules,
  type CalendarEvent,
  type NewsSchedule,
} from '@/services/api';

/**
 * Automate a calendar release.
 *
 * Held on the server, not here: a release is usually hours away and a timer in
 * the app only survives while the app is open. The events worth automating are
 * the ones you are not sitting and watching.
 *
 * Symbols are searched rather than listed. A broker list runs to hundreds of
 * instruments, and a wall of chips is slower to use than typing three letters.
 * Several can be armed at once, each getting its own schedule.
 *
 * Nothing here decides or shows a side, and that is deliberate. Two batches go
 * on, and neither is a prediction made in this screen:
 *
 *   1. Before the release, the server draws Buy or Sell at random. Reading the
 *      forecast against the previous print was a false comfort, because the
 *      first move is a scramble for liquidity rather than a considered
 *      response to the number.
 *   2. After the release has settled, the server reads which way price
 *      ACTUALLY went and adds the same number of orders in that direction.
 *
 * Neither side is shown before it exists, because there is nothing to show.
 *
 */

const LEAD_PRESETS = [
  { label: '30s', v: 30 },
  { label: '1m', v: 60 },
  { label: '5m', v: 300 },
  { label: '15m', v: 900 },
];
const MAX_LEAD = 900; // 15 minutes

export function NewsTradeModal({
  event,
  visible,
  existing,
  onClose,
  onChanged,
}: {
  event: CalendarEvent | null;
  visible: boolean;
  existing: NewsSchedule[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { theme } = useTheme();
  const ac = theme.accent;
  const a = theme.accentRgb;
  const { mt5Symbols, mt5Account } = useApp();

  const [selected, setSelected] = useState<string[]>([]);
  const [leadSeconds, setLeadSeconds] = useState('60');
  const [count, setCount] = useState('1');
  const [baseLot, setBaseLot] = useState('0.01');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // Pre-select a configured symbol the release actually bears on.
    const cur = (event.currency || '').toUpperCase();
    const match = mt5Symbols.find((m: any) => m.symbol.toUpperCase().includes(cur));
    setSelected(match ? [match.symbol] : []);
    setLeadSeconds('60');
    setCount('1');
    setBaseLot((match as any)?.lotSize || '0.01');
    setQuery('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, event?.id]);

  const configured = mt5Symbols.map((m: any) => m.symbol);
  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (q.length < 1) return [];
    const pool = [...configured, ...brokerSymbols.filter((x) => !configured.includes(x))];
    return pool.filter((x) => x.toUpperCase().includes(q) && !selected.includes(x)).slice(0, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, brokerSymbols, mt5Symbols, selected]);

  const lead = parseInt(leadSeconds, 10) || 0;
  const fireAt = Number.isFinite(eventAt) ? eventAt - lead * 1000 : NaN;
  const firesIn = Number.isFinite(fireAt) ? fireAt - Date.now() : NaN;
  const tooLate = Number.isFinite(firesIn) && firesIn <= 0;
  const overMax = lead > MAX_LEAD;
  const armed = existing.filter((s) => s.status === 'armed');

  // Resolve every selected symbol up front, so what gets armed is on screen
  // before the button is pressed.
  const plan = useMemo(() => {
    if (!event) return [];
    const base = parseFloat(baseLot) || 0;
    return selected.map((symbol) => {
      const cfg: any = mt5Symbols.find((m: any) => m.symbol === symbol);
      return { symbol, volume: parseFloat(cfg?.lotSize || '') || base };
    });
  }, [selected, event, baseLot, mt5Symbols]);

  // Every selected symbol arms. There is no lean to read, so there is nothing
  // to skip on.
  const armable = plan.filter((p) => p.volume > 0);

  const add = (sym: string) => {
    setSelected((prev) => (prev.includes(sym) ? prev : [...prev, sym]));
    setQuery('');
  };
  const remove = (sym: string) => setSelected((prev) => prev.filter((s) => s !== sym));

  const handleArm = async () => {
    if (!event || !mt5Account?.uuid) { setError('Connect an MT5 account first.'); return; }
    if (armable.length === 0) {
      setError('Search and add at least one symbol.');
      return;
    }
    setBusy(true);
    setError(null);
    const failures: string[] = [];
    for (const p of armable) {
      try {
        await scheduleNewsTrade({
          uuid: mt5Account.uuid,
          eventId: event.id,
          eventTitle: event.title,
          currency: event.currency,
          symbol: p.symbol,
          volume: p.volume,
          count: parseInt(count, 10) || 1,
          leadSeconds: lead,
          eventAt,
        });
      } catch (e: any) {
        failures.push(`${p.symbol}: ${e?.message || 'rejected'}`);
      }
    }
    setBusy(false);
    onChanged();
    if (failures.length > 0) setError(failures.join('\n'));
    else onClose();
  };

  // ── Test flight ───────────────────────────────────────────────────
  //
  // A dry run through the SAME path the AUTOMATE button uses: same client
  // call, same route, same fire(), same follow-up. Only two things differ,
  // and neither touches how it executes:
  //
  //   • the event is invented, so it can fire seconds from now instead of
  //     whenever the calendar says
  //   • the settling window is compressed, so the follow-up lands in fifteen
  //     seconds rather than ninety
  //
  // It uses the symbols, lot and order count already set above, so what you
  // watch is what the real release will do. These are REAL orders.
  const [testSecs, setTestSecs] = useState('5');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [countdownAt, setCountdownAt] = useState(0);
  const [showCountdown, setShowCountdown] = useState(false);

  const handleTest = async () => {
    if (!mt5Account?.uuid) { setError('Connect an MT5 account first.'); return; }
    if (armable.length === 0) { setError('Search and add at least one symbol.'); return; }
    const secs = Math.max(1, parseInt(testSecs, 10) || 5);
    setTesting(true);
    setError(null);
    setTestMsg('Arming\u2026');
    const id = `testflight-${Date.now()}`;
    try {
      for (const p of armable) {
        await scheduleNewsTrade({
          uuid: mt5Account.uuid,
          eventId: id,
          eventTitle: 'Test flight',
          currency: event?.currency || '',
          symbol: p.symbol,
          volume: p.volume,
          count: parseInt(count, 10) || 1,
          leadSeconds: 0,
          eventAt: Date.now() + secs * 1000,
          followSeconds: 15,
        });
      }
      setTestId(id);
      setTestMsg(`Fires in ${secs}s\u2026`);
      // Fill the screen with it. Purely a view: hiding it cancels nothing.
      setCountdownAt(Date.now() + secs * 1000);
      setShowCountdown(true);
    } catch (e: any) {
      setTesting(false);
      setTestMsg(null);
      setError(e?.message || 'Could not start the test flight.');
    }
  };

  // Watch it happen. Stops once every symbol has resolved, or after two
  // minutes, so a broker that never answers cannot poll forever.
  useEffect(() => {
    if (!testId || !mt5Account?.uuid) return;
    const uuid = mt5Account.uuid;
    const started = Date.now();
    const h = setInterval(async () => {
      try {
        const all = await getNewsSchedules(uuid);
        const mine = all.filter((s) => s.eventId === testId);
        if (mine.length === 0) return;
        setTestMsg(mine.map((s) => `${s.symbol}: ${s.message || s.status}`).join('\n'));
        const settled = mine.every(
          (s) => s.status === 'failed' || /followed|skipped/.test(s.message || ''),
        );
        if (settled || Date.now() - started > 120_000) {
          clearInterval(h);
          setTesting(false);
        }
      } catch {
        /* a dropped poll is not a failed run; the next tick tries again */
      }
    }, 1500);
    return () => clearInterval(h);
  }, [testId, mt5Account?.uuid]);

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
  const untilText = (mins: number) =>
    mins < 60 ? `${Math.round(mins)}m` : `${Math.floor(mins / 60)}h ${Math.round(mins % 60)}m`;

  const field = [styles.input, { borderColor: `rgba(${a}, 0.35)` }];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.centre}>
          <View style={[styles.card, { borderColor: `rgba(${a}, 0.35)` }]}>
            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={[styles.kicker, { color: ac }]}>AUTOMATE NEWS EVENT</Text>
                <Text style={styles.eventTitle} numberOfLines={2}>{event?.title || ''}</Text>
                <Text style={styles.eventMeta}>
                  {event?.currency}{when ? ` · ${when}` : ''}
                  {event?.impact ? ` · ${event.impact.toUpperCase()} IMPACT` : ''}
                  {event?.forecast ? ` · FC ${event.forecast}` : ''}
                  {event?.previous ? ` · PREV ${event.previous}` : ''}
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
                  <Text style={styles.label}>ALREADY AUTOMATED</Text>
                  {armed.map((s) => (
                    <View key={`${s.eventId}-${s.symbol}`} style={styles.armedRow}>
                      <Text style={styles.armedText} numberOfLines={1}>
                        {s.symbol} ×{s.count} @ {s.volume} · {s.leadSeconds}s before
                      </Text>
                      <TouchableOpacity onPress={() => handleCancel(s)} hitSlop={10} disabled={busy}>
                        <Trash2 color="#FF1A1A" size={15} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.label}>SYMBOLS</Text>
              {selected.length > 0 && (
                <View style={styles.chips}>
                  {selected.map((sym) => (
                    <TouchableOpacity
                      key={sym}
                      onPress={() => remove(sym)}
                      activeOpacity={0.8}
                      style={[styles.chip, { borderColor: ac, backgroundColor: `rgba(${a}, 0.18)` }]}
                    >
                      <Text style={[styles.chipText, { color: ac }]}>{sym}</Text>
                      <X color={ac} size={11} strokeWidth={3} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <View style={styles.searchWrap}>
                <Search size={15} color={ac} style={styles.searchIcon} />
                <TextInput
                  style={[field, styles.searchInput]}
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder={loadingSymbols ? 'Loading broker symbols…' : 'Search to add, e.g. EUR'}
                  placeholderTextColor="#666666"
                  onSubmitEditing={() => { if (query.trim()) add(query.trim().toUpperCase()); }}
                />
              </View>

              {results.length > 0 && (
                <View style={styles.results}>
                  {results.map((sym) => (
                    <TouchableOpacity key={sym} onPress={() => add(sym)} style={styles.result} activeOpacity={0.75}>
                      <Text style={styles.resultText}>{sym}</Text>
                      {configured.includes(sym) && <Text style={styles.resultTag}>CONFIGURED</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* The broker list is not the authority on what exists. */}
              {!!query.trim() && results.length === 0 && !selected.includes(query.trim().toUpperCase()) && (
                <TouchableOpacity
                  onPress={() => add(query.trim().toUpperCase())}
                  style={[styles.useTyped, { borderColor: `rgba(${a}, 0.4)` }]}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.useTypedText, { color: ac }]}>
                    Add “{query.trim().toUpperCase()}” anyway
                  </Text>
                </TouchableOpacity>
              )}

              <Text style={styles.label}>LOT SIZE</Text>
              <View style={styles.searchWrap}>
                <Coins size={15} color={ac} style={styles.searchIcon} />
                <TextInput
                  style={[field, styles.searchInput]}
                  value={baseLot}
                  onChangeText={setBaseLot}
                  keyboardType="decimal-pad"
                  placeholder="0.01"
                  placeholderTextColor="#666666"
                />
              </View>

              <Text style={styles.label}>SECONDS BEFORE RELEASE (MAX 15 MIN)</Text>
              <View style={styles.searchWrap}>
                <Timer size={15} color={ac} style={styles.searchIcon} />
                <TextInput
                  style={[field, styles.searchInput]}
                  value={leadSeconds}
                  onChangeText={setLeadSeconds}
                  keyboardType="number-pad"
                  placeholder="60"
                  placeholderTextColor="#666666"
                />
              </View>
              <View style={styles.presets}>
                {LEAD_PRESETS.map((p) => (
                  <TouchableOpacity
                    key={p.v}
                    onPress={() => setLeadSeconds(String(p.v))}
                    style={[styles.preset, lead === p.v && { borderColor: ac }]}
                  >
                    <Text style={styles.presetText}>{p.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>TRADES PER SYMBOL</Text>
              <View style={styles.searchWrap}>
                <Layers size={15} color={ac} style={styles.searchIcon} />
                <TextInput
                  style={[field, styles.searchInput]}
                  value={count}
                  onChangeText={setCount}
                  keyboardType="number-pad"
                  placeholder="1"
                  placeholderTextColor="#666666"
                />
              </View>

              {plan.length > 0 && (
                <View style={styles.panel}>
                  <Text style={styles.label}>WILL ARM</Text>
                  {plan.map((p) => (
                    <View key={p.symbol} style={styles.planRow}>
                      <Text style={styles.planText} numberOfLines={1}>
                        {`${count || 1} × ${p.symbol} @ ${p.volume}`}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              <Text style={[styles.firesIn, tooLate && { color: '#FF1A1A' }]}>
                {!Number.isFinite(firesIn)
                  ? ''
                  : tooLate
                    ? 'That moment has already passed'
                    : `Fires in ${untilText(firesIn / 60000)}`}
              </Text>

              {overMax && <Text style={styles.error}>Lead time is capped at 15 minutes (900s).</Text>}
              {error && <Text style={styles.error}>{error}</Text>}
            </ScrollView>

            <TouchableOpacity
              onPress={handleArm}
              disabled={busy || armable.length === 0 || tooLate || overMax}
              activeOpacity={0.85}
              style={[
                styles.arm,
                { backgroundColor: ac },
                (busy || armable.length === 0 || tooLate || overMax) && styles.armDisabled,
              ]}
            >
              {busy
                ? <ActivityIndicator color="#FFFFFF" size="small" />
                : (
                  <Text style={styles.armText}>
                    AUTOMATE NEWS{armable.length > 1 ? ` · ${armable.length} SYMBOLS` : ''}
                  </Text>
                )}
            </TouchableOpacity>
            {/* The same path the button above takes, on a made-up event a few
                seconds out, so you can watch it execute instead of trusting it. */}
            <View style={styles.testRow}>
              <Text style={styles.testLabel}>TEST IN</Text>
              <TextInput
                style={styles.testInput}
                value={testSecs}
                onChangeText={setTestSecs}
                keyboardType="number-pad"
                maxLength={4}
                placeholderTextColor="#5A6166"
              />
              <Text style={styles.testLabel}>SEC</Text>
              <TouchableOpacity
                onPress={handleTest}
                disabled={busy || testing || armable.length === 0}
                activeOpacity={0.85}
                style={[
                  styles.testBtn,
                  { borderColor: ac },
                  (busy || testing || armable.length === 0) && { opacity: 0.45 },
                ]}
              >
                <Text style={[styles.testBtnText, { color: ac }]}>
                  {testing ? 'RUNNING\u2026' : 'TEST FLIGHT'}
                </Text>
              </TouchableOpacity>
            </View>
            {!!testMsg && <Text style={styles.testMsg}>{testMsg}</Text>}

            <Text style={styles.footnote}>
              No side is chosen here. The server draws Buy or Sell as the order fires,
              then adds the same size again in whichever direction price actually moved.
              Runs on the server, so it fires with the app closed.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </View>

      <NewsCountdown
        visible={showCountdown}
        uuid={mt5Account?.uuid}
        eventId={testId}
        fireAt={countdownAt}
        title={`Test flight · ${armable.map((p) => p.symbol).join(', ')}`}
        accent={ac}
        onHide={() => setShowCountdown(false)}
        onCancelled={() => {
          setShowCountdown(false);
          setTesting(false);
          setTestId(null);
          setTestMsg('Cancelled.');
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  testRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  testLabel: { color: '#808080', fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  testInput: {
    width: 54, color: '#FFFFFF', fontSize: 12, fontWeight: '700', textAlign: 'center',
    paddingVertical: 6, borderRadius: 7, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(0,0,0,0.35)',
  },
  testBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center' },
  testBtnText: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.9 },
  testMsg: { color: '#9AA0A5', fontSize: 10.5, lineHeight: 15, marginTop: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)' },
  centre: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 18 },
  card: {
    width: '100%', maxWidth: 430, maxHeight: '90%',
    padding: 20, borderRadius: 22, backgroundColor: '#101010', borderWidth: 1,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, minWidth: 0 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  eventTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 6, lineHeight: 20 },
  eventMeta: { color: '#808080', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 4, lineHeight: 13 },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  rule: { height: 1, marginTop: 14, marginBottom: 14 },
  body: { flexGrow: 0 },
  label: { fontSize: 9, fontWeight: '800', letterSpacing: 1.9, color: '#808080', marginBottom: 8, marginTop: 6 },

  searchWrap: { position: 'relative', justifyContent: 'center', marginBottom: 10 },
  searchIcon: { position: 'absolute', left: 12, zIndex: 1 },
  searchInput: { paddingLeft: 36 },
  input: {
    borderWidth: 1, borderRadius: 13, paddingHorizontal: 13,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    backgroundColor: 'rgba(0,0,0,0.4)', color: '#FFFFFF',
    fontSize: Platform.OS === 'web' ? 16 : 14, // 16 avoids iOS Safari focus zoom
    fontWeight: '600',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null),
  },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 7,
  },
  chipText: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.4 },

  results: {
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden', marginBottom: 12,
  },
  result: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 13, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  resultText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  resultTag: { color: '#808080', fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },

  useTyped: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 10,
    alignItems: 'center', marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  useTypedText: { fontSize: 11.5, fontWeight: '700' },

  weightRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, marginBottom: 2,
  },
  weightLabel: { color: '#B3B3B3', fontSize: 12 },
  track: { width: 34, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.15)', padding: 2 },
  thumb: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFFFFF' },

  presets: { flexDirection: 'row', gap: 7, marginTop: -2, marginBottom: 10 },
  preset: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  presetText: { fontSize: 10.5, fontWeight: '700', color: '#B3B3B3' },

  panel: {
    marginTop: 6, marginBottom: 12, padding: 12, borderRadius: 13,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  armedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 4 },
  armedText: { color: '#FFFFFF', fontSize: 12, flex: 1, minWidth: 0 },
  planRow: { paddingVertical: 5 },
  planText: { fontSize: 12.5, fontWeight: '700' },
  planWhy: { color: '#808080', fontSize: 10.5, lineHeight: 15, marginTop: 3 },

  firesIn: { color: '#B3B3B3', fontSize: 11.5, textAlign: 'center', marginTop: 4 },
  error: { color: '#FF1A1A', fontSize: 12, marginTop: 10 },
  arm: { marginTop: 14, borderRadius: 16, paddingVertical: 15, alignItems: 'center', justifyContent: 'center' },
  armDisabled: { opacity: 0.45 },
  armText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 1.5 },
  footnote: { color: '#666666', fontSize: 9.5, textAlign: 'center', marginTop: 9, lineHeight: 13 },
});

export default NewsTradeModal;
