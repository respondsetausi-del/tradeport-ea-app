// Server-side moving-average strategy engine (SERVER ONLY).
//
// Unlike the batch engine, this one has NO timer-driven flip. Direction is
// decided by the market: EMA cross, gated by an ATR separation test and a
// higher-timeframe trend filter, evaluated on CLOSED candles only. It opens
// when a direction appears, holds while it persists, and goes flat when the
// edge disappears. A direction change is only ever executed through a PROVEN
// flat account — the same fail-closed rule as the hardened batch engine.
import {
  orderSend, orderClose, orderModify, getOpenOrders, getClosedOrders,
  getPriceHistory, ensureConnected,
} from '@/services/api2trade';
import type { Candle } from '@/services/api2trade';
import { getPool } from '@/app/api/_db';
import { decide, type Direction, type Signal, type SignalConfig } from './indicators';
import {
  decimalsOf, stopPrice, targetPrice, trailTo,
  realisedSince, consecutiveLosses, isWeekendFlat,
} from './risk';
import { encrypt, decrypt, isEncrypted, encryptionAvailable } from './secrets';
import { recordIntent, settle, markClosed, buildTag, newRunId } from './journal';

export interface RiskConfig {
  slAtrMult: number;        // protective stop distance, x ATR. 0 disables (not advised)
  tpAtrMult: number;        // take profit, x ATR. 0 = none, let the trail work
  trailStartAtr: number;    // profit needed before trailing begins, x ATR
  trailAtr: number;         // trail distance, x ATR. 0 disables trailing
  maxDailyLoss: number;     // account currency, positive number. 0 disables
  maxConsecutiveLosses: number; // 0 disables
  fridayFlatHourUtc: number;    // flatten from this hour Friday UTC. 0 disables
}

/** Credentials needed to revive a dead broker session with the app closed. */
export interface SessionCreds {
  server: string;
  login: string;
  password: string;
}

interface Run {
  symbol: string;
  volume: number;
  count: number;
  comment: string;
  cfg: SignalConfig;
  timeframeMin: number;
  htfMin: number;
  evalMs: number;
  alwaysIn: boolean;
  maxWaitMs: number;   // grace window before falling back to the bare direction
  flatSince: number;
  flatWhenNoSignal: boolean;
  reenterEachBar: boolean;

  held: Direction | null;
  hedged: boolean;
  tickets: number[];
  timer: ReturnType<typeof setTimeout> | null;
  active: boolean;
  status: string;        // internal — names the rules, for us
  publicStatus: string;  // user-facing — never names the rules
  lastBar: string | null;
  lastSignal: Signal | null;
  trades: number;
  startedAt: number;
  history: string[]; // human-readable decision log, newest last
  creds: SessionCreds | null;
  lastSessionCheck: number;

  runId: string;
  seq: number;
  risk: RiskConfig;
  entryPrice: number | null;
  currentStop: number | null;
  decimals: number;
  halted: boolean;
  haltReason: string | null;
}

const runs = new Map<string, Run>();

// Persistence is PRODUCTION-GATED for the same reason the batch engine's is: a
// local dev server sharing this MySQL would otherwise reload live runs on boot
// and trade a real account. Opt in locally with STRATEGY_PERSIST=1 only if you
// know what that means.
const PERSIST = process.env.RENDER === 'true' || process.env.STRATEGY_PERSIST === '1';
const SESSION_CHECK_MS = 60_000;
let tableReady = false;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = await getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS tp_mt5_strategies (
      uuid VARCHAR(80) PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
  tableReady = true;
}

function persist(id: string, r: Run): void {
  if (!PERSIST) return;
  (async () => {
    try {
      await ensureTable();
      const pool = await getPool();
      // Credentials are stored so the run can revive its own broker session
      // while every device is asleep, and are encrypted at rest. With no
      // CREDS_KEY set we store NOTHING rather than fall back to plaintext —
      // the run then cannot self-revive, which is the safer failure.
      const encCreds = r.creds ? encrypt(JSON.stringify(r.creds)) : null;
      if (r.creds && !encCreds) {
        console.error('[Strat:srv] CREDS_KEY not set — credentials NOT persisted; this run cannot revive its own session');
      }
      const data = JSON.stringify({
        symbol: r.symbol, volume: r.volume, count: r.count, comment: r.comment,
        cfg: r.cfg, timeframeMin: r.timeframeMin, htfMin: r.htfMin,
        evalMs: r.evalMs, alwaysIn: r.alwaysIn, maxWaitMs: r.maxWaitMs,
        flatWhenNoSignal: r.flatWhenNoSignal, reenterEachBar: r.reenterEachBar,
        trades: r.trades, startedAt: r.startedAt, creds: encCreds, risk: r.risk,
      });
      await pool.query(
        'INSERT INTO tp_mt5_strategies (uuid, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [id, data],
      );
    } catch (e: any) { console.error('[Strat:srv] persist error:', e?.message || e); }
  })();
}

