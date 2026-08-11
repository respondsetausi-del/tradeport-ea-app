import { test, expect } from 'bun:test';
import { ema, atr, decide } from '../app/api/mt5/strategy/indicators';

const bar = (i: number, close: number, high?: number, low?: number) => ({
  time: `2026-08-11T00:${String(i).padStart(2, '0')}:00`,
  openPrice: close, closePrice: close,
  highPrice: high ?? close + 0.5,
  lowPrice: low ?? close - 0.5,
});

const cfg = { fast: 3, slow: 6, atrPeriod: 3, atrMult: 0.25, exitMult: 0.125, confirmBars: 1, htfPeriod: 3 };

test('ema seeds on SMA then smooths', () => {
  const v = [1, 2, 3, 4, 5, 6];
  const e = ema(v, 3);
  expect(e[0]).toBeNaN();
  expect(e[1]).toBeNaN();
  expect(e[2]).toBe(2);   // SMA(1,2,3)
  expect(e[3]).toBe(3);   // 4*.5 + 2*.5
  expect(e[4]).toBe(4);
  expect(e[5]).toBe(5);
});

test('ema returns all-NaN when there is not enough data', () => {
  expect(ema([1, 2], 5).every(Number.isNaN)).toBe(true);
});

test('atr on a constant-range series equals that range', () => {
  // every bar spans exactly 2.0 and closes mid-range, so TR is 2.0 throughout
  const c = Array.from({ length: 10 }, (_, i) => bar(i, 100, 101, 99));
  const a = atr(c, 3);
  expect(a[3]).toBeCloseTo(2, 6);
  expect(a[9]).toBeCloseTo(2, 6);
});

test('decide: refuses when there is not enough history', () => {
  const c = Array.from({ length: 4 }, (_, i) => bar(i, 100));
  const s = decide(c, c, cfg);
  expect(s.dir).toBeNull();
  expect(s.reason).toContain('closed bars');
});

test('decide: flat market gives no signal (separation gate)', () => {
  const c = Array.from({ length: 30 }, (_, i) => bar(i, 100));
  const s = decide(c, c, cfg);
  expect(s.dir).toBeNull();
});

test('decide: clean uptrend with aligned HTF gives Buy', () => {
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));
  const s = decide(c, c, cfg);
  expect(s.dir).toBe('Buy');
  expect(s.separation! >= s.required!).toBe(true);
});

test('decide: clean downtrend gives Sell', () => {
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 200 - i * 2));
  const s = decide(c, c, cfg);
  expect(s.dir).toBe('Sell');
});

test('decide: HTF filter vetoes a Buy when price is below the HTF EMA', () => {
  const up = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));      // fast EMAs say Buy
  const htfHigh = Array.from({ length: 40 }, (_, i) => bar(i, 5000 - i));     // but HTF sits far above
  const s = decide(up, htfHigh, cfg);
  expect(s.dir).toBeNull();
  expect(s.reason).toContain('Buy blocked');
});

// ── signal exits ───────────────────────────────────────────────────────────

test('exit: holding through a dip that would have blocked a fresh entry', () => {
  // Uptrend that flattens: separation ends up BELOW the entry threshold but
  // ABOVE the exit floor. A flat account gets nothing; a held position stays.
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));
  for (let i = 0; i < 10; i++) c.push(bar(40 + i, 178)); // stall into the band

  const flat = decide(c, c, cfg, null);
  const long = decide(c, c, cfg, 'Buy');

  expect(long.action).toBe('hold');
  expect(long.dir).toBe('Buy');
  // the whole point: the same bar does not justify a new entry
  expect(flat.action).toBe('none');
  expect(long.separation! < long.required!).toBe(true);
  expect(long.separation! >= long.exitLevel!).toBe(true);
});

test('exit: separation collapsing below the exit floor closes the position', () => {
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));
  for (let i = 0; i < 25; i++) c.push(bar(40 + i, 178)); // fully flat — EMAs converge

  const s = decide(c, c, cfg, 'Buy');
  expect(s.action).toBe('exit');
  expect(s.reason).toContain('separation collapsed');
});

test('exit: a cross against the position exits even without a valid reversal', () => {
  const up = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));
  const down = Array.from({ length: 20 }, (_, i) => bar(40 + i, 178 - i * 3));
  const c = [...up, ...down];
  // HTF far BELOW price, so a fresh Sell entry is vetoed — but the long must go.
  const htfBelow = Array.from({ length: 40 }, (_, i) => bar(i, 1 + i * 0.01));
  const s = decide(c, htfBelow, cfg, 'Buy');
  expect(s.action).toBe('exit');
  expect(s.reason).toContain('crossed against');
});

test('exit: a cross WITH a valid opposite entry reverses', () => {
  const up = Array.from({ length: 40 }, (_, i) => bar(i, 300 - i));
  const down = Array.from({ length: 25 }, (_, i) => bar(40 + i, 260 - i * 4));
  const c = [...up, ...down];
  const s = decide(c, c, cfg, 'Buy');
  expect(s.action).toBe('reverse');
  expect(s.dir).toBe('Sell');
});

test('exit: HTF turning against the position closes it', () => {
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 100 + i * 2));
  const htfAbove = Array.from({ length: 40 }, (_, i) => bar(i, 9000 + i)); // price now below HTF
  const s = decide(c, htfAbove, cfg, 'Buy');
  expect(s.action).toBe('exit');
  expect(s.reason).toContain('higher timeframe turned');
});

test('decide: a one-bar spike is rejected by confirmation', () => {
  // steady down, then a single bar that briefly crosses the fast EMA up
  const c = Array.from({ length: 40 }, (_, i) => bar(i, 200 - i * 2));
  c.push(bar(40, 400));
  const s = decide(c, c, { ...cfg, confirmBars: 2 });
  expect(s.dir).toBeNull();
});
