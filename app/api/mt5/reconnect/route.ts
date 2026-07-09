import { ensureConnected } from '@/services/api2trade';

// Probe the session behind `uuid` and, if the broker dropped it, silently
// re-establish it under the SAME uuid from the stored credentials. Returns
// the (stable) uuid so the client's persisted handle never has to change.
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const uuid = (body?.uuid as string)?.trim();
    const server = (body?.server as string)?.trim();
    const login = (body?.login as string)?.toString().trim();
    const password = (body?.password as string)?.trim();

    if (!uuid || !server || !login || !password) {
      return Response.json({ error: 'uuid, server, login, and password are required' }, { status: 400 });
    }

    const { reconnected } = await ensureConnected(uuid, server, login, password);
    return Response.json({ uuid, reconnected });
  } catch (error) {
    console.error('MT5 reconnect error:', error);
    const msg = error instanceof Error ? error.message : 'Reconnect failed';
    return Response.json({ error: msg }, { status: 502 });
  }
}
