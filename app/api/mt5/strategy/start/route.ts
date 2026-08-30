import { startStrategies, MAX_SYMBOLS_PER_ACCOUNT } from '@/app/api/mt5/strategy/engine';

const num = (v: any): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id as string;
    // `symbols` is the multi-select path; `symbol` is still accepted so an
    // older client build keeps working against a newer server.
    const raw: unknown = Array.isArray(body?.symbols) ? body.symbols : (body?.symbol ? [body.symbol] : []);
    const symbols = (raw as unknown[])
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .slice(0, MAX_SYMBOLS_PER_ACCOUNT);
    const volume = Number(body?.volume);
    if (!id || symbols.length === 0 || !volume) {
      return Response.json({ error: 'id, at least one symbol and volume are required' }, { status: 400 });
    }

    const result = startStrategies({
      id,
      symbols,
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
      // Risk. Omit and protective defaults apply — a stop is always placed
      // unless slAtrMult is explicitly set to 0.
      slAtrMult: num(body?.slAtrMult),
      tpAtrMult: num(body?.tpAtrMult),
      trailStartAtr: num(body?.trailStartAtr),
      trailAtr: num(body?.trailAtr),
      maxDailyLoss: num(body?.maxDailyLoss),
      maxConsecutiveLosses: num(body?.maxConsecutiveLosses),
      fridayFlatHourUtc: num(body?.fridayFlatHourUtc),
      flatWhenNoSignal: body?.flatWhenNoSignal,
      reenterEachBar: body?.reenterEachBar,
      // Optional. Without these the run cannot revive a dead broker session on
      // its own, so an expired token stops it until the app reconnects.
      creds: body?.server && body?.login && body?.password
        ? { server: String(body.server), login: String(body.login), password: String(body.password) }
        : undefined,
    });
    // Nothing started at all is a failure the caller must see, not a silent ok.
    if (!result.ok) {
      return Response.json({ error: result.rejected[0]?.error || 'Failed to start', ...result }, { status: 400 });
    }
    return Response.json(result);
  } catch (error: any) {
    console.error('MT5 strategy/start error:', error);
    return Response.json({ error: error?.message || 'Failed to start' }, { status: 502 });
  }
}
