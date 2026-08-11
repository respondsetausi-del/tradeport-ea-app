import { test, expect } from 'bun:test';
import {
  decimalsOf, stopPrice, targetPrice, trailTo,
  realisedSince, consecutiveLosses, isWeekendFlat,
} from '../app/api/mt5/strategy/risk';

test('decimalsOf takes the broker at its word', () => {
  expect(decimalsOf(4398.87, 4398.9)).toBe(2);   // gold
  expect(decimalsOf(1.23456)).toBe(5);           // FX major
  expect(decimalsOf(29573, 29572.9)).toBe(1);    // index
  expect(decimalsOf(null, undefined, NaN)).toBe(0);
});

test('stop sits the wrong side of entry by mult x ATR', () => {
  expect(stopPrice(4400, 2, 'Buy', 1.5, 2)).toBe(4397);
  expect(stopPrice(4400, 2, 'Sell', 1.5, 2)).toBe(4403);
});

test('target is optional', () => {
  expect(targetPrice(4400, 2, 'Buy', 2.5, 2)).toBe(4405);
  expect(targetPrice(4400, 2, 'Buy', 0, 2)).toBeNull();
});

test('trailing does not start until the trade is far enough in profit', () => {
  // +1.0 ATR of profit needed; this is only +0.5
  expect(trailTo(4400, 4401, 2, 'Buy', null, 1.0, 1.0, 2)).toBeNull();
});

test('trailing engages once in profit', () => {
  const stop = trailTo(4400, 4404, 2, 'Buy', null, 1.0, 1.0, 2);
  expect(stop).toBe(4402);
});

test('a trailing stop NEVER moves backwards', () => {
  // price retraced; candidate stop (4402) is worse than the stop we already have
  expect(trailTo(4400, 4404, 2, 'Buy', 4403, 1.0, 1.0, 2)).toBeNull();
  // and the mirror case for a short
  expect(trailTo(4400, 4396, 2, 'Sell', 4397, 1.0, 1.0, 2)).toBeNull();
});

test('trailing never moves the stop to the losing side of entry', () => {
  // barely in profit with a wide trail — the candidate would sit below entry
  expect(trailTo(4400, 4406, 2, 'Buy', null, 1.0, 4.0, 2)).toBeNull();
});

test('realisedSince counts profit, swap and commission from today only', () => {
  const closed = [
    { closeTime: '2026-08-10T23:00:00', profit: 500 },                       // yesterday, ignored
    { closeTime: '2026-08-11T01:00:00', profit: -100, swap: -5, commission: -2 },
    { closeTime: '2026-08-11T02:00:00', profit: 30 },
  ];
  const since = new Date('2026-08-11T00:00:00Z');
  expect(realisedSince(closed, since)).toBeCloseTo(-77, 6);
});

test('realisedSince ignores rows with no close time', () => {
  expect(realisedSince([{ profit: -999 }], new Date('2026-08-11T00:00:00Z'))).toBe(0);
});

test('consecutiveLosses counts the streak at the end, not the total', () => {
  const closed = [
    { closeTime: '2026-08-11T01:00:00', profit: -10 },
    { closeTime: '2026-08-11T02:00:00', profit: 50 },   // breaks the streak
    { closeTime: '2026-08-11T03:00:00', profit: -10 },
    { closeTime: '2026-08-11T04:00:00', profit: -10 },
  ];
  expect(consecutiveLosses(closed)).toBe(2);
});

test('weekend flat: Friday evening, Saturday and Sunday', () => {
  expect(isWeekendFlat('2026-08-14T19:00:00Z', 20)).toBe(false); // Fri, before cutoff
  expect(isWeekendFlat('2026-08-14T20:00:00Z', 20)).toBe(true);  // Fri, at cutoff
  expect(isWeekendFlat('2026-08-15T10:00:00Z', 20)).toBe(true);  // Sat
  expect(isWeekendFlat('2026-08-16T10:00:00Z', 20)).toBe(true);  // Sun
  expect(isWeekendFlat('2026-08-11T10:00:00Z', 20)).toBe(false); // Tue
});

test('weekend flat is off when the hour is 0', () => {
  expect(isWeekendFlat('2026-08-15T10:00:00Z', 0)).toBe(false);
});
