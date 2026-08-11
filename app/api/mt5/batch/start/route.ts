import { startBatch } from '@/app/api/mt5/batch/engine';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id as string;
    const symbol = body?.symbol as string;
    const volume = Number(body?.volume);
    const count = Number(body?.count) || 1;
    // The client currently hardcodes 10. BATCH_INTERVAL_MIN lets a local test
    // run a short cycle without rebuilding the web bundle; unset in production,
    // so behaviour there is unchanged.
    const override = Number(process.env.BATCH_INTERVAL_MIN);
    const intervalMinutes = override > 0 ? override : (Number(body?.intervalMinutes) || 10);
    const comment = (body?.comment as string) || '';
    if (!id || !symbol || !volume) {
      return Response.json({ error: 'id, symbol and volume are required' }, { status: 400 });
    }
    const result = startBatch({ id, symbol, volume, count, intervalMs: intervalMinutes * 60_000, comment });
    return Response.json(result);
  } catch (error: any) {
    console.error('MT5 batch/start error:', error);
    return Response.json({ error: error?.message || 'Failed to start' }, { status: 502 });
  }
}
