import { getPool } from '@/app/api/_db';

/**
 * Order journal.
 *
 * The failure this exists for: OrderSend times out, but the order still filled
 * at the broker. The response never arrives, so nothing records the ticket, and
 * the position is invisible to the engine that opened it — until the next
 * direction change lands the opposite side on top of it.
 *
 * So intent is written BEFORE the call, not after. Every order carries a short
 * tag in its MT5 comment, which makes an orphan identifiable: read OpenedOrders,
 * match the tag, resolve the row. A lost response becomes a row marked
 * `unknown` that reconciliation can settle, instead of a silent position.
 *
 * Best-effort by design — if the database is down the engine still trades,
 * because refusing to trade on a logging failure is its own kind of outage.
 * Journalling is gated to production for the same reason persistence is.
 */
const ENABLED = process.env.RENDER === 'true' || process.env.STRATEGY_PERSIST === '1';

export type OrderState = 'intended' | 'filled' | 'rejected' | 'unknown' | 'closed';

let ready = false;

async function ensureTable(): Promise<void> {
  if (ready) return;
  const pool = await getPool();
  await pool.query(
    `CREATE TABLE IF NOT EXISTS tp_mt5_order_journal (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      client_key VARCHAR(64) NOT NULL UNIQUE,
      uuid VARCHAR(80) NOT NULL,
      symbol VARCHAR(40) NOT NULL,
      side VARCHAR(8) NOT NULL,
      volume DECIMAL(12,4) NOT NULL,
      tag VARCHAR(40) NOT NULL,
      state VARCHAR(16) NOT NULL,
      ticket BIGINT NULL,
      open_price DECIMAL(18,6) NULL,
      note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_uuid_state (uuid, state),
      INDEX idx_tag (tag)
    )`,
  );
  ready = true;
}

/**
 * MT5 truncates order comments at 31 characters, so the tag has to be short
 * AND still identify the run. `<ea>#<run><seq>` keeps the robot name visible
 * (the platform rule) while remaining matchable.
 */
export function buildTag(eaName: string, runId: string, seq: number): string {
  const suffix = `#${runId}${seq}`;
  const room = 31 - suffix.length;
  return `${(eaName || 'Robot').slice(0, Math.max(1, room))}${suffix}`;
}

/** Short, collision-resistant enough for one account's concurrent runs. */
export function newRunId(seed: number): string {
  return seed.toString(36).slice(-4);
}

export async function recordIntent(
  uuid: string,
  clientKey: string,
  symbol: string,
  side: string,
  volume: number,
  tag: string,
): Promise<void> {
  if (!ENABLED) return;
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.query(
      `INSERT INTO tp_mt5_order_journal (client_key, uuid, symbol, side, volume, tag, state)
       VALUES (?, ?, ?, ?, ?, ?, 'intended')
       ON DUPLICATE KEY UPDATE state = state`,
      [clientKey, uuid, symbol, side, volume, tag],
    );
  } catch (e: any) {
    console.error('[Journal] recordIntent:', e?.message || e);
  }
}

export async function settle(
  clientKey: string,
  state: OrderState,
  ticket?: number | null,
  openPrice?: number | null,
  note?: string,
): Promise<void> {
  if (!ENABLED) return;
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.query(
      `UPDATE tp_mt5_order_journal
       SET state = ?, ticket = COALESCE(?, ticket), open_price = COALESCE(?, open_price), note = COALESCE(?, note)
       WHERE client_key = ?`,
      [state, ticket ?? null, openPrice ?? null, note ?? null, clientKey],
    );
  } catch (e: any) {
    console.error('[Journal] settle:', e?.message || e);
  }
}

/** Rows we sent but never got an answer for — candidates for reconciliation. */
export async function unresolved(uuid: string): Promise<Array<{ client_key: string; tag: string }>> {
  if (!ENABLED) return [];
  try {
    await ensureTable();
    const pool = await getPool();
    const [rows]: any = await pool.query(
      `SELECT client_key, tag FROM tp_mt5_order_journal
       WHERE uuid = ? AND state = 'unknown'`,
      [uuid],
    );
    return Array.isArray(rows) ? rows : [];
  } catch (e: any) {
    console.error('[Journal] unresolved:', e?.message || e);
    return [];
  }
}

export async function markClosed(tickets: number[]): Promise<void> {
  if (!ENABLED || !tickets.length) return;
  try {
    await ensureTable();
    const pool = await getPool();
    await pool.query(
      `UPDATE tp_mt5_order_journal SET state = 'closed' WHERE ticket IN (${tickets.map(() => '?').join(',')})`,
      tickets,
    );
  } catch (e: any) {
    console.error('[Journal] markClosed:', e?.message || e);
  }
}
