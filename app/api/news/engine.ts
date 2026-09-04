// Server-side news scheduler (SERVER ONLY). Arm a trade against a calendar
// event; it fires N seconds before the release and opens `count` positions.
//
// Runs on the Bun server rather than a client timer on purpose: a release is
// often hours away, and a client timer only survives while the app is open.
// The events people actually want to trade are the ones they are not watching.
//
// Follows the batch engine's shape: in-memory timers, best-effort MySQL
// persistence, resume-on-boot, and the same PERSIST guard so a local dev
// server sharing production MySQL cannot reload and fire real schedules.
import { orderSend, getQuote } from '@/services/api2trade';
import { getPool } from '@/app/api/_db';

export type NewsDirection = 'Buy' | 'Sell';

export interface NewsSchedule {
  /** Api2Trade session id (the connected account). */
  uuid: string;
  eventId: string;
  eventTitle: string;
  currency: string;
  symbol: string;
  /**
   * Decided when the order fires, not when it is armed, so it exists
   * nowhere to be read or displayed beforehand. Null until then.
   */
  direction: NewsDirection | null;
  volume: number;
  count: number;
  /** Seconds before the release to fire. */
  leadSeconds: number;
  /** Seconds after the release to judge the move. Defaults to FOLLOW_MS. */
  followSeconds?: number;
  /** Absolute epoch ms the event is released. */
  eventAt: number;
  /** Absolute epoch ms the order fires (eventAt - leadSeconds). */
  fireAt: number;
  status: 'armed' | 'fired' | 'failed' | 'cancelled' | 'missed';
  tickets: number[];
  message: string;
  timer: ReturnType<typeof setTimeout> | null;

