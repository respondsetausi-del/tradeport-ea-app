import { test, expect, mock, beforeEach } from 'bun:test';

// ── Fake Api2Trade ──────────────────────────────────────────────────────────
let sends: any[] = [];
let closes: any[] = [];
let openOrdersImpl: () => Promise<any> = async () => [];

mock.module('@/services/api2trade', () => ({
  orderSend: async (p: any) => {
    sends.push(p);
    return { ticket: 1000 + sends.length, symbol: p.symbol, lots: p.volume };
  },
  orderClose: async (p: any) => { closes.push(p); return { ticket: p.ticket }; },
  getOpenOrders: async () => openOrdersImpl(),
  getClosedOrders: async () => [],
}));
mock.module('@/app/api/_db', () => ({ getPool: async () => { throw new Error('no db in test'); } }));

const { startBatch, stopBatch, getStatus } = await import('../app/api/mt5/batch/engine.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dirs = () => [...new Set(sends.map((s) => s.operation))];

beforeEach(() => { sends = []; closes = []; });

test('A — cannot read the account at START: opens NOTHING', async () => {
  openOrdersImpl = async () => { throw new Error('502 from Api2Trade'); };
  startBatch({ id: 'A', symbol: 'XAUUSD', volume: 0.01, count: 3, intervalMs: 5000, comment: 'T' });
  await sleep(17_000); // 4 confirm passes = 1.5+3+4.5+6s

  expect(sends.length).toBe(0);               // <- the whole point
  expect(getStatus('A').status).toContain('Cannot verify');
  await stopBatch('A', false); // skip the stop-sweep; it runs its own 15s of passes
}, 40_000);

test('B — account reads flat: opens the full batch, one direction', async () => {
  openOrdersImpl = async () => [];
  startBatch({ id: 'B', symbol: 'XAUUSD', volume: 0.01, count: 3, intervalMs: 60_000, comment: 'T' });
  await sleep(3_000);

  expect(sends.length).toBe(3);
  expect(dirs().length).toBe(1);
  await stopBatch('B');
}, 30_000);

test('C — positions will not close at flip time: NEVER opens the opposite side', async () => {
  // Flat at start so the first batch opens...
  openOrdersImpl = async () => [];
  startBatch({ id: 'C', symbol: 'XAUUSD', volume: 0.01, count: 2, intervalMs: 5_000, comment: 'T' });
  await sleep(3_000);

  const firstDir = sends[0].operation;
  const opposite = firstDir === 'Buy' ? 'Sell' : 'Buy';
  expect(sends.length).toBe(2);

  // ...then the broker refuses to let go: closes "succeed" but the positions
  // stay open. This is the exact scenario the mentors reported.
  openOrdersImpl = async () => [
    { ticket: 1001, symbol: 'XAUUSD', lots: 0.01 },
    { ticket: 1002, symbol: 'XAUUSD', lots: 0.01 },
  ];
  await sleep(22_000); // flip is due at 5s, then 4 failed confirm passes

  expect(closes.length).toBeGreaterThan(0);                    // it did try to close
  expect(sends.filter((s) => s.operation === opposite).length).toBe(0); // no hedge
  expect(sends.length).toBe(2);                                // still just the first batch
  expect(getStatus('C').status).toContain('would not close');
  await stopBatch('C', false);
}, 45_000);

test('D — a send that throws is reconciled, not lost', async () => {
  openOrdersImpl = async () => [];
  let n = 0;
  mock.module('@/services/api2trade', () => ({
    orderSend: async (p: any) => {
      n += 1;
      sends.push(p);
      if (n === 2) throw new Error('timeout'); // filled at broker, response lost
      return { ticket: 2000 + n, symbol: p.symbol, lots: p.volume };
    },
    orderClose: async (p: any) => { closes.push(p); return { ticket: p.ticket }; },
    // the "lost" order is visible on the account
    getOpenOrders: async () => (n >= 2
      ? [{ ticket: 2001, symbol: 'XAUUSD', lots: 0.01 }, { ticket: 9999, symbol: 'XAUUSD', lots: 0.01 }]
      : []),
    getClosedOrders: async () => [],
  }));
  const { startBatch: sb, stopBatch: stb, getStatus: gs } = await import('../app/api/mt5/batch/engine.ts');
  sb({ id: 'D', symbol: 'XAUUSD', volume: 0.01, count: 2, intervalMs: 60_000, comment: 'T' });
  await sleep(4_000);

  // ticket 9999 was never returned to us, but must have been adopted.
  expect(gs('D').openTickets).toBe(2);
  await stb('D', false);
}, 30_000);
