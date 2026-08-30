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
import { orderSend } from '@/services/api2trade';
import { getPool } from '@/app/api/_db';

export type NewsDirection = 'Buy' | 'Sell';

export interface NewsSchedule {
  /** Api2Trade session id (the connected account). */
  uuid: string;
  eventId: string;
  eventTitle: string;
  currency: string;
  symbol: string;
  direction: NewsDirection;
  volume: number;
  count: number;
  /** Seconds before the release to fire. */
  leadSeconds: number;
  /** Absolute epoch ms the event is released. */
  eventAt: number;
  /** Absolute epoch ms the order fires (eventAt - leadSeconds). */
  fireAt: number;
  status: 'armed' | 'fired' | 'failed' | 'cancelled';
  tickets: number[];
  message: string;
  timer: ReturnType<typeof setTimeout> | null;
}

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
      const { timer, ...rest } = s;
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

  const comment = `News: ${s.eventTitle}`.slice(0, 31); // brokers truncate hard
  const results: any[] = await Promise.all(
    Array.from({ length: s.count }, () =>
      orderSend({
        id: s.uuid,
        symbol: s.symbol,
        operation: s.direction,
        volume: s.volume,
        comment,
      }).catch((e: any) => {
        console.error(`[News:srv] ${key} order error:`, e?.message || e);
        return null;
      }),
    ),
  );

  const tickets: number[] = [];
  let rejection = '';
  for (const o of results) {
    if (o && typeof o.ticket === 'number' && o.ticket > 0) tickets.push(o.ticket);
    else if (o) rejection = o?.error || o?.message || 'no ticket returned';
  }

  s.tickets = tickets;
  s.timer = null;
  if (tickets.length > 0) {
    s.status = 'fired';
    s.message = `Opened ${tickets.length}/${s.count} ${s.direction} ${s.symbol}`;
  } else {
    s.status = 'failed';
    s.message = rejection || 'No orders were accepted';
  }
  console.log(`[News:srv] ${key} ${s.status}: ${s.message}`);
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
  direction: NewsDirection;
  volume: number;
  count: number;
  leadSeconds: number;
  eventAt: number;
}): { key: string; schedule: Omit<NewsSchedule, 'timer'> } {
  const key = scheduleKey(params.uuid, params.eventId, params.symbol);

  // Re-arming the same event+symbol replaces the old one rather than stacking.
  const existing = schedules.get(key);
  if (existing?.timer) clearTimeout(existing.timer);

  const s: NewsSchedule = {
    ...params,
    fireAt: params.eventAt - params.leadSeconds * 1000,
    status: 'armed',
    tickets: [],
    message: '',
    timer: null,
  };

  schedules.set(key, s);
  arm(key, s);
  persist(key, s);

  const mins = Math.round((s.fireAt - Date.now()) / 60000);
  console.log(
    `[News:srv] armed ${key}: ${s.direction} ${s.symbol} x${s.count} @ ${s.volume}, ` +
    `${s.leadSeconds}s before "${s.eventTitle}" (fires in ~${mins}m)`,
  );

  const { timer, ...rest } = s;
  return { key, schedule: rest };
}

export function cancelNews(uuid: string, eventId: string, symbol: string): boolean {
  const key = scheduleKey(uuid, eventId, symbol);
  const s = schedules.get(key);
  if (!s) return false;
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.status = 'cancelled';
  schedules.delete(key);
  forget(key);
  console.log(`[News:srv] cancelled ${key}`);
  return true;
}

/** Everything armed or recently resolved for one account. */
export function listNews(uuid: string): Omit<NewsSchedule, 'timer'>[] {
  const out: Omit<NewsSchedule, 'timer'>[] = [];
  for (const [, s] of schedules) {
    if (s.uuid !== uuid) continue;
    const { timer, ...rest } = s;
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
        // A release that already passed while the server was down is not worth
        // entering late: the move has happened. Drop it rather than fire blind.
        if (parsed.fireAt <= Date.now()) {
          forget(row.id);
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
