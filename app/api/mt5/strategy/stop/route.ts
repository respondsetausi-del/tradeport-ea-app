import { stopStrategy } from '@/app/api/mt5/strategy/engine';

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({} as any));
    const id = body?.id as string;
    if (!id) return Response.json({ error: 'id is required' }, { status: 400 });
    const closeOpen = body?.closeOpen !== false;
    return Response.json(await stopStrategy(id, closeOpen));
  } catch (error: any) {
    console.error('MT5 strategy/stop error:', error);
    return Response.json({ error: error?.message || 'Failed to stop' }, { status: 502 });
  }
}