function unpersist(id: string): void {
  if (!PERSIST) return;
  (async () => {
    try { await ensureTable(); const pool = await getPool(); await pool.query('DELETE FROM tp_mt5_strategies WHERE uuid = ?', [id]); }
    catch (e: any) { console.error('[Strat:srv] unpersist error:', e?.message || e); }
  })();
}

/**
 * Keep the broker session alive. Api2Trade drops idle sessions and then every
 * call returns INVALID_TOKEN — which, before the orders route was fixed, read
 * as "no open positions". Probing and silently re-authenticating under the
 * SAME uuid keeps the run and the client's stored handle valid.
 */
async function ensureSession(id: string, r: Run, force = false): Promise<void> {
  if (!r.creds) return;
  if (!force && Date.now() - r.lastSessionCheck < SESSION_CHECK_MS) return;
  r.lastSessionCheck = Date.now();
  try {
    const { reconnected } = await ensureConnected(id, r.creds.server, r.creds.login, r.creds.password);
    if (reconnected) {
      note(r, 'broker session had expired — reconnected automatically');
      console.warn(`[Strat:srv] ${id} session was dead — reconnected`);
    }
  } catch (e: any) {
    console.error(`[Strat:srv] ${id} reconnect failed:`, e?.message || e);
  }
}

const FLAT_PASSES = 4;
const SETTLE_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type FlatCheck = 'FLAT' | 'STILL_OPEN' | 'UNKNOWN';

function note(r: Run, msg: string): void {
  r.history.push(msg);
  if (r.history.length > 60) r.history.shift();
}

/** Positions open on this symbol, or null when the account can't be read. */
async function openPositions(id: string, symbol: string): Promise<any[] | null> {
  try {
    const open = await getOpenOrders(id);
    if (!Array.isArray(open)) return null; // error object — unknown, NOT flat
    return open.filter((o: any) => o?.symbol === symbol && o?.ticket);
  } catch (e: any) {
    console.error(`[Strat:srv] ${id} openPositions error:`, e?.message || e);
    return null;
  }
}

/** Close everything on the symbol and PROVE it. Never assumes flat. */
async function closeUntilFlat(id: string, r: Run): Promise<FlatCheck> {
  const mine = [...r.tickets];
  if (mine.length) {
    const results = await Promise.all(mine.map((t) =>
      orderClose({ id, ticket: t, lots: r.volume })
        .then(() => ({ t, ok: true }))
        .catch((e: any) => { console.error(`[Strat:srv] ${id} close ${t}:`, e?.message || e); return { t, ok: false }; }),
    ));
    r.tickets = results.filter((x) => !x.ok).map((x) => x.t);
    await markClosed(results.filter((x) => x.ok).map((x) => x.t));
  }

  let unreadable = false;
  for (let pass = 1; pass <= FLAT_PASSES; pass++) {
    await sleep(SETTLE_MS * pass);
    const open = await openPositions(id, r.symbol);
    if (open === null) { unreadable = true; continue; }
    unreadable = false;
    if (open.length === 0) { r.tickets = []; r.held = null; return 'FLAT'; }

    console.warn(`[Strat:srv] ${id} still ${open.length} open on ${r.symbol} (pass ${pass}) — re-closing`);
    r.tickets = open.map((o: any) => o.ticket);
    await Promise.all(open.map((o: any) =>
      orderClose({ id, ticket: o.ticket, lots: o.lots ?? r.volume }).catch(() => {}),
    ));
  }
  return unreadable ? 'UNKNOWN' : 'STILL_OPEN';
}

