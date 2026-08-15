// Fundamentals: this week's economic calendar events from the free Forex
// Factory feed (nfs.faireconomy.media — no API key required). Proxied
// server-side so the web app avoids CORS and so we can cache: the feed only
// updates a few times per hour and asks not to be hammered.

export interface FundamentalEvent {
  title: string;
  currency: string;
  date: string; // ISO timestamp with offset
  impact: 'High' | 'Medium' | 'Low' | 'Holiday' | 'Non-Economic';
  forecast: string;
  previous: string;
  actual?: string;
}

const FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const CACHE_TTL_MS = 15 * 60 * 1000;

let cache: { fetchedAt: number; events: FundamentalEvent[] } | null = null;

function normalizeEvents(raw: unknown): FundamentalEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e: any): FundamentalEvent | null => {
      const title = (e?.title ?? '').toString().trim();
      const date = (e?.date ?? '').toString().trim();
      if (!title || !date || Number.isNaN(Date.parse(date))) return null;
      return {
        title,
        currency: (e?.country ?? '').toString().trim().toUpperCase(),
        date,
        impact: (e?.impact ?? 'Low') as FundamentalEvent['impact'],
        forecast: (e?.forecast ?? '').toString().trim(),
        previous: (e?.previous ?? '').toString().trim(),
        ...(e?.actual ? { actual: e.actual.toString().trim() } : {}),
      };
    })
    .filter((e): e is FundamentalEvent => e !== null)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export async function GET(): Promise<Response> {
  try {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return Response.json(
        { message: 'accept', source: 'forexfactory', cached: true, updatedAt: new Date(cache.fetchedAt).toISOString(), events: cache.events },
        { status: 200 }
      );
    }

    const res = await fetch(FEED_URL, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'TradePortEA/1.0' },
    });
    if (!res.ok) throw new Error(`Feed responded ${res.status}`);

    const events = normalizeEvents(await res.json());
    if (events.length === 0 && !cache) throw new Error('Feed returned no events');

    // Keep serving the stale copy if a refresh comes back empty.
    if (events.length > 0) cache = { fetchedAt: Date.now(), events };

    return Response.json(
      { message: 'accept', source: 'forexfactory', cached: false, updatedAt: new Date(cache!.fetchedAt).toISOString(), events: cache!.events },
      { status: 200 }
    );
  } catch (error) {
    console.error('fundamentals error:', error);
    // Serve stale data over an error if we have any.
    if (cache) {
      return Response.json(
        { message: 'accept', source: 'forexfactory', cached: true, updatedAt: new Date(cache.fetchedAt).toISOString(), events: cache.events },
        { status: 200 }
      );
    }
    return Response.json({ message: 'error', events: [] }, { status: 200 });
  }
}
