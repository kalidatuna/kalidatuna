// Minimal client for Wolt's public web pages and menu JSON.
// Requests are made one at a time by the crawler; this module only knows how
// to fetch politely and how to read the responses.

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36 iapi-deals/1.0';

export const WOLT_WEB = 'https://wolt.com';
export const WOLT_API = 'https://consumer-api.wolt.com';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

// Fetch with retries. 429 and 5xx back off exponentially (honouring Retry-After);
// 404 is returned as null so callers can treat "brand not in this city" as empty.
export async function fetchWithRetry(url, { as = 'text', retries = 5, baseDelayMs = 5000, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let waitMs = baseDelayMs * 2 ** attempt;
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: as === 'json' ? 'application/json' : 'text/html' },
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 404 || res.status === 410) return null;
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers?.get?.('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) waitMs = Math.min(retryAfter * 1000, 120000);
        throw new HttpError(res.status, url);
      }
      if (!res.ok) throw Object.assign(new HttpError(res.status, url), { fatal: true });
      return as === 'json' ? await res.json() : await res.text();
    } catch (err) {
      lastError = err;
      if (err.fatal || attempt === retries) break;
      await sleep(waitMs);
    }
  }
  throw lastError;
}

// Branch list for a brand around a point; returns every branch in that city.
export const brandVenuesUrl = (brand, lat, lon) =>
  `${WOLT_API}/v1/pages/brand/${encodeURIComponent(brand)}?lat=${lat}&lon=${lon}`;
export const venuePageUrl = (city, venue) => `${WOLT_WEB}/en/geo/${city}/restaurant/${venue}`;
export const assortmentUrl = (venue, language) =>
  `${WOLT_API}/consumer-api/consumer-assortment/v1/venues/slug/${encodeURIComponent(venue)}/assortment?language=${language}`;

// Collects every `venue` object (one with a slug and a location) anywhere in a
// Wolt page response, so it keeps working if sections are reshuffled.
export function extractVenues(page) {
  const venues = new Map();
  const stack = [page];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      stack.push(...node);
    } else if (node && typeof node === 'object') {
      const v = node.venue;
      if (v && typeof v === 'object' && typeof v.slug === 'string' && Array.isArray(v.location)) {
        if (!venues.has(v.slug)) venues.set(v.slug, v);
      }
      for (const value of Object.values(node)) if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [...venues.values()];
}

export function promotionTexts(rawVenue) {
  const texts = new Set();
  for (const p of rawVenue.promotions ?? []) if (p?.text) texts.add(p.text);
  for (const p of rawVenue.promotions_for_telemetry ?? []) if (p?.text) texts.add(p.text);
  for (const b of rawVenue.badges_v2 ?? []) if (b?.icon === 'coupon-fill' && b.text) texts.add(b.text);
  return [...texts].map((t) => t.replace(/ /g, ' '));
}

export function normalizeVenue(rawVenue, { city, brand }) {
  const [lon, lat] = rawVenue.location;
  return {
    slug: rawVenue.slug,
    name: rawVenue.name?.trim(),
    brand,
    city,
    address: rawVenue.address?.trim() ?? '',
    lat,
    lon,
    rating: rawVenue.rating?.score ?? null,
    ratingCount: rawVenue.rating?.volume ?? 0,
    online: rawVenue.online !== false,
    deliveryPrice: typeof rawVenue.delivery_price_int === 'number' ? rawVenue.delivery_price_int : null,
    estimate: rawVenue.estimate_range ?? null,
    promotions: promotionTexts(rawVenue),
    url: venuePageUrl(city, rawVenue.slug),
  };
}