async function openDirection(id: string, r: Run, dir: Direction): Promise<void> {
  // Write intent BEFORE sending. If the response never arrives, this row is the
  // only record that an order might exist at the broker.
  const orders = Array.from({ length: r.count }, (_, i) => {
    r.seq += 1;
    return {
      key: `${id.slice(0, 8)}-${r.runId}-${r.seq}`,
      tag: buildTag(r.comment, r.runId, r.seq),
    };
  });
  await Promise.all(orders.map((o) =>
    recordIntent(id, o.key, r.symbol, dir, r.volume, o.tag),
  ));

  const results: any[] = await Promise.all(
    orders.map((o) =>
      orderSend({ id, symbol: r.symbol, operation: dir, volume: r.volume, comment: o.tag })
        .then(async (res: any) => {
          const ticket = Number(res?.ticket);
          if (ticket > 0) await settle(o.key, 'filled', ticket, Number(res?.openPrice) || null);
          else await settle(o.key, 'rejected', null, null, String(res?.error || res?.message || 'no ticket'));
          return res;
        })
        .catch(async (e: any) => {
          console.error(`[Strat:srv] ${id} open error:`, e?.message || e);
          // NOT 'rejected' — we genuinely do not know. It may be live.
          await settle(o.key, 'unknown', null, null, String(e?.message || e).slice(0, 200));
          return null;
        }),
    ),
  );

  let lost = 0;
  for (const o of results) {
    if (o && typeof o.ticket === 'number' && o.ticket > 0) r.tickets.push(o.ticket);
    else if (!o) lost += 1;
  }

  // A send that threw may still have filled — adopt anything untracked.
  if (lost > 0) {
    const live = await openPositions(id, r.symbol);
    if (live) {
      const adopted = live.filter((o: any) => !r.tickets.includes(o.ticket)).map((o: any) => o.ticket);
      if (adopted.length) {
        r.tickets.push(...adopted);
        console.warn(`[Strat:srv] ${id} adopted ${adopted.length} untracked ticket(s)`);
      }
    }
  }

  // Average fill, for stop placement. Falls back to the last close if the
  // broker didn't echo a price.
  const fills = results
    .map((o: any) => Number(o?.openPrice))
    .filter((p: number) => Number.isFinite(p) && p > 0);
  r.entryPrice = fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : null;
  r.currentStop = null;

  r.held = r.tickets.length ? dir : null;
  r.trades += 1;
  console.log(`[Strat:srv] ${id} opened ${r.tickets.length}/${r.count} ${dir} ${r.symbol} @ ${r.entryPrice ?? '?'}`);
}

/**
 * Put a protective stop AT THE BROKER on every open ticket.
 *
 * This is the only exit that survives this server dying. Every other rule here
 * — signal exits, trailing, loss caps — needs the engine alive to act. If the
 * process is killed mid-trade, the stop is what stands between the account and
 * an unbounded loss.
 */
async function applyProtection(id: string, r: Run, dir: Direction, atrValue: number): Promise<void> {
  if (!r.tickets.length || !r.entryPrice || !(atrValue > 0) || r.risk.slAtrMult <= 0) return;

  const sl = stopPrice(r.entryPrice, atrValue, dir, r.risk.slAtrMult, r.decimals);
  const tp = targetPrice(r.entryPrice, atrValue, dir, r.risk.tpAtrMult, r.decimals);

  const results = await Promise.all(r.tickets.map((t) =>
    orderModify({ id, ticket: t, stoploss: sl, takeprofit: tp ?? 0 })
      .then(() => true)
      .catch((e: any) => { console.error(`[Strat:srv] ${id} stop on ${t} failed:`, e?.message || e); return false; }),
  ));

  const ok = results.filter(Boolean).length;
  r.currentStop = ok > 0 ? sl : null;
  if (ok < r.tickets.length) {
    // Say it loudly. An unprotected position is the thing this whole layer exists to prevent.
    note(r, `WARNING: stop set on only ${ok}/${r.tickets.length} trades`);
    console.error(`[Strat:srv] ${id} stop set on only ${ok}/${r.tickets.length} tickets`);
  } else {
    note(r, `stop ${sl}${tp !== null ? ` / target ${tp}` : ''}`);
  }
}

/** Move the stop up behind a winning trade. Never backwards. */
async function updateTrailing(id: string, r: Run, price: number, atrValue: number): Promise<void> {
  if (!r.held || !r.tickets.length || !r.entryPrice || !(atrValue > 0)) return;
  const next = trailTo(
    r.entryPrice, price, atrValue, r.held, r.currentStop,
    r.risk.trailStartAtr, r.risk.trailAtr, r.decimals,
  );
  if (next === null) return;

  const results = await Promise.all(r.tickets.map((t) =>
    orderModify({ id, ticket: t, stoploss: next, takeprofit: 0 })
      .then(() => true)
      .catch(() => false),
  ));
  if (results.some(Boolean)) {
    r.currentStop = next;
    note(r, `trailing stop -> ${next}`);
  }
}

/**
 * Account-level breakers. Returns a reason to halt, or null to carry on.
 * Checked BEFORE any decision to open, so a breached cap can't be followed by
 * one more trade.
 */
async function breachedLimits(id: string, r: Run): Promise<string | null> {
  if (r.risk.maxDailyLoss <= 0 && r.risk.maxConsecutiveLosses <= 0) return null;
  let closed: any[];
  try {
    const res = await getClosedOrders(id);
    if (!Array.isArray(res)) return null; // can't read — don't halt on a bad read
    closed = res;
  } catch {
    return null;
  }

  if (r.risk.maxDailyLoss > 0) {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const realised = realisedSince(closed, since);
    if (realised <= -Math.abs(r.risk.maxDailyLoss)) {
      return `daily loss cap hit (${realised.toFixed(2)} today, limit ${r.risk.maxDailyLoss})`;
    }
  }

  if (r.risk.maxConsecutiveLosses > 0) {
    const streak = consecutiveLosses(closed);
    if (streak >= r.risk.maxConsecutiveLosses) {
      return `${streak} losing trades in a row (limit ${r.risk.maxConsecutiveLosses})`;
    }
  }
  return null;
}

