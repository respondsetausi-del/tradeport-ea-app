// Pure indicator maths. No I/O, no state — everything here is unit-testable
// and must stay that way, because this is what decides trade direction.
import type { Candle } from '@/services/api2trade';

/** Exponential moving average. Returns NaN for indexes before the seed. */
export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (period <= 0 || values.length < period) return out;

  // Seed with the SMA of the first `period` values, then smooth.
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Wilder's ATR. Uses true range, so it needs the previous close. */
export function atr(candles: Candle[], period: number): number[] {
  const out = new Array<number>(candles.length).fill(NaN);
  if (candles.length < period + 1) return out;

  const tr: number[] = [NaN];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].closePrice;
    tr.push(Math.max(
      c.highPrice - c.lowPrice,
      Math.abs(c.highPrice - prevClose),
      Math.abs(c.lowPrice - prevClose),
    ));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

export type Direction = 'Buy' | 'Sell';

export interface SignalConfig {
  fast: number;        // fast EMA period
  slow: number;        // slow EMA period
  atrPeriod: number;
  atrMult: number;     // separation required to ENTER, as a multiple of ATR
  exitMult: number;    // separation required to STAY IN. Must be < atrMult
  confirmBars: number; // bars the direction must persist before entering
  htfPeriod: number;   // higher-timeframe EMA period (trend filter)
}

/**
 * What to do about the position, not just which way the market leans.
 *  enter   — flat now, open `dir`
 *  hold    — already in `dir`, leave it alone
 *  exit    — in a position that no longer qualifies, close to flat
 *  reverse — the opposite direction now qualifies to enter: close, then open `dir`
 *  none    — flat and nothing worth taking
 */
export type Action = 'enter' | 'hold' | 'exit' | 'reverse' | 'none';

export interface Signal {
  dir: Direction | null;
  /**
   * The bare EMA lean, with every veto ignored. `dir` is what qualifies to
   * trade; `raw` is merely which way the lines point. Used only by the
   * grace-window fallback so an entry still follows the market rather than a
   * coin flip. Null before the indicators have warmed up.
   */
  raw: Direction | null;
  action: Action;
  reason: string;
  fast: number | null;
  slow: number | null;
  atr: number | null;
  separation: number | null;
  required: number | null;   // entry threshold
  exitLevel: number | null;  // exit threshold (hysteresis floor)
  htf: number | null;
  bar: string | null;
}

const nul = (reason: string, extra: Partial<Signal> = {}): Signal => ({
  dir: null, raw: null, action: 'none', reason, fast: null, slow: null, atr: null,
  separation: null, required: null, exitLevel: null, htf: null, bar: null, ...extra,
});

/**
 * Decide what to do about the position, from CLOSED candles only.
 *
 * ENTRY is deliberately strict — three gates, any of which vetoes:
 *   1. EMA cross      — fast above slow = Buy, below = Sell
 *   2. Separation     — |fast - slow| must exceed atrMult x ATR, so the braided
 *                       lines of a range don't produce a signal every other bar
 *   3. HTF trend      — longs only above the higher-timeframe EMA, shorts below
 *   + confirmation    — the direction must have held for `confirmBars` bars
 *
 * EXIT is deliberately looser, and that asymmetry is the point. If the same
 * threshold governed both, a position sitting near the boundary would close and
 * reopen on ordinary noise — we watched exactly that happen live, exiting on a
 * separation of 0.143 against a required 0.145 and re-entering two bars later,
 * paying the spread twice for nothing.
 *
 * So once in a position it is kept until something real happens:
 *   - the EMAs actually CROSS against it, or
 *   - separation collapses below exitMult x ATR (a fraction of the entry bar), or
 *   - the higher timeframe turns against it.
 *
 * `held` is what the account actually holds — pass null when flat.
 */