  // ── The follow-up batch ───────────────────────────────────────────
  //
  // The first batch is a coin toss taken before the number lands, because
  // nothing readable beforehand predicts the first move. This second batch is
  // not a guess at all: it waits for the release to happen, reads which way
  // price ACTUALLY went, and adds the same number of orders in that direction.
  /** Mid price when the first batch went on. The line the move is judged against. */
  refPrice: number | null;
  /** Epoch ms the follow-up runs: a settling window after the release. */
  followAt: number;
  /** The way price actually moved. Null until it has been judged. */
  followDirection: NewsDirection | null;
  followTickets: number[];
  followTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * How long after the release to judge the move.
 *
 * The first seconds of a release are a liquidity scramble: spreads gap, price
 * whips both ways, and the tape at +5s frequently disagrees with the tape at
 * +90s. Waiting lets the initial spike resolve into a direction worth adding to.
 */
const FOLLOW_MS = 90_000;

/** Test flights compress this; a real release should not go below a few seconds. */
const MIN_FOLLOW_MS = 1_000;

/**
 * Gap between individual orders in a batch.
 *
 * Firing them all at once had the broker reject four of every ten, and reject
 * a follow-up batch outright. Api2Trade serialises per account, and a burst
 * arrives faster than it will take. A quarter second between sends costs
 * almost nothing and gets them filled.
 */
const ORDER_GAP_MS = 250;

/**
 * How late a schedule may fire and still be worth taking.
 *
 * A process restart, a deploy, or a slow boot can leave a moment a little
 * behind us. Two minutes late on a release is still the same move; ten minutes
 * late is a different market. Past this it is recorded as missed rather than
 * fired blind, and rather than deleted, because a schedule that vanished
 * silently is indistinguishable from one that was never armed.
 */
const LATE_GRACE_MS = 120_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const schedules = new Map<string, NewsSchedule>();
let tableReady = false;

// Same guard as the batch engine: without it a local server pointed at the
// shared production MySQL would resume and TRADE someone else's schedules.
const PERSIST = process.env.RENDER === 'true' || process.env.NEWS_PERSIST === '1';

// A timer more than ~24 days out overflows setTimeout's 32-bit delay and fires
// immediately. Calendar events are always inside a week, but clamp anyway
// rather than trust upstream data with a live order.
const MAX_TIMEOUT_MS = 2_147_483_647;

/** Composite key so one account can arm the same event on several symbols. */
export function scheduleKey(uuid: string, eventId: string, symbol: string): string {
  return `${uuid}::${eventId}::${symbol}`;
}

// ── Persistence (best-effort: the timer still runs if the DB is down) ──
async function ensureTable(): Promise<void> {
  if (tableReady) return;
  const pool = await getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS tpe_news_schedules (
      id VARCHAR(200) PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
  tableReady = true;
}

function persist(key: string, s: NewsSchedule): void {
  if (!PERSIST) return;
  (async () => {
    try {
      await ensureTable();
      const pool = await getPool();
      const { timer, followTimer, ...rest } = s;
      await pool.query(
        'INSERT INTO tpe_news_schedules (id, data) VALUES (?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data)',
        [key, JSON.stringify(rest)],
      );
    } catch (e: any) {
      console.error('[News:srv] persist error:', e?.message || e);
    }
  })();
}

function forget(key: string): void {
  if (!PERSIST) return;
  (async () => {
    try {
      const pool = await getPool();
      await pool.query('DELETE FROM tpe_news_schedules WHERE id = ?', [key]);
    } catch (e: any) {
      console.error('[News:srv] delete error:', e?.message || e);
    }
  })();
}

// ── Execution ──
async function fire(key: string): Promise<void> {
  const s = schedules.get(key);
  if (!s || s.status !== 'armed') return;

  // Never fire early. setTimeout caps at ~24.8 days, so a long-dated schedule
  // reaches this function at the cap instead of at its moment; re-arm and wait.
  const early = s.fireAt - Date.now();
  if (early > 1_000) {
    arm(key, s);
    return;
  }

  // A release is a coin toss. Nothing here reads the figure, the forecast or
  // the previous print, because none of that predicts the first move: the spike
  // is a scramble for liquidity, not a considered response. So the side is drawn
  // at random, once, and the whole batch goes on together in that direction.
  //
  // Drawn HERE rather than when the trade was armed, so it does not exist to be
  // read, shown, or second-guessed before the order is sent.
  const direction: NewsDirection = Math.random() < 0.5 ? 'Buy' : 'Sell';
  s.direction = direction;

  // The line the follow-up judges against. Read before the orders go on, so it
  // is a pre-release price and not one already moved by our own fills.
  s.refPrice = (await midPrice(s.uuid, s.symbol))?.mid ?? null;

  const comment = `News: ${s.eventTitle}`.slice(0, 31); // brokers truncate hard
  const { tickets, rejections } = await sendBatch(key, s, direction, comment);
  const rejection = rejections[0] || '';

  s.tickets = tickets;
  s.timer = null;
  if (tickets.length > 0) {
    s.status = 'fired';
    s.message = `Opened ${tickets.length}/${s.count} ${direction} ${s.symbol}`;
    // A partial fill is not a success. Say which orders did not make it and why.
    if (rejections.length > 0) s.message += ` (${rejections.length} rejected: ${rejection})`;
  } else {
    s.status = 'failed';
    s.message = rejection || 'No orders were accepted';
  }
  console.log(`[News:srv] ${key} ${s.status}: ${s.message}`);

  // Only ride a move we can actually measure, and only if we got on at all.
  if (s.status === 'fired' && s.refPrice !== null) {
    const wait = Math.max(0, s.followAt - Date.now());
    s.followTimer = setTimeout(() => { void followUp(key); }, wait);
    console.log(`[News:srv] ${key} follow-up in ~${Math.round(wait / 1000)}s`);
  } else if (s.status === 'fired') {
    console.error(`[News:srv] ${key} no reference price — follow-up SKIPPED`);
  }
  persist(key, s);
}

/**
 * Send `count` orders one after another, reporting what came back.
 *
 * Deliberately sequential. Promise.all fired the whole batch simultaneously,
 * and the broker refused most of it. Rejections are collected rather than
 * swallowed, so the reason reaches the screen instead of dying in a log.
 */
async function sendBatch(
  key: string,
  s: NewsSchedule,
  operation: NewsDirection,
  comment: string,
): Promise<{ tickets: number[]; rejections: string[] }> {
  const tickets: number[] = [];
  const rejections: string[] = [];

  for (let i = 0; i < s.count; i++) {
    if (i > 0) await sleep(ORDER_GAP_MS);
    try {
      const o: any = await orderSend({
        id: s.uuid,
        symbol: s.symbol,
        operation,
        volume: s.volume,
        comment,
      });
      if (o && typeof o.ticket === 'number' && o.ticket > 0) tickets.push(o.ticket);
      else rejections.push(String(o?.error || o?.message || 'no ticket returned'));
    } catch (e: any) {
      rejections.push(String(e?.message || e));
    }
  }

  if (rejections.length > 0) {
    const why = Array.from(new Set(rejections)).join(' | ');
    console.error(`[News:srv] ${key} ${rejections.length}/${s.count} rejected: ${why}`);
  }
  return { tickets, rejections };
}

/** Mid and spread, or null when the quote cannot be read. */
async function midPrice(uuid: string, symbol: string): Promise<{ mid: number; spread: number } | null> {
  try {
    const q: any = await getQuote(uuid, symbol);
    const bid = Number(q?.bid);
    const ask = Number(q?.ask);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0) {
      return { mid: (bid + ask) / 2, spread: Math.abs(ask - bid) };
    }
    const last = Number(q?.last);
    return Number.isFinite(last) && last > 0 ? { mid: last, spread: 0 } : null;
  } catch (e: any) {
    console.error(`[News:srv] quote error for ${symbol}:`, e?.message || e);
    return null;
  }
}

/**
 * Add to the move the release actually produced.
 *
 * Same size as the first batch, in whichever direction price has gone since it
 * went on. Fails closed twice over: an unreadable quote adds nothing, and a
 * price that has not moved at all adds nothing either, because a flat tape is
 * not a direction and guessing on one is just a second coin toss.
 */
async function followUp(key: string): Promise<void> {
  const s = schedules.get(key);
  if (!s || s.status !== 'fired' || s.refPrice === null) return;
  s.followTimer = null;

  const q = await midPrice(s.uuid, s.symbol);
  if (q === null) {
    s.message += ' · follow-up skipped, no quote';
    console.error(`[News:srv] ${key} follow-up SKIPPED — quote unreadable`);
    persist(key, s);
    return;
  }

  // A move smaller than the spread is not a move, it is the spread. Gold
  // drifting six cents inside a thirty cent spread is noise, and adding to
  // noise is just a second coin toss wearing a costume. The threshold scales
  // itself: every instrument is judged against its own current spread.
  const moved = q.mid - s.refPrice;
  const floor = q.spread > 0 ? q.spread : 0;
  if (Math.abs(moved) <= floor) {
    s.message += ' · follow-up skipped, move within the spread';
    console.log(
      `[News:srv] ${key} follow-up skipped — moved ${moved.toFixed(5)} ` +
      `inside a spread of ${floor.toFixed(5)}`,
    );
    persist(key, s);
    return;
  }

  const dir: NewsDirection = moved > 0 ? 'Buy' : 'Sell';
  s.followDirection = dir;

  const comment = `News+: ${s.eventTitle}`.slice(0, 31);
  const { tickets, rejections } = await sendBatch(key, s, dir, comment);

  s.followTickets = tickets;
  s.message += ` · followed ${dir} x${tickets.length}/${s.count}`;
  if (rejections.length > 0) s.message += ` (${rejections.length} rejected: ${rejections[0]})`;
  console.log(`[News:srv] ${key} follow-up: ${dir} x${tickets.length}/${s.count} (moved from ${s.refPrice} to ${q.mid})`);
  persist(key, s);
}

function arm(key: string, s: NewsSchedule): void {
  const delay = Math.min(Math.max(0, s.fireAt - Date.now()), MAX_TIMEOUT_MS);
  s.timer = setTimeout(() => { void fire(key); }, delay);
}

// ── Public API ──
export function scheduleNews(params: {
  uuid: string;
  eventId: string;
  eventTitle: string;
  currency: string;
  symbol: string;
  volume: number;
  count: number;
  leadSeconds: number;
  eventAt: number;
  followSeconds?: number;
}): { key: string; schedule: Omit<NewsSchedule, 'timer' | 'followTimer'> } {
  const key = scheduleKey(params.uuid, params.eventId, params.symbol);

  // Re-arming the same event+symbol replaces the old one rather than stacking.
  const existing = schedules.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  if (existing?.followTimer) clearTimeout(existing.followTimer);

  const s: NewsSchedule = {
    ...params,
    fireAt: params.eventAt - params.leadSeconds * 1000,
    status: 'armed',
    tickets: [],
    message: '',
    timer: null,
    direction: null,
    refPrice: null,
    followAt: params.eventAt + Math.max(
      MIN_FOLLOW_MS,
      Number.isFinite(params.followSeconds as number)
        ? (params.followSeconds as number) * 1000
        : FOLLOW_MS,
    ),
    followDirection: null,
    followTickets: [],
    followTimer: null,
  };

  schedules.set(key, s);
  arm(key, s);
  persist(key, s);

  const mins = Math.round((s.fireAt - Date.now()) / 60000);
  console.log(
    `[News:srv] armed ${key}: ${s.symbol} x${s.count} @ ${s.volume}, ` +
    `${s.leadSeconds}s before "${s.eventTitle}" (fires in ~${mins}m)`,
  );

  const { timer, followTimer, ...rest } = s;
  return { key, schedule: rest };
}

export function cancelNews(uuid: string, eventId: string, symbol: string): boolean {
  const key = scheduleKey(uuid, eventId, symbol);
  const s = schedules.get(key);
  if (!s) return false;
  if (s.timer) clearTimeout(s.timer);
  if (s.followTimer) clearTimeout(s.followTimer);
  s.timer = null;
  s.followTimer = null;
  s.status = 'cancelled';
  schedules.delete(key);
  forget(key);
  console.log(`[News:srv] cancelled ${key}`);
  return true;
}

/** Everything armed or recently resolved for one account. */
export function listNews(uuid: string): Omit<NewsSchedule, 'timer' | 'followTimer'>[] {
  const out: Omit<NewsSchedule, 'timer' | 'followTimer'>[] = [];
  for (const [, s] of schedules) {
    if (s.uuid !== uuid) continue;
    const { timer, followTimer, ...rest } = s;
    out.push(rest);
  }
  return out.sort((a, b) => a.fireAt - b.fireAt);
}

export async function resumeNews(): Promise<void> {
  if (!PERSIST) {
    console.log('[News:srv] resume disabled (not production). Skipping');
    return;
  }
  try {
    await ensureTable();
    const pool = await getPool();
    const [rows]: any = await pool.query('SELECT id, data FROM tpe_news_schedules');
    let restored = 0;
    for (const row of rows || []) {
      try {
        const parsed = JSON.parse(row.data);
        if (parsed.status !== 'armed') continue;
        // A moment that passed while the server was down. Inside the grace
        // window the move is still the same one, so take it. Beyond that,
        // record it as MISSED rather than deleting it: a schedule that
        // vanished without trace is indistinguishable from one that was
        // never armed, and that is exactly the question you ask afterwards.
        const late = Date.now() - parsed.fireAt;
        if (late > LATE_GRACE_MS) {
          const missed: NewsSchedule = {
            ...parsed,
            timer: null,
            followTimer: null,
            status: 'missed',
            message: `Missed: the server was not running at ${new Date(parsed.fireAt).toISOString()}`,
          };
          schedules.set(row.id, missed);
          persist(row.id, missed);
          console.error(`[News:srv] MISSED ${row.id} — ${Math.round(late / 1000)}s late, nothing opened`);
          continue;
        }
        const s: NewsSchedule = { ...parsed, timer: null };
        schedules.set(row.id, s);
        arm(row.id, s);
        restored += 1;
      } catch {}
    }
    console.log(`[News:srv] resumed ${restored} armed schedule(s)`);
  } catch (e: any) {
    console.error('[News:srv] resume error:', e?.message || e);
  }
}
