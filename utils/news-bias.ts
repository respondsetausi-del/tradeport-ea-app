/**
 * Turn a calendar release into a trade direction and a position weight.
 *
 * READ THIS BEFORE TRUSTING IT
 * ----------------------------
 * We enter BEFORE the release, so the actual number does not exist yet. The
 * only bias available is forecast vs previous, and the market has largely
 * priced that in already. This is a systematic way to express a lean, not an
 * information edge, and it will be wrong often. The weight is scaled down
 * accordingly rather than sized as if this were a real signal.
 *
 * Three things have to line up to get a direction:
 *
 *   1. Does the number rising mean a STRONGER currency, or a weaker one?
 *      Higher CPI is hawkish (strong). Higher unemployment is dovish (weak).
 *      That polarity is per indicator, not universal.
 *   2. Is the forecast above or below the previous print?
 *   3. Is the event's currency the BASE or the QUOTE of the pair being traded?
 *      A hawkish EUR read is BUY on EURUSD but SELL on USDEUR-style quoting,
 *      and irrelevant on a pair the currency does not appear in.
 */

import type { CalendarEvent } from '@/services/api';

export type BiasDirection = 'Buy' | 'Sell';

export interface NewsBias {
  direction: BiasDirection | null;
  /** 0-1. Drives the weight, and how loudly the UI should claim anything. */
  confidence: number;
  /** Multiplier applied to the base lot. */
  weight: number;
  /** Plain-language reason, shown to the user before they arm. */
  rationale: string;
  /** 'hawkish' = the release implies a stronger currency. */
  lean: 'hawkish' | 'dovish' | null;
}

/**
 * Indicators where a HIGHER number means a WEAKER currency.
 *
 * Everything else is assumed higher-is-stronger, which holds for growth,
 * inflation, sentiment and employment levels.
 */
const INVERTED = [
  'unemployment rate',
  'unemployment change',
  'jobless claims',
  'continuing claims',
  'trade deficit',
  'inventories',
  'foreclosure',
  'delinquen',
  'bankrupt',
  'misery',
];

/** Releases with no number to compare, so no lean can be derived. */
const NON_NUMERIC = ['speaks', 'meetings', 'holiday', 'summit', 'testimony', 'press conference'];

/** Parses "3.2%", "-0.7%", "1.3M", "56.1" into a number. */
export function parseFigure(raw: string | undefined | null): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[%,]/g, '').trim();
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT])?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  return m[2] ? n * mult[m[2].toUpperCase()] : n;
}

/** Where the event's currency sits in the pair, if at all. */
export function currencyRole(symbol: string, currency: string): 'base' | 'quote' | null {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  const c = currency.toUpperCase();
  if (!c || c === 'ALL' || s.length < 6) return null;
  if (s.startsWith(c)) return 'base';
  // Only treat it as the quote when it sits in the second slot, so USDCHF for
  // a USD event is 'base', not a false 'quote' match on a substring.
  if (s.slice(3, 6) === c) return 'quote';
  return null;
}

const IMPACT_WEIGHT: Record<CalendarEvent['impact'], number> = {
  High: 1,
  Medium: 0.6,
  Low: 0.3,
  Holiday: 0,
};

export function computeBias(event: CalendarEvent, symbol: string): NewsBias {
  const title = (event.title || '').toLowerCase();
  const none = (rationale: string): NewsBias => ({
    direction: null, confidence: 0, weight: 0, rationale, lean: null,
  });

  if (NON_NUMERIC.some((k) => title.includes(k))) {
    return none('No figure to read — this release is commentary, not a number.');
  }

  const forecast = parseFigure(event.forecast);
  const previous = parseFigure(event.previous);
  if (forecast === null || previous === null) {
    return none('No forecast and previous to compare, so there is no lean to take.');
  }

  const role = currencyRole(symbol, event.currency);
  if (!role) {
    return none(`${event.currency || 'This currency'} does not appear in ${symbol}, so the release does not point either way for it.`);
  }

  const inverted = INVERTED.some((k) => title.includes(k));
  const diff = forecast - previous;
  if (diff === 0) {
    return none('Forecast matches previous, so there is no directional lean.');
  }

  // Rising number → stronger currency, unless this is an inverted indicator.
  const strongerCurrency = inverted ? diff < 0 : diff > 0;
  const lean: 'hawkish' | 'dovish' = strongerCurrency ? 'hawkish' : 'dovish';

  // A stronger BASE currency lifts the pair; a stronger QUOTE currency sinks it.
  const direction: BiasDirection =
    role === 'base'
      ? (strongerCurrency ? 'Buy' : 'Sell')
      : (strongerCurrency ? 'Sell' : 'Buy');

  // Confidence from the size of the expected move relative to the previous
  // print, capped hard: a big percentage gap on a tiny base is not conviction.
  const base = Math.abs(previous) || Math.abs(forecast) || 1;
  const relative = Math.min(Math.abs(diff) / base, 1);
  const impact = IMPACT_WEIGHT[event.impact] ?? 0.3;
  const confidence = Math.min(0.15 + relative * 0.5, 0.65) * impact;

  // Weight stays deliberately conservative. Full size on a pre-release lean
  // would be sizing a coin flip like a signal.
  const weight = Math.max(0.25, Math.min(confidence * 1.5, 1));

  const move = inverted
    ? `${event.forecast} vs ${event.previous} previous (lower is stronger for this one)`
    : `${event.forecast} vs ${event.previous} previous`;

  return {
    direction,
    confidence,
    weight,
    lean,
    rationale:
      `Forecast is ${diff > 0 ? 'above' : 'below'} previous — ${move} — which reads ` +
      `${lean} for ${event.currency}. ${event.currency} is the ${role} of ${symbol}, ` +
      `so that points ${direction.toUpperCase()}.`,
  };
}

/** Lot for a symbol under auto weighting, rounded to a tradable step. */
export function autoLot(baseLot: number, bias: NewsBias): number {
  const raw = baseLot * (bias.weight || 0.25);
  return Math.max(0.01, Math.round(raw * 100) / 100);
}