/** Flatten and stop trading until a human restarts it. */
async function halt(id: string, r: Run, reason: string): Promise<void> {
  const state = await closeUntilFlat(id, r);
  r.halted = true;
  r.haltReason = reason;
  r.active = false;
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  note(r, `HALTED — ${reason}${state === 'FLAT' ? '' : ` (could not confirm flat: ${state})`}`);
  r.status = `halted — ${reason}`;
  r.publicStatus = state === 'FLAT'
    ? 'Stopped for today to protect your account.'
    : 'Stopped to protect your account — check MetaTrader for open trades.';
  console.error(`[Strat:srv] ${id} HALTED — ${reason}`);
  persist(id, r);
}

/** Closed candles only — the newest bar is still forming and would flicker. */
async function closedCandles(id: string, symbol: string, tfMin: number, bars: number): Promise<Candle[] | null> {
  const to = new Date(Date.now() + 2 * 60 * 60 * 1000); // overshoot: broker clock may lead
  const from = new Date(Date.now() - tfMin * (bars + 30) * 4 * 60 * 1000);
  try {
    const raw = await getPriceHistory(id, symbol, tfMin, from, to);
    if (!Array.isArray(raw) || raw.length < 2) return null;
    return raw.slice(0, -1); // drop the forming bar
  } catch (e: any) {
    console.error(`[Strat:srv] ${id} history(${tfMin}m) error:`, e?.message || e);
    return null;
  }
}

/**
 * Trust the ACCOUNT, not our memory of it.
 *
 * Positions can vanish or appear without us: a user closing by hand, a broker
 * stop-out, another engine, a fill whose response we lost. Re-deriving held
 * direction and ticket list from live positions every cycle is what keeps the
 * reported state and the real state from drifting apart. Returns false when
 * the account can't be read (state left untouched — never guess).
 */
async function reconcile(id: string, r: Run): Promise<boolean> {
  const live = await openPositions(id, r.symbol);
  if (live === null) return false;

  const tickets = live.map((o: any) => o.ticket);
  const sides = new Set(live.map((o: any) => o.orderType));
  const before = { held: r.held, n: r.tickets.length };

  r.tickets = tickets;
  if (sides.size > 1) {
    r.held = null;
    r.hedged = true;
    note(r, `HEDGE DETECTED on ${r.symbol}: ${[...sides].join(' + ')} open together`);
    console.error(`[Strat:srv] ${id} HEDGE on ${r.symbol} — ${[...sides].join(' + ')}`);
  } else {
    r.hedged = false;
    r.held = tickets.length ? ((live[0].orderType === 'Sell' ? 'Sell' : 'Buy') as Direction) : null;
  }

  if (before.held !== r.held || before.n !== r.tickets.length) {
    note(r, `reconciled: was ${before.held ?? 'flat'} x${before.n}, account says ${r.held ?? 'flat'} x${r.tickets.length}`);
    console.warn(`[Strat:srv] ${id} reconciled ${before.held ?? 'flat'} x${before.n} -> ${r.held ?? 'flat'} x${r.tickets.length}`);
  }
  return true;
}

