import { startStrategy } from '@/app/api/mt5/strategy/engine';

const num = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id as string;
    const symbol = body?.symbol as string;
    const volume = Number(body?.volume);
    if (!id || !symbol || !volume) {
      return Response.json({ error: 'id, symbol and volume are required' }, { status: 400 });
    }

    const result = startStrategy({
      id,
      symbol,
      volume,
      count: num(body?.count),
      comment: body?.comment,
      timeframeMin: num(body?.timeframeMin),
      htfMin: num(body?.htfMin),
      fast: num(body?.fast),
      slow: num(body?.slow),
      atrPeriod: num(body?.atrPeriod),
      atrMult: num(body?.atrMult),
      exitMult: num(body?.exitMult),
      confirmBars: num(body?.confirmBars),
      htfPeriod: num(body?.htfPeriod),
      evalSeconds: num(body?.evalSeconds),
      alwaysIn: body?.alwaysIn,
      maxWaitMinutes: num(body?.maxWaitMinutes),
      flatWhenNoSignal: body?.flatWhenNoSignal,
      reenterEachBar: body?.reenterEachBar,
      // Optional. Without these the run cannot revive a dead broker session on
      // its own, so an expired token stops it until the app reconnects.
      creds: body?.server && body?.login && body?.password
        ? { server: String(body.server), login: String(body.login), password: String(body.password) }
        : undefined,
    });
    if (!result.ok) return Response.json(result, { status: 400 });
    return Response.json(result);
  } catch (error: any) {
    console.error('MT5 strategy/start error:', error);
    return Response.json({ error: error?.message || 'Failed to start' }, { status: 502 });
  }
}
