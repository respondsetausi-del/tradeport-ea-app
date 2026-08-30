/**
 * Economic calendar (fundamentals) — proxied, not fetched from the client.
 *
 * The upstream feed sends no Access-Control-Allow-Origin, so a browser/PWA
 * fetch is blocked by CORS. Proxying also lets us cache: the calendar changes
 * a few times a day at most, and every app open would otherwise hit the
 * upstream directly.
 *
 * Source: the ForexFactory weekly calendar JSON — free, no API key.
 */

const FEED = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// The calendar is a weekly publication; actuals land as events happen. Ten
// minutes keeps "Actual" fresh without hammering the upstream.
const TTL_MS = 10 * 60 * 1000;

interface RawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  currency: string;
  date: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  forecast: string;
  previous: string;
  actual: string;
}

let cache: { at: number; data: CalendarEvent[] } | null = null;

function normalise(raw: RawEvent[]): CalendarEvent[] {
  return raw
    .filter((e) => e?.title && e?.date)
    .map((e, i) => {
      const impact = (e.impact || '').toLowerCase();
      return {
        id: `${e.date}-${e.country || ''}-${i}`,
        title: String(e.title),
        currency: String(e.country || '').toUpperCase(),
        date: String(e.date),
        impact: impact.startsWith('high')
          ? 'High'
          : impact.startsWith('med')
            ? 'Medium'
            : impact.startsWith('holiday')
              ? 'Holiday'
              : 'Low',
        forecast: e.forecast || '',
        previous: e.previous || '',
        actual: e.actual || '',
      } as CalendarEvent;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export async function GET(): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (cache && Date.now() - cache.at < TTL_MS) {
    return new Response(JSON.stringify({ events: cache.data, cached: true }), { headers });
  }

  try {
    const res = await fetch(FEED, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const raw = (await res.json()) as RawEvent[];
    if (!Array.isArray(raw)) throw new Error('unexpected upstream shape');

    const events = normalise(raw);
    cache = { at: Date.now(), data: events };
    return new Response(JSON.stringify({ events, cached: false }), { headers });
  } catch (error: any) {
    console.error('[fundamentals] fetch failed:', error?.message || error);
    // Serve stale rather than nothing — a slightly old calendar beats an empty
    // screen when the upstream blips.
    if (cache) {
      return new Response(JSON.stringify({ events: cache.data, cached: true, stale: true }), { headers });
    }
    return new Response(
      JSON.stringify({ error: 'Could not load the economic calendar right now.' }),
      { status: 502, headers },
    );
  }
}
