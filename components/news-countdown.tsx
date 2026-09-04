import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { getNewsSchedules, cancelNewsSchedule, type NewsSchedule } from '@/services/api';

/**
 * Full-screen countdown for an armed run.
 *
 * This window OBSERVES. It holds no timer that matters: every schedule lives
 * on the server with its own setTimeout, and the only thing ticking here is
 * the number on screen. Closing this, leaving the screen, or shutting the app
 * changes nothing about what has been armed — which is the whole reason the
 * scheduler was put on the server in the first place.
 *
 * Cancelling is therefore a separate, deliberate button. Dismissing is not a
 * cancel, and the footer says so, because guessing wrong about that costs real
 * money in either direction.
 */

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

function clock(ms: number): string {
  if (ms <= 0) return '00';
  const total = Math.ceil(ms / 1000);
  if (total < 60) return pad(total);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}:${pad(s)}`;
  return `${Math.floor(m / 60)}:${pad(m % 60)}:${pad(s)}`;
}

export function NewsCountdown({
  visible,
  uuid,
  eventId,
  fireAt,
  title,
  accent,
  onHide,
  onCancelled,
}: {
  visible: boolean;
  uuid: string | null | undefined;
  eventId: string | null;
  fireAt: number;
  title: string;
  accent: string;
  onHide: () => void;
  onCancelled: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [rows, setRows] = useState<NewsSchedule[]>([]);
  const [busy, setBusy] = useState(false);
  const opened = useRef(0);

  // A quarter second keeps the last few seconds honest without churning.
  useEffect(() => {
    if (!visible) return;
    opened.current = Date.now();
    setNow(Date.now());
    const h = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(h);
  }, [visible]);

  // Read what the server has done. Purely a read: nothing here drives it.
  useEffect(() => {
    if (!visible || !uuid || !eventId) return;
    let stop = false;
    const h = setInterval(async () => {
      try {
        const all = await getNewsSchedules(uuid);
        if (stop) return;
        const mine = all.filter((s) => s.eventId === eventId);
        setRows(mine);
        const settled =
          mine.length > 0 &&
          mine.every((s) => s.status === 'failed' || /followed|skipped/.test(s.message || ''));
        if (settled || Date.now() - opened.current > 10 * 60_000) clearInterval(h);
      } catch {
        /* a dropped poll is not a failed run */
      }
    }, 1200);
    return () => { stop = true; clearInterval(h); };
  }, [visible, uuid, eventId]);

  const remaining = fireAt - now;
  const fired = rows.some((s) => /Opened/.test(s.message || '') || s.status === 'failed');
  const settled = rows.length > 0 && rows.every((s) => /followed|skipped/.test(s.message || '') || s.status === 'failed');

  const phase = useMemo(() => {
    if (settled) return 'Done';
    if (fired) return 'Watching the move';
    if (remaining <= 0) return 'Firing';
    return 'Armed';
  }, [settled, fired, remaining]);

  const cancel = async () => {
    if (!uuid || !eventId || rows.length === 0) { onCancelled(); return; }
    setBusy(true);
    for (const r of rows) {
      try { await cancelNewsSchedule(uuid, r.eventId, r.symbol); } catch { /* already gone */ }
    }
    setBusy(false);
    onCancelled();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onHide}>
      <View style={styles.fill}>
        <View style={styles.inner}>
          <Text style={[styles.kicker, { color: accent }]}>{phase.toUpperCase()}</Text>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>

          {!fired ? (
            <>
              <Text style={[styles.count, { color: accent }]}>{clock(remaining)}</Text>
              <Text style={styles.countLabel}>
                {remaining > 0 ? 'UNTIL THE FIRST BATCH' : 'SENDING'}
              </Text>
            </>
          ) : (
            <View style={styles.doneMark}>
              <Text style={[styles.count, styles.countSmall, { color: accent }]}>
                {rows.reduce((n, s) => n + (s.tickets?.length || 0) + (s.followTickets?.length || 0), 0)}
              </Text>
              <Text style={styles.countLabel}>ORDERS PLACED</Text>
            </View>
          )}

          <ScrollView style={styles.rows} contentContainerStyle={styles.rowsInner}>
            {rows.length === 0 ? (
              <Text style={styles.pending}>Waiting for the server to report…</Text>
            ) : (
              rows.map((s) => (
                <View key={s.symbol} style={styles.row}>
                  <Text style={[styles.rowSym, { color: accent }]}>{s.symbol}</Text>
                  <Text style={styles.rowMsg}>{s.message || s.status}</Text>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity onPress={onHide} activeOpacity={0.85} style={styles.hide}>
              <Text style={styles.hideText}>HIDE</Text>
            </TouchableOpacity>
            {!settled && (
              <TouchableOpacity
                onPress={cancel}
                disabled={busy}
                activeOpacity={0.85}
                style={[styles.cancel, busy && { opacity: 0.5 }]}
              >
                <Text style={styles.cancelText}>{busy ? 'CANCELLING…' : 'CANCEL RUN'}</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.foot}>
            Hiding this does not cancel anything. The schedule runs on the server and fires
            with the app closed.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.94)' },
  inner: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },

  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 2.2 },
  title: {
    color: '#C9CFD3', fontSize: 13, marginTop: 8, textAlign: 'center', maxWidth: 380,
  },

  count: {
    fontSize: 96, fontWeight: '800', letterSpacing: -2, marginTop: 18,
    fontVariant: ['tabular-nums'], lineHeight: 104,
  },
  countSmall: { fontSize: 72, lineHeight: 80 },
  countLabel: {
    color: '#7C858A', fontSize: 10, fontWeight: '700', letterSpacing: 2, marginTop: 2,
  },
  doneMark: { alignItems: 'center' },

  rows: { maxHeight: 190, width: '100%', marginTop: 22 },
  rowsInner: { gap: 10, paddingBottom: 4 },
  pending: { color: '#6E767B', fontSize: 12, textAlign: 'center' },
  row: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 9,
  },
  rowSym: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  rowMsg: { color: '#9AA0A5', fontSize: 11.5, lineHeight: 16, marginTop: 3 },

  actions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  hide: {
    paddingVertical: 11, paddingHorizontal: 28, borderRadius: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  hideText: { color: '#D6DBDE', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  cancel: {
    paddingVertical: 11, paddingHorizontal: 28, borderRadius: 9,
    borderWidth: 1, borderColor: 'rgba(229,130,114,0.55)',
  },
  cancelText: { color: '#E58272', fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },

  foot: {
    color: '#5F676C', fontSize: 10.5, lineHeight: 15, marginTop: 18,
    textAlign: 'center', maxWidth: 320,
  },
});

export default NewsCountdown;