async function evaluate(id: string): Promise<void> {
  const r = runs.get(id);
  if (!r || !r.active) return;

  try {
    // Keep the broker session alive before anything else touches the account.
    await ensureSession(id, r);
    if (!r.active) return;

    // Always re-derive our position from the account before deciding anything.
    let known = await reconcile(id, r);
    if (!r.active) return;
    if (!known) {
      // A failed read is the classic symptom of an expired session — force a
      // reconnect and try once more before giving up this cycle.
      await ensureSession(id, r, true);
      known = await reconcile(id, r);
      if (!r.active) return;
    }
    if (!known) {
      r.status = 'Account unreadable — holding, will retry';
      r.publicStatus = 'Reconnecting to your account…';
      return;
    }
    if (r.hedged) {
      const state = await closeUntilFlat(id, r);
      r.status = state === 'FLAT'
        ? 'Hedge found and cleared — flat'
        : `Hedge found but could not clear (${state})`;
      return;
    }

    const need = Math.max(r.cfg.slow, r.cfg.atrPeriod + 1) + r.cfg.confirmBars + 5;
    const [candles, htf] = await Promise.all([
      closedCandles(id, r.symbol, r.timeframeMin, need),
      closedCandles(id, r.symbol, r.htfMin, r.cfg.htfPeriod + 5),
    ]);
    if (!r.active) return;

    if (!candles || !htf) {
      r.status = 'Price history unavailable — holding, will retry';
      return;
    }

    // `r.held` came from reconcile() above, so exits are judged against what
    // the account really holds, not what we think we opened.
    const sig = decide(candles, htf, r.cfg, r.held);
    r.lastSignal = sig;

    const bar = sig.bar ?? candles[candles.length - 1]?.time ?? null;
    const isNewBar = bar !== r.lastBar;
    r.lastBar = bar;

    // Price precision from what the broker actually quotes — a stop with more
    // decimals than the symbol allows gets rejected.
    const last = candles[candles.length - 1];
    r.decimals = decimalsOf(last?.closePrice, last?.openPrice, last?.highPrice, r.entryPrice);
    const price = last?.closePrice ?? 0;
    const atrValue = sig.atr ?? 0;

    // ── Account breakers, checked BEFORE any decision to open ──────────────
    const breach = await breachedLimits(id, r);
    if (!r.active) return;
    if (breach) { await halt(id, r, breach); return; }

    // ── Weekend / rollover: be flat, stay flat ────────────────────────────
    if (bar && isWeekendFlat(bar, r.risk.fridayFlatHourUtc)) {
      if (r.held) {
        const state = await closeUntilFlat(id, r);
        note(r, `${bar}  weekend flat → ${state === 'FLAT' ? 'closed' : `CLOSE FAILED (${state})`}`);
      }
      r.status = 'flat for the weekend';
      r.publicStatus = 'Paused until the market reopens.';
      return;
    }

    // Trail a winner every cycle, not just on bar close — the stop should
    // follow price, and price moves between bars.
    if (r.held && r.tickets.length && r.risk.trailAtr > 0) {
      await updateTrailing(id, r, price, atrValue);
      if (!r.active) return;
    }

    // Act only on a newly closed bar; between bars nothing can have changed.
    if (!isNewBar) {
      r.status = `${r.held ? `holding ${r.held} x${r.tickets.length}` : 'flat'} — ${sig.reason}`;
      return;
    }

    // ── ALWAYS-IN MODE ──────────────────────────────────────────────────
    // Hold the indicator's direction at all times. No ranging stand-aside, no
    // waiting for gates: whichever way the EMAs point is what we hold, and a
    // genuine cross reverses us. Every reversal still goes through a PROVEN
    // flat account, so Buy and Sell can never be open together.
    if (r.alwaysIn) {
      const target = sig.raw;
      if (!target) {
        r.status = `waiting for indicators — ${sig.reason}`;
        r.publicStatus = 'Starting up…';
        return;
      }
      if (r.held === target && r.tickets.length > 0 && !r.reenterEachBar) {
        r.status = `holding ${r.held} x${r.tickets.length} — indicator still ${target}`;
        r.publicStatus = `Trade running — ${r.held} x${r.tickets.length}`;
        return;
      }
      const state = await closeUntilFlat(id, r);
      if (!r.active) return;
      if (state !== 'FLAT') {
        note(r, `${bar}  wanted ${target} but could not prove flat (${state}) — NOT opening`);
        r.status = `cannot prove flat (${state}) — ${target} withheld`;
        r.publicStatus = 'Preparing your account…';
        console.error(`[Strat:srv] ${id} ${target} WITHHELD — flat unproven (${state})`);
        return;
      }
      await openDirection(id, r, target);
      await applyProtection(id, r, target, atrValue);
      r.flatSince = Date.now();
      note(r, `${bar}  ${target} x${r.tickets.length} — indicator direction`);
      persist(id, r);
      r.status = `${target} x${r.tickets.length} — indicator direction`;
      r.publicStatus = `Trade running — ${target} x${r.tickets.length}`;
      return;
    }

    // SIGNAL EXIT — the position no longer qualifies (cross against it,
    // separation collapsed below the hysteresis floor, or the higher timeframe
    // turned). Close to flat and wait for a fresh entry.
    if (sig.action === 'exit') {
      if (!r.flatWhenNoSignal) {
        r.status = `holding ${r.held} — ${sig.reason} (auto-exit disabled)`;
        return;
      }
      const state = await closeUntilFlat(id, r);
      note(r, `${bar}  EXIT — ${sig.reason} → ${state === 'FLAT' ? 'flat' : `CLOSE FAILED (${state})`}`);
      persist(id, r);
      r.status = state === 'FLAT' ? `flat — ${sig.reason}` : `could not flatten (${state}) — retrying`;
      return;
    }

    // Flat and nothing qualifies yet.
    if (sig.action === 'none' || sig.dir === null) {
      const waitedMs = Date.now() - r.flatSince;

      // GRACE WINDOW — users should not stare at an idle robot. If the strict
      // gates haven't produced an entry within maxWaitMs, take the indicator's
      // bare direction instead. This is a deliberate trade: some of these
      // entries are ones the separation/confirmation gates would have refused.
      // It is still the market's direction, never a coin flip, and the exit
      // rules manage it exactly the same way once open.
      if (r.maxWaitMs > 0 && waitedMs >= r.maxWaitMs && sig.raw) {
        const state = await closeUntilFlat(id, r);
        if (!r.active) return;
        if (state !== 'FLAT') {
          r.status = 'Preparing your account…';
          r.publicStatus = 'Preparing your account…';
          return;
        }
        await openDirection(id, r, sig.raw);
        r.flatSince = Date.now();
        note(r, `${bar}  ENTER ${sig.raw} x${r.tickets.length} — grace window (${Math.round(waitedMs / 60000)}m elapsed, gates not met: ${sig.reason})`);
        r.status = `${sig.raw} x${r.tickets.length} — grace-window entry after ${Math.round(waitedMs / 60000)}m`;
        r.publicStatus = `Trade running — ${sig.raw} x${r.tickets.length}`;
        return;
      }

      const left = r.maxWaitMs > 0 ? Math.max(0, Math.ceil((r.maxWaitMs - waitedMs) / 60000)) : null;
      r.status = `flat — ${sig.reason}`;
      r.publicStatus = left !== null
        ? `Analysing the market — trade expected within ${left}m`
        : 'Analysing the market';
      return;
    }

    // Holding the right thing. Leave it alone — churning out and back into the
    // same side just pays the spread twice.
    //
    // reenterEachBar overrides this: every bar is closed and re-entered so each
    // trade maps to exactly one bar's signal. A diagnostic mode, not a way to
    // make money — it pays the spread every bar.
    if (sig.action === 'hold' && !r.reenterEachBar) {
      r.status = `holding ${r.held} x${r.tickets.length} — ${sig.reason}`;
      return;
    }

    // Direction change (or first entry): flatten and PROVE it before reversing.
    const state = await closeUntilFlat(id, r);
    if (!r.active) return;
    if (state !== 'FLAT') {
      note(r, `${bar}  wanted ${sig.dir} but could not prove flat (${state}) — NOT opening`);
      r.status = `cannot prove flat (${state}) — ${sig.dir} withheld`;
      console.error(`[Strat:srv] ${id} ${sig.dir} WITHHELD — flat unproven (${state})`);
      return;
    }

    await openDirection(id, r, sig.dir);
    await applyProtection(id, r, sig.dir, atrValue);
    note(r, `${bar}  ${sig.dir} x${r.tickets.length} — ${sig.reason}`);
    r.status = `${sig.dir} x${r.tickets.length} — ${sig.reason}`;
  } catch (e: any) {
    console.error(`[Strat:srv] ${id} evaluate error:`, e?.message || e);
    r.status = `evaluate error: ${e?.message || e}`;
  } finally {
    const rr = runs.get(id);
    if (rr && rr.active) rr.timer = setTimeout(() => evaluate(id), rr.evalMs);
  }
}

