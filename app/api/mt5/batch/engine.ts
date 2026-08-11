// Server-side batch engine (SERVER ONLY). Start → open a batch → hold the
// interval → close all → flip direction → reopen, looping. Runs on the Bun
// server so it keeps going while the app is backgrounded/closed.
//
// Hardened for reboots: each flight is persisted to MySQL and resumeBatches()
// reloads active flights on server startup and continues the loop. Keep-alive
// self-pings /health to reduce free-tier sleep (an external uptime pinger is
// still the dependable anti-sleep on free tier).
import { orderSend, orderClose, getOpenOrders } from '@/services/api2trade';
import { getPool } from '@/app/api/_db';

type Leg = 'Buy' | 'Sell';

interface Flight {
  symbol: string;
  volume: number;
  count: number;
  intervalMs: number;
  comment: string;
  dir: Leg;
  tickets: number[];
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  status: string;
  legCount: number;
  startedAt: number;
  nextFlipAt: number;
}

const flights = new Map<string, Flight>();
let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
let tableReady = false;

// Persistence + resume only run in production (Render). A local dev server
// sharing the same MySQL would otherwise reload — and TRADE — live flights.
// Opt in locally with BATCH_PERSIST=1 (with your own DB) if you must.
const PERSIST = process.env.RENDER === 'true' || process.env.BATCH_PERSIST === '1';

// ── Persistence (best-effort — the loop still runs in-memory if the DB is down) ──
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = await getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS tp_mt5_batches (
      uuid VARCHAR(80) PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
  tableReady = true;
}

function persist(id: string, f: Flight): void {
  if (!PERSIST) return;
  (async () => {
    try {
      await ensureTable();
      const pool = await getPool();
      const data = JSON.stringify({
        symbol: f.symbol, volume: f.volume, count: f.count, intervalMs: f.intervalMs,
        comment: f.comment, dir: f.dir, tickets: f.tickets, nextFlipAt: f.nextFlipAt,
        legCount: f.legCount, startedAt: f.startedAt,
      });
      await pool.query(
        'INSERT INTO tp_mt5_batches (uuid, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [id, data],
      );
    } catch (e: any) { console.error('[Batch:srv] persist error:', e?.message || e); }
  })();
}

function unpersist(id: string): void {
  if (!PERSIST) return;
  (async () => {
    try { await ensureTable(); const pool = await getPool(); await pool.query('DELETE FROM tp_mt5_batches WHERE uuid = ?', [id]); }
    catch (e: any) { console.error('[Batch:srv] unpersist error:', e?.message || e); }
  })();
}

// ── Keep-alive (reduce free-tier sleep; external pinger still recommended) ──
function ensureKeepAlive(): void {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url || keepAliveTimer) return;
  const base = url.replace(/\/$/, '');
  keepAliveTimer = setInterval(() => { fetch(`${base}/health`).catch(() => {}); }, 4 * 60 * 1000);
  console.log('[Batch:srv] keep-alive started for', base);
}

function maybeStopKeepAlive(): void {
  if ([...flights.values()].some((f) => f.active)) return;
  if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
}

// ── Flat verification ───────────────────────────────────────────────────────
//
// The batch is only hedge-free if "the account is flat" is a PROVEN fact
// before the opposite direction opens. Every read below is fail-CLOSED:
// "I could not find out" is never treated as "flat", because opening on an
// unknown is exactly how Buy and Sell end up live at the same time.
type FlatCheck = 'FLAT' | 'STILL_OPEN' | 'UNKNOWN';

const FLAT_PASSES = 4;      // confirm passes after a close
const SETTLE_MS = 1500;     // broker needs a beat; backs off per pass
const RETRY_MS = 60_000;    // hold and retry when we can't prove flat
const RESUME_MIN_DELAY_MS = 10_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Positions open on this symbol, or null when the account can't be read. */
async function openPositions(id: string, symbol: string): Promise<any[] | null> {
  try {
    const open = await getOpenOrders(id);
    if (!Array.isArray(open)) return null; // unparseable — unknown, NOT flat
    return open.filter((o: any) => o?.symbol === symbol && o?.ticket);
  } catch (e: any) {
    console.error(`[Batch:srv] ${id} openPositions error:`, e?.message || e);
    return null;
  }
}

