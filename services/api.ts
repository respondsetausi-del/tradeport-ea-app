import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

// Free-App admin site — where we report a successful MT5 connect (login + server
// only, never the password) so the Super Admin can see connected accounts,
// tagged by which app they came from.
const DASHBOARD_API = (process.env.EXPO_PUBLIC_DASHBOARD_URL || 'https://free-app-site.vercel.app').replace(/\/$/, '');

// ── Device Fingerprint ──────────────────────────────────────
const DEVICE_ID_KEY = '@tradeport_device_id';

function generateUUID(): string {
  // Works in both React Native and web contexts
  const hex = '0123456789abcdef';
  let uuid = '';
  for (let i = 0; i < 32; i++) {
    uuid += hex[Math.floor(Math.random() * 16)];
    if (i === 7 || i === 11 || i === 15 || i === 19) uuid += '-';
  }
  return uuid;
}

async function getOrCreateDeviceId(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;

    const deviceId = `${Platform.OS}-${generateUUID()}-${Date.now()}`;
    await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    return deviceId;
  } catch {
    const fallback = `${Platform.OS}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try { await AsyncStorage.setItem(DEVICE_ID_KEY, fallback); } catch {}
    return fallback;
  }
}

// ── Types ───────────────────────────────────────────────────
export interface AuthBody {
  email: string;
  password?: string;
  mentor?: string;
  ref_code?: string;
}

export interface Account {
  id: string;
  email: string;
  status: string;
  paid: boolean;
  used: boolean;
  invalidMentor?: number;
  expired?: boolean;
  expiry_date?: string | null;
  device_mismatch?: boolean;
}

export interface App {
  message: string;
  version: number;
}

export interface Signals {
  signals: Signal[];
}

export interface Signal {
  id: string;
  asset: string;
  action: string;
  price: string;
  tp: string;
  sl: string;
  time: string;
  latestupdate: string;
}

export interface SignalsResponse {
  message: 'accept' | 'error';
  data?: Signal;
}

export interface SignalsListResponse {
  message: 'accept' | 'error';
  data?: Signal[];
}

export interface Symbol {
  id: string;
  name: string;
}

export interface SymbolsResponse {
  message: 'accept' | 'error';
  data?: Symbol[];
}

export interface LicenseAuthBody {
  licence: string;
  phone_secret?: string;
}

export interface Owner {
  name: string;
  email: string;
  phone: string;
  logo: string;
}

export interface LicenseData {
  user: string;
  status: string;
  expires: string;
  key: string;
  phone_secret_key: string;
  ea_name: string;
  ea_notification: string;
  owner: Owner;
}

export interface LicenseAuthResponse {
  message: 'accept' | 'used' | 'error';
  data?: LicenseData;
}

// ── API Service ─────────────────────────────────────────────
class ApiService {
  async authenticate(authBody: AuthBody): Promise<Account> {
    if (!authBody?.email) throw new Error('Email is required');

    // Get device fingerprint
    const deviceId = await getOrCreateDeviceId();

    const endpoint = `${BASE_URL ? `${BASE_URL}` : ''}/api/check-email`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: authBody.email.trim().toLowerCase(),
          mentor: (authBody.mentor || authBody.password || '').toString().trim(),
          ref_code: (authBody.ref_code || '').toString().trim().toUpperCase(),
          device_id: deviceId,
        }),
      });
    } catch (networkError) {
      const hint = BASE_URL
        ? ''
        : ' Set EXPO_PUBLIC_API_BASE_URL to your API host for native builds.';
      throw new Error(`Network error contacting auth service.${hint}`);
    }

    let data: {
      found?: number;
      used?: number;
      paid?: number;
      invalidMentor?: number;
      expired?: number;
      expiry_date?: string | null;
      device_mismatch?: number;
    } = {};
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('Authentication failed');
    }

    const found = Number(data?.found ?? 0) === 1;
    const used = Number(data?.used ?? 0) === 1;
    const paid = Number(data?.paid ?? 0) === 1;
    const invalidMentor = Number(data?.invalidMentor ?? 0);
    const expired = Number(data?.expired ?? 0) === 1;
    const deviceMismatch = Number(data?.device_mismatch ?? 0) === 1;

    return {
      id: authBody.email,
      email: authBody.email,
      status: found ? 'ok' : 'not_found',
      paid,
      used,
      invalidMentor,
      expired,
      expiry_date: data?.expiry_date || null,
      device_mismatch: deviceMismatch,
    };
  }

  async getSignals(phoneSecret: string): Promise<SignalsResponse> {
    void phoneSecret;
    return { message: 'error' };
  }

  async getApp(email: string, use: boolean = false): Promise<App> {
    void use;
    if (!email) {
      return { message: 'none', version: 1 } as unknown as App;
    }
    return { message: 'accept', version: 1 } as unknown as App;
  }

  async getSymbols(phoneSecret: string): Promise<SymbolsResponse> {
    if (!phoneSecret) return { message: 'error' };
    const res = await fetch(`${BASE_URL}/api/symbols?phone_secret=${encodeURIComponent(phoneSecret)}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });
    try {
      const data = (await res.json()) as SymbolsResponse;
      return data;
    } catch {
      return { message: 'error' };
    }
  }

  async authenticateLicense(licenseBody: LicenseAuthBody): Promise<LicenseAuthResponse> {
    if (!licenseBody?.licence) return { message: 'error' };
    const endpoint = `${BASE_URL ? `${BASE_URL}` : ''}/api/auth-license`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(licenseBody),
        signal: controller.signal,
      });
    } catch (networkError) {
      clearTimeout(timeout);
      console.error('License auth network error:', networkError);
      return { message: 'error' };
    }
    clearTimeout(timeout);

    try {
      const data = (await res.json()) as LicenseAuthResponse;
      return data;
    } catch {
      return { message: 'error' };
    }
  }

  // ── Api2Trade MT5 (calls our Bun server; BASE_URL is same-origin on web) ──
  async connectMT5(server: string, login: string, password: string): Promise<{ uuid: string; message: string }> {
    const res = await fetch(`${BASE_URL}/api/mt5/connect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server, login, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Connection failed');
    return data;
  }

  async reconnectMT5(uuid: string, server: string, login: string, password: string): Promise<{ uuid: string; reconnected: boolean }> {
    const res = await fetch(`${BASE_URL}/api/mt5/reconnect`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uuid, server, login, password }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Reconnect failed');
    return data;
  }

  async disconnectMT5(uuid: string): Promise<{ message: string }> {
    const res = await fetch(`${BASE_URL}/api/mt5/connect?id=${encodeURIComponent(uuid)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to disconnect');
    return data;
  }

  async getMT5AccountSummary(uuid: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/account?id=${encodeURIComponent(uuid)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to fetch account');
    return data;
  }

  async getMT5Symbols(uuid: string): Promise<string[]> {
    const res = await fetch(`${BASE_URL}/api/mt5/symbols?id=${encodeURIComponent(uuid)}&action=list`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to fetch symbols');
    return Array.isArray(data) ? data : [];
  }

  async getMT5Quotes(uuid: string, symbols: string[]): Promise<any[]> {
    if (!symbols.length) return [];
    const qs = symbols.map((s) => `symbols=${encodeURIComponent(s)}`).join('&');
    const res = await fetch(`${BASE_URL}/api/mt5/symbols?id=${encodeURIComponent(uuid)}&action=quotes&${qs}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to fetch quotes');
    return Array.isArray(data) ? data : [];
  }

  async sendMT5Trade(params: { id: string; action: 'open' | 'modify' | 'close'; symbol?: string; operation?: string; volume?: number; ticket?: number; lots?: number; comment?: string }): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/trade`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Trade failed');
    return data;
  }

  async startBatch(uuid: string, opts: { symbol: string; volume: number; count: number; intervalMinutes: number; comment?: string }): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/batch/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uuid, ...opts }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to start');
    return data;
  }

  /**
   * Server-side strategy engine — the default robot. Direction comes from the
   * market rather than a timer, and the loop lives on the server so it keeps
   * trading with the app closed.
   *
   * Credentials are sent so the run can revive its own broker session while
   * every device is asleep; without them an expired token halts it until
   * someone reopens the app.
   */
  async startStrategy(
    uuid: string,
    opts: { symbol: string; volume: number; count: number; comment?: string; server?: string; login?: string; password?: string },
  ): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/strategy/start`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uuid, ...opts }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to start');
    return data;
  }

  async stopStrategy(uuid: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/strategy/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uuid }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to stop');
    return data;
  }

  /**
   * Everything that must be true before starting, as a list the UI can show
   * passing or failing. Blockers include "something else is already trading
   * this account", which is invisible from inside either engine.
   */
  async preflight(uuid: string, symbol: string, volume: number): Promise<any> {
    const qs = new URLSearchParams({ id: uuid, symbol, volume: String(volume) });
    const res = await fetch(`${BASE_URL}/api/mt5/strategy/preflight?${qs.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Preflight failed');
    return data;
  }

  /** Public view only — reveals nothing about how direction is decided. */
  async getStrategyStatus(uuid: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/strategy/status?id=${encodeURIComponent(uuid)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to read status');
    return data;
  }

  async stopBatch(uuid: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/batch/stop`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uuid }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to stop');
    return data;
  }

  async getBatchStatus(uuid: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/mt5/batch/status?id=${encodeURIComponent(uuid)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || 'Failed to get status');
    return data;
  }

  // Best-effort report to the Free-App admin site on a successful MT5 connect.
  // Sends the login NUMBER + server only — never the password — tagged with
  // this app so the Super Admin can separate accounts by which app they used.
  async reportMT5Connection(email: string, login: string, server: string): Promise<void> {
    if (!email || !login || !server) return;
    try {
      await fetch(`${DASHBOARD_API}/api/v1/mt5-connected`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          login: login.trim(),
          server: server.trim(),
          app: 'tradeport',
        }),
      });
    } catch (_) {
      // ignore — best-effort reporting
    }
  }
}

export const apiService = new ApiService();
export default apiService;
