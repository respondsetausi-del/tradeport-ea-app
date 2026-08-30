import React, { useEffect, useMemo, useState } from 'react';
import { Modal, View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { X, Zap, Plus, Check } from 'lucide-react-native';
import { apiService } from '@/services/api';

export interface QuickConfig {
  /** Every symbol the run should trade. Broker casing is preserved exactly. */
  symbols: string[];
  lotSize: string;
  numberOfTrades: string;
}

interface Props {
  visible: boolean;
  uuid: string | undefined;
  accent?: string;
  onClose: () => void;
  onConfirm: (config: QuickConfig) => void;
}

/** Matches the engine's per-account ceiling. */
const MAX_SYMBOLS = 20;

// Quick trade setup, shown every time Start is pressed.
//
// Symbols are picked one after another and all of them run together, each as
// its own robot with its own direction. The selection belongs to the run:
// pressing Stop clears it, so this always opens empty and the trader re-picks
// deliberately rather than inheriting whatever was armed last time.
export default function QuickConfigModal({ visible, uuid, accent = '#22C55E', onClose, onConfirm }: Props) {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [lot, setLot] = useState('');
  const [trades, setTrades] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (visible && uuid && symbols.length === 0) {
      setLoading(true);
      setError(null);
      apiService.getMT5Symbols(uuid)
        .then((s) => { if (!cancelled) setSymbols(Array.isArray(s) ? s : []); })
        .catch((e) => { if (!cancelled) setError(e?.message || 'Could not load broker symbols'); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uuid]);

  // Opening is a fresh run, so nothing carries over from the last one.
  useEffect(() => {
    if (visible) { setSelected([]); setQuery(''); }
  }, [visible]);

  const q = query.trim().toUpperCase();
  const matches = useMemo(
    () => (q ? symbols.filter((s) => s.toUpperCase().includes(q)) : symbols).slice(0, 30),
    [symbols, q],
  );

  const isSelected = (s: string) => selected.some((x) => x.toUpperCase() === s.toUpperCase());
  const atLimit = selected.length >= MAX_SYMBOLS;

  const toggle = (s: string) => {
    setSelected((prev) => {
      const hit = prev.find((x) => x.toUpperCase() === s.toUpperCase());
      if (hit) return prev.filter((x) => x !== hit);
      if (prev.length >= MAX_SYMBOLS) return prev;
      return [...prev, s];
    });
  };

  // The broker list can be incomplete or fail to load, so a typed symbol that
  // matches nothing exactly can still be added by hand.
  const typedIsNew = q.length > 0 && !symbols.some((s) => s.toUpperCase() === q) && !isSelected(q);

  const canStart = selected.length > 0;

  const save = () => {
    if (!canStart) return;
    onConfirm({
      symbols: selected,
      lotSize: (lot.trim() || '0.01'),
      numberOfTrades: (trades.trim() || '1'),
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { borderColor: accent + '66' }]}>
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Zap color={accent} size={18} strokeWidth={2.5} />
              <Text style={[styles.title, { color: accent }]}>QUICK TRADE SETUP</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X color="#9CA3AF" size={20} />
            </TouchableOpacity>
          </View>

          <Text style={styles.hint}>
            Pick as many broker symbols as you want, one after another. Each one runs its own robot
            with the lot &amp; trade count below.
          </Text>

          <TextInput
            style={[styles.input, { borderColor: accent + '99' }]}
            placeholder={loading ? 'Loading broker symbols…' : 'Search symbols'}
            placeholderTextColor="#6B7280"
            autoCapitalize="characters"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
          />

          {loading && <ActivityIndicator color={accent} style={{ marginVertical: 6 }} />}
          {error && <Text style={styles.error}>{error} — you can still type a symbol and add it manually.</Text>}

          {/* Add a symbol the broker list does not contain. */}
          {typedIsNew && !atLimit && (
            <TouchableOpacity
              style={[styles.addRow, { borderColor: accent + '55' }]}
              onPress={() => { toggle(query.trim()); setQuery(''); }}
            >
              <Plus color={accent} size={14} strokeWidth={3} />
              <Text style={[styles.addText, { color: accent }]}>Add “{query.trim()}”</Text>
            </TouchableOpacity>
          )}

          {/* What is armed so far, in the order it was picked. Tap to drop one. */}
          {selected.length > 0 && (
            <View style={styles.selectedBlock}>
              <View style={styles.selectedHead}>
                <Text style={styles.sectionLabel}>
                  SELECTED · {selected.length}{atLimit ? ` (MAX ${MAX_SYMBOLS})` : ''}
                </Text>
                <TouchableOpacity onPress={() => setSelected([])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.clearAll}>CLEAR</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.chips}>
                {selected.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, { backgroundColor: accent + '22', borderColor: accent }]}
                    onPress={() => toggle(s)}
                  >
                    <Text style={[styles.chipText, { color: accent }]}>{s}</Text>
                    <X color={accent} size={11} strokeWidth={3} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {symbols.length > 0 && (
            <ScrollView style={{ maxHeight: 132 }} keyboardShouldPersistTaps="handled">
              <View style={styles.chips}>
                {matches.map((s) => {
                  const on = isSelected(s);
                  const blocked = atLimit && !on;
                  return (
                    <TouchableOpacity
                      key={s}
                      disabled={blocked}
                      style={[
                        styles.chip,
                        { borderColor: accent + '55' },
                        on && { backgroundColor: accent + '22', borderColor: accent },
                        blocked && styles.chipBlocked,
                      ]}
                      onPress={() => toggle(s)}
                    >
                      {on && <Check color={accent} size={11} strokeWidth={3} />}
                      <Text style={[styles.chipText, { color: blocked ? '#4B5563' : accent }]}>{s}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )}

          <View style={styles.row}>
            <TextInput style={[styles.input, { flex: 1, minWidth: 0 }]} placeholder="Lot (0.01)" placeholderTextColor="#6B7280" keyboardType="decimal-pad" value={lot} onChangeText={setLot} />
            <TextInput style={[styles.input, { flex: 1, minWidth: 0 }]} placeholder="Trades (1)" placeholderTextColor="#6B7280" keyboardType="number-pad" value={trades} onChangeText={setTrades} />
          </View>

          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: canStart ? accent : 'rgba(255,255,255,0.1)' }]}
            disabled={!canStart}
            onPress={save}
          >
            <Text style={[styles.startText, { color: canStart ? '#000' : '#6B7280' }]}>
              {selected.length > 1 ? `CONFIRM & TRADE · ${selected.length} SYMBOLS` : 'CONFIRM & TRADE'}
            </Text>
          </TouchableOpacity>
          <Text style={styles.footnote}>
            Defaults to 0.01 lot · 1 trade, per symbol. Stopping closes everything and clears this
            selection, so you pick again next time.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 460, alignSelf: 'center', overflow: 'hidden', borderWidth: 1, borderRadius: 20, padding: 18, gap: 12, backgroundColor: '#0D1117' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  hint: { color: '#9CA3AF', fontSize: 12, lineHeight: 17 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: '#FFFFFF', fontSize: 14, fontWeight: '600', minWidth: 0,
  },
  error: { color: '#EF4444', fontSize: 11 },
  addRow: {
    flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  addText: { fontSize: 12, fontWeight: '700' },
  selectedBlock: { gap: 7 },
  selectedHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionLabel: { color: '#6B7280', fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  clearAll: { color: '#6B7280', fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 9,
    paddingHorizontal: 11, paddingVertical: 7, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipBlocked: { opacity: 0.4 },
  chipText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  row: { flexDirection: 'row', gap: 10 },
  startBtn: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  startText: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  footnote: { color: '#6B7280', fontSize: 10, textAlign: 'center', lineHeight: 14 },
});