// ── Public API ──
export interface StartParams {
  id: string;
  symbol: string;
  volume: number;
  count?: number;
  comment?: string;
  timeframeMin?: number;
  htfMin?: number;
  fast?: number;
  slow?: number;
  atrPeriod?: number;
  atrMult?: number;
  exitMult?: number;
  confirmBars?: number;
  htfPeriod?: number;
  evalSeconds?: number;
  alwaysIn?: boolean;
  maxWaitMinutes?: number;
  flatWhenNoSignal?: boolean;
  reenterEachBar?: boolean;
  slAtrMult?: number;
  tpAtrMult?: number;
  trailStartAtr?: number;
  trailAtr?: number;
  maxDailyLoss?: number;
  maxConsecutiveLosses?: number;
  fridayFlatHourUtc?: number;
  /** Stored so the run can revive its own broker session with the app closed. */
  creds?: SessionCreds;
}

export function startStrategy(p: StartParams) {
  const { id } = p;
  stopStrategy(id, true).catch(() => {});

  const r: Run = {
    symbol: p.symbol,
    volume: p.volume || 0.01,
    count: Math.max(1, Math.min(100, p.count || 1)),
    comment: (p.comment || 'Robot').slice(0, 31),
    timeframeMin: Math.max(1, p.timeframeMin || 15),
    htfMin: Math.max(1, p.htfMin || 60),
    evalMs: Math.max(5, p.evalSeconds || 20) * 1000,
    // Always-in is the default: hold the indicator's direction, never stand
    // aside for ranging. Set alwaysIn:false to use the gated entry rules
    // (separation / confirmation / higher-timeframe filter) instead.
    alwaysIn: p.alwaysIn !== false,
    maxWaitMs: Math.max(0, p.maxWaitMinutes ?? 10) * 60_000,
    flatSince: Date.now(),
    flatWhenNoSignal: p.flatWhenNoSignal !== false,
    reenterEachBar: p.reenterEachBar === true,
    publicStatus: 'Starting up…',
    cfg: {
      fast: Math.max(2, p.fast || 21),
      slow: Math.max(3, p.slow || 55),
      atrPeriod: Math.max(2, p.atrPeriod || 14),
      atrMult: p.atrMult ?? 0.25,
      // Exit floor defaults to half the entry threshold. That gap IS the
      // hysteresis — set them equal and the position flickers at the boundary.
      exitMult: p.exitMult ?? (p.atrMult ?? 0.25) / 2,
      confirmBars: Math.max(0, p.confirmBars ?? 1),
      htfPeriod: Math.max(2, p.htfPeriod || 200),
    },
    held: null,
    hedged: false,
    tickets: [],
    timer: null,
    active: true,
    status: 'Starting…',
    lastBar: null,
    lastSignal: null,
    trades: 0,
    startedAt: Date.now(),
    history: [],
    // Defaults are protective on purpose: a stop is always placed unless
    // someone explicitly sets slAtrMult to 0.
    risk: {
      slAtrMult: p.slAtrMult ?? 1.5,
      tpAtrMult: p.tpAtrMult ?? 0,
      trailStartAtr: p.trailStartAtr ?? 1.0,
      trailAtr: p.trailAtr ?? 1.0,
      maxDailyLoss: Math.abs(p.maxDailyLoss ?? 0),
      maxConsecutiveLosses: Math.max(0, p.maxConsecutiveLosses ?? 0),
      fridayFlatHourUtc: Math.max(0, p.fridayFlatHourUtc ?? 0),
    },
    runId: newRunId(Date.now()),
    seq: 0,
    entryPrice: null,
    currentStop: null,
    decimals: 2,
    halted: false,
    haltReason: null,
    creds: p.creds && p.creds.server && p.creds.login && p.creds.password ? p.creds : null,
    lastSessionCheck: 0,
  };
  if (r.cfg.fast >= r.cfg.slow) return { ok: false, error: 'fast EMA period must be shorter than slow' };

  runs.set(id, r);
  persist(id, r);
  console.log(`[Strat:srv] START ${id} — ${r.symbol} EMA${r.cfg.fast}/${r.cfg.slow} on ${r.timeframeMin}m, HTF EMA${r.cfg.htfPeriod} on ${r.htfMin}m, x${r.count} @ ${r.volume}`);
  evaluate(id);
  return { ok: true, running: true };
}

