import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || '').replace(/\/$/, '');

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
}

export const apiService = new ApiService();
export default apiService;