export function decide(
  candles: Candle[],
  htfCandles: Candle[],
  cfg: SignalConfig,
  held: Direction | null = null,
): Signal {
  const need = Math.max(cfg.slow, cfg.atrPeriod + 1) + cfg.confirmBars;
  if (candles.length < need) return nul(`need ${need} closed bars, have ${candles.length}`);

  const closes = candles.map((c) => c.closePrice);
  const f = ema(closes, cfg.fast);
  const s = ema(closes, cfg.slow);
  const a = atr(candles, cfg.atrPeriod);

  const i = candles.length - 1;
  const bar = candles[i].time;
  if (!isFinite(f[i]) || !isFinite(s[i]) || !isFinite(a[i])) return nul('indicators not warmed up', { bar });

  const separation = Math.abs(f[i] - s[i]);
  const required = cfg.atrMult * a[i];
  const exitLevel = cfg.exitMult * a[i];
  const price = closes[i];
  const raw: Direction = f[i] > s[i] ? 'Buy' : 'Sell';

  const htfCloses = htfCandles.map((c) => c.closePrice);
  const h = ema(htfCloses, cfg.htfPeriod);
  const hi = htfCandles.length - 1;
  const htf = hi >= 0 && isFinite(h[hi]) ? h[hi] : null;

  const base: Partial<Signal> = {
    fast: f[i], slow: s[i], atr: a[i], separation, required, exitLevel, htf, bar, raw,
  };

  // ── Holding something: apply the LOOSE exit tests ───────────────────────
  if (held) {
    if (raw !== held) {
      // A real cross. Exit now; reversing is judged by the entry gates below.
      const entry = entrySignal();
      if (entry.dir) {
        return { ...entry, action: 'reverse', reason: `reverse to ${entry.dir} — EMAs crossed against ${held}. ${entry.reason}` } as Signal;
      }
      return { ...(base as Signal), dir: null, action: 'exit', reason: `exit ${held} — EMAs crossed against the position` };
    }
    if (separation < exitLevel) {
      return { ...(base as Signal), dir: null, action: 'exit', reason: `exit ${held} — separation collapsed (${separation.toFixed(3)} < ${exitLevel.toFixed(3)})` };
    }
    if (htf !== null && ((held === 'Buy' && price < htf) || (held === 'Sell' && price > htf))) {
      return { ...(base as Signal), dir: null, action: 'exit', reason: `exit ${held} — higher timeframe turned against it` };
    }
    return {
      ...(base as Signal), dir: held, action: 'hold',
      reason: `hold ${held} — separation ${separation.toFixed(3)} still above exit floor ${exitLevel.toFixed(3)}`,
    };
  }

  // ── Flat: apply the STRICT entry tests ──────────────────────────────────
  const entry = entrySignal();
  return entry.dir ? { ...entry, action: 'enter' } : entry;

  function entrySignal(): Signal {
    if (separation < required) {
      return nul(`EMAs too close (${separation.toFixed(3)} < ${required.toFixed(3)}) — ranging`, base);
    }
    for (let b = 1; b <= cfg.confirmBars; b++) {
      const j = i - b;
      if (j < 0 || !isFinite(f[j]) || !isFinite(s[j])) return nul('not enough history to confirm', base);
      const prior: Direction = f[j] > s[j] ? 'Buy' : 'Sell';
      if (prior !== raw) return nul(`${raw} not confirmed — flipped ${b} bar(s) ago`, base);
    }
    if (htf === null) return nul('higher-timeframe EMA not available', base);
    if (raw === 'Buy' && price < htf) {
      return nul(`Buy blocked — price ${price.toFixed(2)} below HTF EMA ${htf.toFixed(2)}`, base);
    }
    if (raw === 'Sell' && price > htf) {
      return nul(`Sell blocked — price ${price.toFixed(2)} above HTF EMA ${htf.toFixed(2)}`, base);
    }
    return {
      ...(base as Signal),
      dir: raw,
      action: 'enter',
      reason: `${raw}: EMA${cfg.fast} ${raw === 'Buy' ? '>' : '<'} EMA${cfg.slow} by ${separation.toFixed(3)} (needed ${required.toFixed(3)}), with HTF trend`,
    };
  }
}