// ── Trading primitives (all concurrent) ──
async function openBatch(id: string, f: Flight): Promise<void> {
  const dir = f.dir;
  const results: any[] = await Promise.all(
    Array.from({ length: f.count }, () =>
      orderSend({ id, symbol: f.symbol, operation: dir, volume: f.volume, comment: f.comment })
        .catch((e: any) => { console.error(`[Batch:srv] ${id} open error:`, e?.message || e); return null; }),
    ),
  );

  let lost = 0;
  for (const o of results) {
    if (o && typeof o.ticket === 'number' && o.ticket > 0) f.tickets.push(o.ticket);
    else if (o) f.status = `Broker rejected ${dir} ${f.symbol}: ${o?.error || o?.message || 'no ticket'}`;
    else lost += 1; // threw/timed out — the order may still have filled
  }

  // A send that threw can still be live at the broker. Adopt anything on the
  // symbol we don't already know about, or it becomes an invisible position
  // that the next flip hedges against.
  if (lost > 0) {
    const live = await openPositions(id, f.symbol);
    if (live) {
      const adopted = live.filter((o: any) => !f.tickets.includes(o.ticket)).map((o: any) => o.ticket);
      if (adopted.length) {
        f.tickets.push(...adopted);
        console.warn(`[Batch:srv] ${id} adopted ${adopted.length} untracked ticket(s) after ${lost} failed send(s)`);
      }
    } else {
      f.status = `${lost} send(s) failed and the account could not be re-read — positions may be untracked`;
    }
  }

  console.log(`[Batch:srv] ${id} opened ${f.tickets.length}/${f.count} ${dir} ${f.symbol}`);
}

/** Close the tickets we hold. Failures STAY in f.tickets so they're retried. */
async function closeBatch(id: string, f: Flight): Promise<void> {
  const toClose = [...f.tickets];
  if (!toClose.length) return;
  const results = await Promise.all(toClose.map((t) =>
    orderClose({ id, ticket: t, lots: f.volume })
      .then(() => { console.log(`[Batch:srv] ${id} closed ${t}`); return { t, ok: true }; })
      .catch((e: any) => { console.error(`[Batch:srv] ${id} close error:`, e?.message || e); return { t, ok: false }; }),
  ));
  f.tickets = results.filter((r) => !r.ok).map((r) => r.t);
}

/**
 * Close everything on the symbol and PROVE the account went flat.
 * Returns UNKNOWN when the account couldn't be read — the caller must treat
 * that as "do not open", not as flat.
 */
async function closeUntilFlat(id: string, f: Flight): Promise<FlatCheck> {
  await closeBatch(id, f);

  let unreadable = false;
  for (let pass = 1; pass <= FLAT_PASSES; pass++) {
    await sleep(SETTLE_MS * pass); // 1.5s, 3s, 4.5s, 6s
    const open = await openPositions(id, f.symbol);

    if (open === null) { unreadable = true; continue; }
    unreadable = false;

    if (open.length === 0) { f.tickets = []; return 'FLAT'; }

    console.warn(`[Batch:srv] ${id} still ${open.length} open on ${f.symbol} (pass ${pass}) — re-closing`);
    f.tickets = open.map((o: any) => o.ticket); // remember them, never drop
    await Promise.all(open.map((o: any) =>
      orderClose({ id, ticket: o.ticket, lots: o.lots ?? f.volume }).catch(() => {}),
    ));
  }

  return unreadable ? 'UNKNOWN' : 'STILL_OPEN';
}

/**
 * One cycle: prove flat → (optionally flip) → open. If flat can't be proven
 * the cycle is ABANDONED — direction is left alone and nothing new is opened.
 * Holding one direction too long is survivable; opening the opposite side on
 * top of live positions is not.
 */
async function attemptCycle(id: string, flip: boolean): Promise<void> {
  const f = flights.get(id);
  if (!f || !f.active) return;

  const state = await closeUntilFlat(id, f);
  if (flights.get(id) !== f || !f.active) return;

  if (state !== 'FLAT') {
    f.status = state === 'UNKNOWN'
      ? `Cannot verify ${f.symbol} is flat — holding ${f.dir}, retry in ${RETRY_MS / 1000}s`
      : `${f.tickets.length} position(s) on ${f.symbol} would not close — holding ${f.dir}, retry in ${RETRY_MS / 1000}s`;
    console.error(`[Batch:srv] ${id} cycle ABORTED (${state}) — no opposite batch opened. ${f.status}`);
    persist(id, f);
    f.timer = setTimeout(() => attemptCycle(id, flip), RETRY_MS);
    return;
  }

  if (flip) f.dir = f.dir === 'Buy' ? 'Sell' : 'Buy';
  await openBatch(id, f);
  if (flights.get(id) !== f || !f.active) return;

  f.legCount += 1;
  f.nextFlipAt = Date.now() + f.intervalMs;
  f.status = `${f.dir} ${f.symbol} x${f.tickets.length} — flips in ${Math.round(f.intervalMs / 60000)}m`;
  persist(id, f);
  f.timer = setTimeout(() => attemptCycle(id, true), f.intervalMs);
}

