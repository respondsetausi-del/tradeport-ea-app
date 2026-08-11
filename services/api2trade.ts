const API2TRADE_BASE = (process.env.API2TRADE_BASE_URL || 'https://mt5.mt4api.dev').replace(/\/$/, '');
const API2TRADE_KEY = process.env.API2TRADE_API_KEY || '';
const API2TRADE_USER = process.env.API2TRADE_USERNAME || '';
const API2TRADE_PASS = process.env.API2TRADE_PASSWORD || '';

const TIMEOUT_MS = 30000;

function getAuthHeaders(): Record<string, string> {
  if (API2TRADE_USER && API2TRADE_PASS) {
    const encoded = Buffer.from(`${API2TRADE_USER}:${API2TRADE_PASS}`).toString('base64');
    return { Authorization: `Basic ${encoded}` };
  }
  if (API2TRADE_KEY) {
    return { 'x-api-key': API2TRADE_KEY };
  }
  throw new Error('Api2Trade credentials not configured');
}

async function api2tradeGet<T = any>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const url = new URL(`${API2TRADE_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { ...getAuthHeaders(), Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Api2Trade ${res.status}: ${body || res.statusText}`);
    }

    return await res.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Account Management ─────────────────────────────────────

export interface ConnectExResult {
  message?: string;
  user?: number;
  [key: string]: unknown;
}

export async function connectEx(
  id: string,
  server: string,
  user: string,
  password: string,
): Promise<ConnectExResult> {
  return api2tradeGet<ConnectExResult>('ConnectEx', { id, server, user, password });
}

export async function disconnect(id: string): Promise<{ message: string }> {
  return api2tradeGet('Disconnect', { id });
}

export async function checkConnect(id: string): Promise<any> {
  return api2tradeGet('CheckConnect', { id });
}

// ── Account Info ────────────────────────────────────────────

export interface AccountSummary {
  balance: number;
  credit: number;
  profit: number;
  equity: number;
  margin: number;
  freeMargin: number;
  marginLevel: number;
  leverage: number;
  currency: string;
}

export async function getAccountSummary(id: string): Promise<AccountSummary> {
  return api2tradeGet<AccountSummary>('AccountSummary', { id });
}

// ── Liveness + Reconnect ────────────────────────────────────
//
// Verify the session behind `id` is live and, if not, silently
// re-establish it under the SAME id from stored credentials.
//
// The probe IS the app's real source of truth: an authenticated
// AccountSummary that returns a real leverage means the broker still
// holds the live MT5 session behind this UUID. If the broker expired
// the session (idle timeout / infra restart), the probe fails and we
// re-authenticate under the same UUID so the client's persisted handle
// stays stable and nothing downstream has to be rewired.
export async function ensureConnected(
  id: string,
  server: string,
  user: string,
  password: string,
): Promise<{ reconnected: boolean }> {
  try {
    const summary = await getAccountSummary(id);
    if (summary?.leverage) return { reconnected: false };
  } catch {
    /* probe failed -> treat as dead, re-establish below */
  }

  // Re-auth under the same id. Tolerate ConnectEx throwing
  // (e.g. "already connected") — the summary re-check is the gate.
  await connectEx(id, server, user, password).catch(() => {});
  const summary = await getAccountSummary(id);
  if (!summary?.leverage) throw new Error('Reconnect failed');
  return { reconnected: true };
}

export interface AccountInfo {
  login: number;
  type: string;
  userName: string;
  country: string;
  balance: number;
  credit: number;
  leverage: number;
  email: string;
}

export async function getAccountInfo(id: string): Promise<AccountInfo> {
  return api2tradeGet<AccountInfo>('Account', { id });
}

// ── Orders ──────────────────────────────────────────────────

export interface Order {
  ticket: number;
  profit: number;
  swap: number;
  commission: number;
  openPrice: number;
  openTime: string;
  closePrice: number;
  closeTime: string;
  lots: number;
  orderType: string;
  symbol: string;
  comment: string;
  stopLoss: number;
  takeProfit: number;
}

