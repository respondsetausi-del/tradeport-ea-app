import { getStrategyStatus, getPublicStatus } from '@/app/api/mt5/strategy/engine';

/**
 * GET /api/mt5/strategy/status?id=<uuid>[&detail=full]
 *
 * Default is the PUBLIC view — running state, direction, open trades, plain
 * wording. It never names an indicator, period, threshold or decision reason,
 * so the method can't be reconstructed from what the app displays.
 *
 * `detail=full` returns the internals (signal values, thresholds, decision
 * log). That is for operators and debugging — do not wire it to the client UI.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return Response.json({ error: 'Account UUID required' }, { status: 400 });

    const full = url.searchParams.get('detail') === 'full';
    return Response.json(full ? getStrategyStatus(id) : getPublicStatus(id));
  } catch (error: any) {
    console.error('MT5 strategy/status error:', error);
    return Response.json({ error: error?.message || 'Failed to read status' }, { status: 502 });
  }
}
