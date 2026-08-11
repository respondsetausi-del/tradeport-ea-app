// Risk maths. Pure functions, no I/O — this decides where money stops being
// lost, so it must be testable without touching a broker.
import type { Direction } from './indicators';

/**
 * Price decimals for a symbol, inferred from prices the broker actually sent.
 * Gold quotes 2, FX majors 5, indices 1-2. Sending a stop with more precision
 * than the symbol allows gets the modify rejected, so this is not cosmetic.
 */
export function decimalsOf(...prices: Array<number | null | undefined>): number {
  let max = 0;
  for (const p of prices) {
    if (p === null || p === undefined || !isFinite(p)) continue;
    const s = String(p);
    const dot = s.indexOf('.');
    if (dot >= 0) max = Math.max(max, s.length - dot - 1);
  }
  return Math.min(8, max);
}

export function round(price: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(price * f) / f;
}

/** Protective stop: `mult` x ATR the wrong side of entry. */
export function stopPrice(entry: number, atr: number, dir: Direction, mult: number, decimals: number): number {
  const distance = atr * mult;
  return round(dir === 'Buy' ? entry - distance : entry + distance, decimals);
}

/** Target, or null when take-profit is disabled (mult <= 0). */
export function targetPrice(entry: number, atr: number, dir: Direction, mult: number, decimals: number): number | null {
  if (!mult || mult <= 0) return null;
  const distance = atr * mult;
  return round(dir === 'Buy' ? entry + distance : entry - distance, decimals);
}

/**
 * Where the trailing stop should sit, or null to leave it alone.
 *
 * Trailing only starts once the trade is `startMult` x ATR in profit, and the
 * stop only ever moves in the favourable direction — a stop that can retreat
 * is not a stop.
 */
export function trailTo(
  entry: number,
  current: number,
  atr: number,
  dir: Direction,
  currentStop: number | null,
  startMult: number,
  trailMult: number,
  decimals: number,
): number | null {
  if (!(atr > 0) || trailMult <= 0) return null;

  const profit = dir === 'Buy' ? current - entry : entry - current;
  if (profit < atr * startMult) return null;

  const candidate = round(dir === 'Buy' ? current - atr * trailMult : current + atr * trailMult, decimals);

  if (currentStop !== null && isFinite(currentStop)) {
    const better = dir === 'Buy' ? candidate > currentStop : candidate < currentStop;
    if (!better) return null;
  }
  // Never trail to the losing side of entry.
  const beyondEntry = dir === 'Buy' ? candidate < entry : candidate > entry;
  if (beyondEntry) return null;

  return candidate;
}

export interface ClosedTrade {
  closeTime?: string;
  profit?: number;
  swap?: number;
  commission?: number;
}

const net = (t: ClosedTrade) => (t.profit || 0) + (t.swap || 0) + (t.commission || 0);

/**
 * Realised P/L since `since`. Account-wide on purpose: a loss cap that only
 * counts one symbol isn't protecting the account.
 */
export function realisedSince(closed: ClosedTrade[], since: Date): number {
  let total = 0;
  for (const t of closed) {
    if (!t.closeTime) continue;
    const at = new Date(t.closeTime);
    if (isNaN(at.getTime()) || at < since) continue;
    total += net(t);
  }
  return total;
}

/** Losing trades at the end of the history, newest last. */
export function consecutiveLosses(closed: ClosedTrade[]): number {
  const sorted = [...closed]
    .filter((t) => t.closeTime)
    .sort((a, b) => String(a.closeTime).localeCompare(String(b.closeTime)));
  let n = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (net(sorted[i]) < 0) n += 1;
    else break;
  }
  return n;
}

/**
 * Should we be flat for the weekend?
 *
 * `barTime` is broker server time (from the candles), not this machine's clock
 * — the server runs in UTC and the broker may not.
 */
export function isWeekendFlat(barTime: string, fridayHour: number): boolean {
  if (!fridayHour || fridayHour <= 0) return false;
  const t = new Date(barTime);
  if (isNaN(t.getTime())) return false;
  const day = t.getUTCDay(); // 5 = Fri, 6 = Sat, 0 = Sun
  if (day === 6 || day === 0) return true;
  return day === 5 && t.getUTCHours() >= fridayHour;
}