export async function getOpenOrders(id: string): Promise<Order[]> {
  return api2tradeGet<Order[]>('OpenedOrders', { id });
}

export async function getClosedOrders(id: string): Promise<Order[]> {
  return api2tradeGet<Order[]>('ClosedOrders', { id });
}

export async function getOpenOrder(id: string, ticket: number): Promise<Order> {
  return api2tradeGet<Order>('OpenedOrder', { id, ticket });
}

// ── Trading ─────────────────────────────────────────────────

export type Operation = 'Buy' | 'Sell' | 'BuyLimit' | 'SellLimit' | 'BuyStop' | 'SellStop';

export interface TradeParams {
  id: string;
  symbol: string;
  operation: Operation;
  volume: number;
  price?: number;
  slippage?: number;
  stoploss?: number;
  takeprofit?: number;
  comment?: string;
}

export async function orderSend(params: TradeParams): Promise<Order> {
  return api2tradeGet<Order>('OrderSend', params as any);
}

export interface ModifyParams {
  id: string;
  ticket: number;
  stoploss: number;
  takeprofit: number;
  price?: number;
}

export async function orderModify(params: ModifyParams): Promise<Order> {
  return api2tradeGet<Order>('OrderModify', params as any);
}

export interface CloseParams {
  id: string;
  ticket: number;
  lots?: number;
  price?: number;
  slippage?: number;
}

export async function orderClose(params: CloseParams): Promise<Order> {
  return api2tradeGet<Order>('OrderClose', params as any);
}

// ── Market Data ─────────────────────────────────────────────

export interface Quote {
  symbol: string;
  bid: number;
  ask: number;
  time: string;
  last: number;
  volume: number;
}

export async function getQuote(id: string, symbol: string): Promise<Quote> {
  return api2tradeGet<Quote>('GetQuote', { id, symbol });
}

export async function getQuoteMany(id: string, symbols: string[]): Promise<Quote[]> {
  const url = new URL(`${API2TRADE_BASE}/GetQuoteMany`);
  url.searchParams.set('id', id);
  for (const s of symbols) url.searchParams.append('symbols', s);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { ...getAuthHeaders(), Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Api2Trade ${res.status}`);
    return await res.json() as Quote[];
  } finally {
    clearTimeout(timeout);
  }
}

export async function getSymbolList(id: string): Promise<string[]> {
  return api2tradeGet<string[]>('SymbolList', { id });
}

export interface Candle {
  time: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  tickVolume?: number;
  spread?: number;
  volume?: number;
}

/**
 * OHLC candles for indicator work.
 *
 * `timeframe` is the bar size in MINUTES as a number (1, 5, 15, 60, 240).
 * Passing MT-style names ("M1", "M15") does NOT error — Api2Trade silently
 * ignores them and returns 4-hour bars starting in 2022, which will quietly
 * feed an indicator the wrong data. Always pass a number.
 *
 * `from`/`to` are ISO datetimes in broker server time; without them you get
 * that same 2022 default window rather than recent bars.
 */
export async function getPriceHistory(
  id: string,
  symbol: string,
  timeframeMinutes: number,
  from: Date,
  to: Date,
): Promise<Candle[]> {
  const iso = (d: Date) => d.toISOString().slice(0, 19);
  return api2tradeGet<Candle[]>('PriceHistory', {
    id,
    symbol,
    timeframe: Math.max(1, Math.round(timeframeMinutes)),
    from: iso(from),
    to: iso(to),
  });
}

export async function getMarketWatch(id: string, symbols: string[]): Promise<any[]> {
  const url = new URL(`${API2TRADE_BASE}/MarketWatchMany`);
  url.searchParams.set('id', id);
  for (const s of symbols) url.searchParams.append('symbols', s);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { ...getAuthHeaders(), Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Api2Trade ${res.status}`);
    return await res.json() as any[];
  } finally {
    clearTimeout(timeout);
  }
}
