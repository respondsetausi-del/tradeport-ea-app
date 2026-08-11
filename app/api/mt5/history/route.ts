import { getPriceHistory } from '@/services/api2trade';

/**
 * GET /api/mt5/history?id=&symbol=&timeframe=<minutes>&from=&to=&bars=
 *
 * `timeframe` is BAR SIZE IN MINUTES (1, 5, 15, 60, 240). MT-style names like
 * "M15" are not accepted here on purpose — Api2Trade ignores them silently and
 * returns 4-hour bars from 2022, which is worse than an error.
 *
 * If from/to are omitted, `bars` (default 300) of recent history is returned.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    const symbol = url.searchParams.get('symbol');
    if (!id) return Response.json({ error: 'Account UUID required' }, { status: 400 });
    if (!symbol) return Response.json({ error: 'Symbol required' }, { status: 400 });

    const timeframe = Number(url.searchParams.get('timeframe') || 15);
    if (!Number.isFinite(timeframe) || timeframe < 1) {
      return Response.json({ error: 'timeframe must be a number of minutes, e.g. 1, 15, 60' }, { status: 400 });
    }

    const bars = Math.min(5000, Number(url.searchParams.get('bars') || 300));
    const toParam = url.searchParams.get('to');
    const fromParam = url.searchParams.get('from');
    const to = toParam ? new Date(toParam) : new Date(Date.now() + 2 * 60 * 60 * 1000);
    const from = fromParam
      ? new Date(fromParam)
      : new Date(Date.now() - timeframe * bars * 4 * 60 * 1000);

    const candles = await getPriceHistory(id, symbol, timeframe, from, to);
    if (!Array.isArray(candles)) {
      const detail = (candles as any)?.message || (candles as any)?.code || 'unexpected response shape';
      return Response.json({ error: `Could not read price history: ${detail}` }, { status: 502 });
    }
    return Response.json(candles);
  } catch (error: any) {
    console.error('MT5 history error:', error);
    return Response.json({ error: error?.message || 'Failed to fetch history' }, { status: 502 });
  }
}
