import { getOpenOrders, getClosedOrders } from '@/services/api2trade';

/**
 * GET /api/mt5/orders?id=UUID&type=open|closed|all
 *
 * Positions on the account. This is the endpoint every no-hedge check depends
 * on: the engines close by ticket, then confirm the account actually went flat
 * before opening the opposite direction.
 *
 * It must FAIL LOUD. An error here has to surface as a non-200 so callers can
 * tell "the account is flat" apart from "I could not find out" — returning an
 * empty array on failure reads as flat and opens a hedge on top of live
 * positions. (This route was missing entirely until now, so the Android
 * client's flat-check and backup sweep were both 404ing and being parsed as
 * "no open trades".)
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) return Response.json({ error: 'Account UUID required' }, { status: 400 });

    const type = (url.searchParams.get('type') || 'open').toLowerCase();

    // Api2Trade answers HTTP 200 with an ERROR OBJECT (e.g. an expired session
    // gives {code:'INVALID_TOKEN'}) instead of an array. Passing that straight
    // through is dangerous: a client parsing for orders finds none and reads it
    // as "no open positions" — i.e. flat — which is exactly how the opposite
    // batch ends up opening on top of live trades. Anything that isn't an array
    // is an error, and must leave as one.
    const asOrders = (result: any, what: string) => {
      if (Array.isArray(result)) return null;
      const detail = result?.message || result?.error || result?.code || 'unexpected response shape';
      console.error(`MT5 orders: ${what} did not return an array —`, detail);
      return Response.json(
        { error: `Could not read ${what}: ${detail}`, code: result?.code },
        { status: 502 },
      );
    };

    if (type === 'open') {
      const open = await getOpenOrders(id);
      return asOrders(open, 'open orders') ?? Response.json(open);
    }

    if (type === 'closed') {
      const closed = await getClosedOrders(id);
      return asOrders(closed, 'closed orders') ?? Response.json(closed);
    }

    if (type === 'all') {
      const [open, closed] = await Promise.all([getOpenOrders(id), getClosedOrders(id)]);
      return asOrders(open, 'open orders')
        ?? asOrders(closed, 'closed orders')
        ?? Response.json({ open, closed });
    }

    return Response.json({ error: 'Invalid type. Use: open, closed, all' }, { status: 400 });
  } catch (error) {
    console.error('MT5 orders error:', error);
    const msg = error instanceof Error ? error.message : 'Failed to fetch orders';
    return Response.json({ error: msg }, { status: 502 });
  }
}