/**
 * What the robot did this session, in plain numbers.
 *
 * Taken from ClosedOrders rather than anything we counted ourselves, so it
 * reflects what the broker actually settled — including trades closed by a
 * stop while this process was asleep, which our own counters would miss.
 */
async function sessionSummary(id: string, r: Run) {
  try {
    const closed = await getClosedOrders(id);
    if (!Array.isArray(closed)) return null;
    const since = r.startedAt;
    const mine = closed.filter((o: any) => {
      if (o?.symbol !== r.symbol || !o?.closeTime) return false;
      const t = new Date(o.closeTime).getTime();
      return Number.isFinite(t) && t >= since;
    });
    const net = (o: any) => (o.profit || 0) + (o.swap || 0) + (o.commission || 0);
    const results = mine.map(net);
    const wins = results.filter((v) => v > 0).length;
    return {
      trades: results.length,
      wins,
      losses: results.filter((v) => v < 0).length,
      winRate: results.length ? Math.round((wins / results.length) * 100) : 0,
      net: Number(results.reduce((a, b) => a + b, 0).toFixed(2)),
      best: results.length ? Number(Math.max(...results).toFixed(2)) : 0,
      worst: results.length ? Number(Math.min(...results).toFixed(2)) : 0,
      minutes: Math.round((Date.now() - since) / 60000),
    };
  } catch {
    return null;
  }
}

export async function stopStrategy(id: string, closeOpen = true) {
  const r = runs.get(id);
  if (!r) return { ok: true, wasRunning: false };
  r.active = false;
  if (r.timer) { clearTimeout(r.timer); r.timer = null; }
  let state: FlatCheck = 'FLAT';
  if (closeOpen) state = await closeUntilFlat(id, r);
  const summary = await sessionSummary(id, r);
  const decisions = r.history.slice(-25);
  runs.delete(id);
  unpersist(id);
  console.log(`[Strat:srv] STOP ${id} (${state})`);
  return { ok: true, wasRunning: true, flat: state === 'FLAT', flatCheck: state, summary, decisions };
}

/**
 * User-facing status. Deliberately says NOTHING about how direction is chosen —
 * no indicator names, periods, thresholds or reasons. Anything that would let a
 * reader reconstruct the method belongs in the detailed view only.
 */