// ── Public API ──
export function startBatch(params: { id: string; symbol: string; volume: number; count: number; intervalMs: number; comment?: string }) {
  const { id } = params;
  stopBatch(id, true).catch(() => {});
  const f: Flight = {
    symbol: params.symbol,
    volume: params.volume || 0.01,
    count: Math.max(1, params.count || 1),
    intervalMs: Math.max(5000, params.intervalMs || 600000),
    comment: (params.comment || '').slice(0, 31),
    dir: Math.random() < 0.5 ? 'Buy' : 'Sell', // random first side; flips each cycle
    tickets: [],
    timer: null,
    active: true,
    status: 'Starting…',
    legCount: 0,
    startedAt: Date.now(),
    nextFlipAt: 0,
  };
  flights.set(id, f);
  ensureKeepAlive();
  console.log(`[Batch:srv] START ${id} — ${f.symbol} x${f.count} @ ${f.volume}, flip every ${Math.round(f.intervalMs / 60000)}m`);
  // First cycle clears the symbol and proves it flat before opening (no flip —
  // the random first direction stands).
  attemptCycle(id, false);
  return { ok: true, running: true };
}

export async function stopBatch(id: string, closeOpen = true) {
  const f = flights.get(id);
  if (!f) { unpersist(id); return { ok: true, wasRunning: false }; }
  f.active = false;
  if (f.timer) { clearTimeout(f.timer); f.timer = null; }
  let leftOpen: FlatCheck = 'FLAT';
  if (closeOpen) {
    // Sweep the symbol, not just our ticket list — a send whose response was
    // lost leaves a position STOP would otherwise walk away from. f.active
    // stays false throughout: any attemptCycle still in flight must see a
    // dead flight and bail rather than open while we're stopping.
    leftOpen = await closeUntilFlat(id, f);
    if (leftOpen !== 'FLAT') {
      console.error(`[Batch:srv] ${id} STOP could not confirm flat (${leftOpen}) — ${f.tickets.length} ticket(s) may still be open on ${f.symbol}`);
    }
  }
  flights.delete(id);
  unpersist(id);
  maybeStopKeepAlive();
  console.log(`[Batch:srv] STOP ${id}`);
  return { ok: true, wasRunning: true, flat: leftOpen === 'FLAT', flatCheck: leftOpen };
}

export function getStatus(id: string) {
  const f = flights.get(id);
  if (!f || !f.active) return { running: false };
  return {
    running: true,
    symbol: f.symbol,
    volume: f.volume,
    count: f.count,
    dir: f.dir,
    openTickets: f.tickets.length,
    status: f.status,
    legCount: f.legCount,
    intervalMs: f.intervalMs,
    msToFlip: Math.max(0, f.nextFlipAt - Date.now()),
  };
}

// ── Resume on boot ──
export async function resumeBatches(): Promise<void> {
  if (!PERSIST) { console.log('[Batch:srv] resume disabled (not production) — skipping'); return; }
  try {
    await ensureTable();
    const pool = await getPool();
    const [rows]: any = await pool.query('SELECT uuid, data FROM tp_mt5_batches');
    if (!Array.isArray(rows) || rows.length === 0) return;
    for (const row of rows) {
      const id = row.uuid;
      if (flights.has(id)) continue;
      let c: any;
      try { c = JSON.parse(row.data); } catch { continue; }
      const f: Flight = {
        symbol: c.symbol,
        volume: c.volume || 0.01,
        count: Math.max(1, c.count || 1),
        intervalMs: Math.max(5000, c.intervalMs || 600000),
        comment: c.comment || '',
        dir: c.dir === 'Sell' ? 'Sell' : 'Buy',
        tickets: Array.isArray(c.tickets) ? c.tickets : [],
        timer: null,
        active: true,
        status: 'Resumed',
        legCount: Number(c.legCount) || 0,
        startedAt: Number(c.startedAt) || Date.now(),
        nextFlipAt: Number(c.nextFlipAt) || Date.now(),
      };
      flights.set(id, f);
      console.log(`[Batch:srv] RESUME ${id} — ${f.symbol} x${f.count} flip every ${Math.round(f.intervalMs / 60000)}m (due in ${Math.round((f.nextFlipAt - Date.now()) / 1000)}s)`);
      ensureKeepAlive();

      // Persisted ticket IDs can be hours stale — the broker may have closed
      // them, or filled orders we never recorded. Re-read what the account
      // actually holds before scheduling anything, and never fire instantly on
      // boot: a restart storm would otherwise trade on a session that has only
      // just come up.
      void (async () => {
        const live = await openPositions(id, f.symbol);
        if (flights.get(id) !== f || !f.active) return;
        if (live === null) {
          f.status = 'Resumed but the account could not be read — retrying before any flip';
          console.error(`[Batch:srv] ${id} resume could not read positions — deferring ${RETRY_MS / 1000}s`);
          f.timer = setTimeout(() => attemptCycle(id, true), RETRY_MS);
          return;
        }
        f.tickets = live.map((o: any) => o.ticket);
        console.log(`[Batch:srv] ${id} resume adopted ${f.tickets.length} live position(s) on ${f.symbol}`);
        const due = f.nextFlipAt - Date.now();
        f.timer = setTimeout(() => attemptCycle(id, true), Math.max(RESUME_MIN_DELAY_MS, due));
      })();
    }
  } catch (e: any) {
    console.error('[Batch:srv] resumeBatches error:', e?.message || e);
  }
}
