import { getAccountSummary, getSymbolList, getOpenOrders } from '@/services/api2trade';
import { getStrategyStatus } from '@/app/api/mt5/strategy/engine';
import { getStatus as getBatchStatus } from '@/app/api/mt5/batch/engine';

/**
 * GET /api/mt5/strategy/preflight?id=<uuid>&symbol=<s>&volume=<v>
 *
 * Everything that must be true before a robot starts, checked in one call and
 * returned as a list the UI can show passing or failing. Each check is
 * user-readable — no indicator names, no thresholds.
 *
 * The one that matters most is `no_other_engine`: two things trading one
 * account is what produces Buy and Sell open together, and it is invisible
 * from inside either engine.
 *
 * A check that cannot be evaluated returns ok:false with a plain reason. This
 * screen exists to catch problems, so "I could not tell" is a failure, not a
 * pass.
 */
interface Check { id: string; label: string; ok: boolean; detail?: string; blocking: boolean }

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const symbol = (url.searchParams.get('symbol') || '').trim();
    const volume = Number(url.searchParams.get('volume') || 0);
    if (!id) return Response.json({ error: 'Account UUID required' }, { status: 400 });

    const checks: Check[] = [];
    const add = (c: Check) => checks.push(c);

    // 1 — is the broker session actually live?
    let connected = false;
    try {
      const summary: any = await getAccountSummary(id);
      connected = Boolean(summary?.leverage);
      add({
        id: 'account',
        label: 'MetaTrader account connected',
        ok: connected,
        detail: connected
          ? `Balance ${Number(summary.balance ?? 0).toFixed(2)} ${summary.currency ?? ''}`.trim()
          : 'Reconnect your account on the MetaTrader page.',
        blocking: true,
      });
    } catch {
      add({ id: 'account', label: 'MetaTrader account connected', ok: false, detail: 'Could not reach your account.', blocking: true });
    }

    // 2 — exact symbol. Casing and suffixes are not negotiable at the broker.
    if (symbol) {
      try {
        const symbols = await getSymbolList(id);
        const known = Array.isArray(symbols) && symbols.includes(symbol);
        const near = Array.isArray(symbols)
          ? symbols.find((s: string) => s.toLowerCase() === symbol.toLowerCase())
          : undefined;
        add({
          id: 'symbol',
          label: `${symbol} available on your account`,
          ok: known,
          detail: known ? undefined : near ? `Did you mean ${near}? Symbol names are case-sensitive.` : 'Not in your broker\'s list.',
          blocking: true,
        });
      } catch {
        add({ id: 'symbol', label: 'Symbol available', ok: false, detail: 'Could not load your broker\'s symbols.', blocking: true });
      }
    }

    // 3 — lot size sanity. Below the broker minimum the order is silently
    // rejected with a 200 and no ticket, which looks like "nothing happened".
    add({
      id: 'volume',
      label: 'Lot size looks valid',
      ok: volume > 0,
      detail: volume > 0 ? `${volume} per trade` : 'Enter a lot size, e.g. 0.01',
      blocking: true,
    });

    // 4 — start flat, so the first position is only ever ours.
    let openCount: number | null = null;
    try {
      const open = await getOpenOrders(id);
      openCount = Array.isArray(open) ? open.length : null;
    } catch { openCount = null; }
    add({
      id: 'flat',
      label: 'No trades already open',
      ok: openCount === 0,
      detail: openCount === null
        ? 'Could not read your open trades.'
        : openCount > 0 ? `${openCount} open — close them or they will be managed by the robot.` : undefined,
      blocking: false,
    });

    // 5 — the one that prevents the hedge.
    const strat: any = getStrategyStatus(id);
    const batch: any = getBatchStatus(id);
    const busy = Boolean(strat?.running) || Boolean(batch?.running);
    add({
      id: 'no_other_engine',
      label: 'Nothing else is trading this account',
      ok: !busy,
      detail: busy
        ? `Already running on ${strat?.symbol || batch?.symbol || 'this account'}. Stop it first.`
        : undefined,
      blocking: true,
    });

    const blockers = checks.filter((c) => c.blocking && !c.ok);
    return Response.json({ ok: blockers.length === 0, checks, blockers: blockers.map((b) => b.id) });
  } catch (error: any) {
    console.error('MT5 strategy/preflight error:', error);
    return Response.json({ error: error?.message || 'Preflight failed' }, { status: 502 });
  }
}