/**
 * Reload live runs after a restart or deploy and carry on.
 *
 * Deliberately does NOT trust anything about positions from the database — it
 * revives the broker session first, then reads what the account actually holds.
 * reconcile() does the rest on the first evaluation.
 */
export async function resumeStrategies(): Promise<void> {
  if (!PERSIST) { console.log('[Strat:srv] resume disabled (not production) — skipping'); return; }
  try {
    await ensureTable();
    const pool = await getPool();
    const [rows]: any = await pool.query('SELECT uuid, data FROM tp_mt5_strategies');
    if (!Array.isArray(rows) || rows.length === 0) return;

    for (const row of rows) {
      const id = row.uuid;
      if (runs.has(id)) continue;
      let c: any;
      try { c = JSON.parse(row.data); } catch { continue; }

      const r: Run = {
        symbol: c.symbol,
        volume: c.volume || 0.01,
        count: Math.max(1, c.count || 1),
        comment: c.comment || 'Robot',
        cfg: c.cfg,
        timeframeMin: c.timeframeMin || 15,
        htfMin: c.htfMin || 60,
        evalMs: c.evalMs || 20_000,
        alwaysIn: c.alwaysIn !== false,
        maxWaitMs: c.maxWaitMs ?? 600_000,
        flatSince: Date.now(),
        flatWhenNoSignal: c.flatWhenNoSignal !== false,
        reenterEachBar: c.reenterEachBar === true,
        held: null,
        hedged: false,
        tickets: [],
        timer: null,
        active: true,
        status: 'Resumed',
        publicStatus: 'Reconnecting to your account…',
        lastBar: null,
        lastSignal: null,
        trades: Number(c.trades) || 0,
        startedAt: Number(c.startedAt) || Date.now(),
        history: [],
        creds: (() => {
          if (!c.creds) return null;
          if (isEncrypted(c.creds)) {
            const plain = decrypt(c.creds);
            if (!plain) { console.error(`[Strat:srv] ${id} stored credentials could not be decrypted — no auto-reconnect`); return null; }
            try { return JSON.parse(plain); } catch { return null; }
          }
          // Legacy plaintext row from before encryption existed.
          console.warn(`[Strat:srv] ${id} credentials stored in plaintext — re-save to encrypt`);
          return c.creds;
        })(),
        lastSessionCheck: 0,
        risk: c.risk || {
          slAtrMult: 1.5, tpAtrMult: 0, trailStartAtr: 1.0, trailAtr: 1.0,
          maxDailyLoss: 0, maxConsecutiveLosses: 0, fridayFlatHourUtc: 0,
        },
        runId: newRunId(Date.now()),
        seq: 0,
        entryPrice: null,
        currentStop: null,
        decimals: 2,
        halted: false,
        haltReason: null,
      };
      runs.set(id, r);
      note(r, 'resumed after server restart');
      console.log(`[Strat:srv] RESUME ${id} — ${r.symbol} x${r.count} @ ${r.volume}`);

      // Revive the broker session before the first evaluation touches anything.
      void (async () => {
        await ensureSession(id, r, true);
        if (runs.get(id) === r && r.active) evaluate(id);
      })();
    }
  } catch (e: any) {
    console.error('[Strat:srv] resumeStrategies error:', e?.message || e);
  }
}

export function getPublicStatus(id: string) {
  const r = runs.get(id);
  if (!r || !r.active) return { running: false };
  return {
    running: true,
    symbol: r.symbol,
    volume: r.volume,
    count: r.count,
    direction: r.held,
    openTrades: r.tickets.length,
    status: r.publicStatus,
    protected: r.currentStop !== null,
    halted: r.halted,
    tradesPlaced: r.trades,
    uptimeSec: Math.round((Date.now() - r.startedAt) / 1000),
  };
}

export function getStrategyStatus(id: string) {
  const r = runs.get(id);
  if (!r || !r.active) return { running: false };
  const s = r.lastSignal;
  return {
    running: true,
    symbol: r.symbol,
    volume: r.volume,
    count: r.count,
    timeframeMin: r.timeframeMin,
    htfMin: r.htfMin,
    config: r.cfg,
    held: r.held,
    hedged: r.hedged,
    risk: r.risk,
    entryPrice: r.entryPrice,
    currentStop: r.currentStop,
    halted: r.halted,
    haltReason: r.haltReason,
    openTickets: r.tickets.length,
    status: r.status,
    trades: r.trades,
    lastBar: r.lastBar,
    signal: s && {
      dir: s.dir, action: s.action, reason: s.reason,
      fast: s.fast, slow: s.slow, atr: s.atr,
      separation: s.separation, required: s.required, exitLevel: s.exitLevel, htf: s.htf,
    },
    history: r.history.slice(-15),
    uptimeSec: Math.round((Date.now() - r.startedAt) / 1000),
  };
}
