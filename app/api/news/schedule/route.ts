// News trade scheduling: arm, list, cancel.
import { scheduleNews, cancelNews, listNews } from '../engine';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** GET ?id=<uuid> — everything armed or recently resolved for that account. */
export async function GET(request: Request): Promise<Response> {
  const uuid = new URL(request.url).searchParams.get('id');
  if (!uuid) return json({ error: 'id is required' }, 400);
  return json({ schedules: listNews(uuid) });
}

export async function POST(request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const uuid = String(body?.id ?? '').trim();
  const eventId = String(body?.event_id ?? '').trim();
  const symbol = String(body?.symbol ?? '').trim().toUpperCase();
  const eventAt = Number(body?.event_at);
  const leadSeconds = Number(body?.lead_seconds);
  const count = Number(body?.count);
  const volume = Number(body?.volume);
  // Optional: a test flight compresses the settling window so the whole
  // sequence can be watched in seconds rather than minutes.
  const followSeconds = body?.follow_seconds === undefined ? undefined : Number(body.follow_seconds);

  if (!uuid || !eventId || !symbol) {
    return json({ error: 'id, event_id and symbol are required' }, 400);
  }
  if (!Number.isFinite(eventAt)) {
    return json({ error: 'event_at must be an epoch timestamp in ms' }, 400);
  }
  // Bounds are deliberate: these numbers open real positions, and a typo in a
  // field like "count" is the difference between 2 trades and 200.
  if (!Number.isFinite(leadSeconds) || leadSeconds < 0 || leadSeconds > 3600) {
    return json({ error: 'lead_seconds must be between 0 and 3600' }, 400);
  }
  if (!Number.isInteger(count) || count < 1 || count > 20) {
    return json({ error: 'count must be a whole number between 1 and 20' }, 400);
  }
  if (!Number.isFinite(volume) || volume <= 0 || volume > 100) {
    return json({ error: 'volume must be greater than 0 and at most 100' }, 400);
  }
  if (followSeconds !== undefined && (!Number.isFinite(followSeconds) || followSeconds < 1 || followSeconds > 3600)) {
    return json({ error: 'follow_seconds must be between 1 and 3600' }, 400);
  }

  const fireAt = eventAt - leadSeconds * 1000;
  if (fireAt <= Date.now()) {
    return json({ error: 'That fire time has already passed' }, 400);
  }

  const { key, schedule } = scheduleNews({
    uuid,
    eventId,
    eventTitle: String(body?.event_title ?? 'Event'),
    currency: String(body?.currency ?? ''),
    symbol,
    volume,
    count,
    leadSeconds,
    eventAt,
    followSeconds,
  });

  return json({ ok: true, key, schedule });
}

export async function DELETE(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const uuid = url.searchParams.get('id');
  const eventId = url.searchParams.get('event_id');
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
  if (!uuid || !eventId || !symbol) {
    return json({ error: 'id, event_id and symbol are required' }, 400);
  }
  return json({ ok: cancelNews(uuid, eventId, symbol) });
}
