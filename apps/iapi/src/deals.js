// The deals engine: turns a snapshot into searchable "offers" (one per product per
// city), ranks them, and builds budget meals. Prices are kept in tetri internally
// and converted to GEL only at the edges (toGel).
import { distanceKm } from './geo.js';
import { historyKey } from './store.js';

export const toGel = (tetri) => (tetri == null ? null : Math.round(tetri) / 100);

const roundKm = (km) => (km == null ? null : Math.round(km * 10) / 10);

// The last recorded price that differs from today's point, or null.
function previousPrice(points) {
  if (!points || points.length < 2) return null;
  const today = points.at(-1).d;
  for (let i = points.length - 2; i >= 0; i--) if (points[i].d !== today) return points[i].p;
  return null;
}

export function buildIndex(snapshot, history = {}) {
  const venues = new Map(snapshot.venues.map((v) => [v.slug, v]));
  const products = new Map(snapshot.products.map((p) => [p.key, p]));
  const brands = new Map(snapshot.brands.map((b) => [b.slug, b]));
  const groups = new Map();
  for (const row of snapshot.prices) {
    const venue = venues.get(row.venue);
    const product = products.get(row.product);
    if (!venue || !product) continue;
    const id = historyKey(product.key, venue.city);
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, product, city: venue.city, rows: [] }));
    g.rows.push({ venue, price: row.price, originalPrice: row.originalPrice ?? null });
  }

  const offers = [];
  for (const g of groups.values()) {
    g.rows.sort((a, b) => a.price - b.price);
    const min = g.rows[0].price;
    const max = g.rows.at(-1).price;
    let bestDiscount = 0;
    let originalPrice = null;
    for (const r of g.rows) {
      if (!r.originalPrice) continue;
      const pct = (r.originalPrice - r.price) / r.originalPrice;
      if (pct > bestDiscount) {
        bestDiscount = pct;
        originalPrice = r.originalPrice;
      }
    }
    const prev = previousPrice(history[g.id]);
    offers.push({
      id: g.id,
      product: g.product,
      brand: g.product.brand,
      city: g.city,
      kind: g.product.kind,
      rows: g.rows,
      min,
      max,
      originalPrice,
      discountPct: Math.round(bestDiscount * 100),
      previousPrice: prev,
      priceDrop: prev != null && min < prev ? prev - min : 0,
      search: `${g.product.name} ${g.product.nameKa} ${g.product.category} ${brands.get(g.product.brand)?.name ?? ''}`.toLowerCase(),
    });
  }
  return { snapshot, history, venues, products, brands, offers };
}

const list = (v) =>
  (Array.isArray(v) ? v : String(v ?? '').split(','))
    .map((s) => s.trim())
    .filter(Boolean);

const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function nearestRow(offer, lat, lon) {
  let best = null;
  for (const r of offer.rows) {
    const km = distanceKm(lat, lon, r.venue.lat, r.venue.lon);
    if (!best || km < best.km) best = { row: r, km };
  }
  return best;
}

export function presentVenue(v, km = null) {
  return {
    slug: v.slug,
    name: v.name,
    brand: v.brand,
    city: v.city,
    address: v.address,
    lat: v.lat,
    lon: v.lon,
    rating: v.rating,
    ratingCount: v.ratingCount,
    promotions: v.promotions,
    deliveryPrice: toGel(v.deliveryPrice),
    estimate: v.estimate,
    url: v.url,
    distanceKm: roundKm(km),
  };
}

function presentOffer(o, near) {
  const cheapest = o.rows[0].venue;
  return {
    id: o.id,
    key: o.product.key,
    name: o.product.name,
    nameKa: o.product.nameKa,
    description: o.product.description,
    category: o.product.category,
    kind: o.kind,
    image: o.product.image,
    brand: o.brand,
    city: o.city,
    price: toGel(o.min),
    maxPrice: toGel(o.max),
    savings: toGel(o.max - o.min),
    originalPrice: toGel(o.originalPrice),
    discountPct: o.discountPct,
    previousPrice: toGel(o.previousPrice),
    priceDrop: toGel(o.priceDrop),
    branches: o.rows.length,
    cheapestBranches: o.rows.filter((r) => r.price === o.min).length,
    cheapestVenue: { slug: cheapest.slug, name: cheapest.name, address: cheapest.address, url: cheapest.url },
    nearest: near
      ? { slug: near.row.venue.slug, name: near.row.venue.name, price: toGel(near.row.price), distanceKm: roundKm(near.km), url: near.row.venue.url }
      : null,
  };
}

const SORTS = {
  price: (a, b) => a.o.min - b.o.min || b.o.discountPct - a.o.discountPct,
  discount: (a, b) => b.o.discountPct - a.o.discountPct || b.o.priceDrop - a.o.priceDrop || a.o.min - b.o.min,
  savings: (a, b) => b.o.max - b.o.min - (a.o.max - a.o.min) || a.o.min - b.o.min,
  drop: (a, b) => b.o.priceDrop - a.o.priceDrop || a.o.min - b.o.min,
  distance: (a, b) => (a.near?.km ?? Infinity) - (b.near?.km ?? Infinity) || a.o.min - b.o.min,
  name: (a, b) => a.o.product.name.localeCompare(b.o.product.name),
};

export function queryDeals(index, params = {}) {
  const city = params.city ?? '';
  const brands = new Set(list(params.brand));
  const kinds = new Set(list(params.kind));
  const includeExtras = params.extras === '1' || params.extras === true || kinds.has('extra');
  const q = String(params.q ?? '').trim().toLowerCase();
  const terms = q ? q.split(/\s+/) : [];
  const max = num(params.max);
  const discounted = params.discounted === '1' || params.discounted === true;
  const lat = num(params.lat);
  const lon = num(params.lon);
  const hasLocation = lat != null && lon != null;
  const sort = SORTS[params.sort] ? params.sort : 'price';
  const limit = Math.min(Math.max(num(params.limit) ?? 60, 1), 500);
  const offset = Math.max(num(params.offset) ?? 0, 0);

  const matched = [];
  for (const o of index.offers) {
    if (city && o.city !== city) continue;
    if (brands.size && !brands.has(o.brand)) continue;
    if (kinds.size ? !kinds.has(o.kind) : !includeExtras && o.kind === 'extra') continue;
    if (max != null && o.min > max * 100) continue;
    if (discounted && !(o.discountPct > 0 || o.priceDrop > 0)) continue;
    if (terms.length && !terms.every((t) => o.search.includes(t))) continue;
    matched.push({ o, near: hasLocation ? nearestRow(o, lat, lon) : null });
  }
  matched.sort(SORTS[sort === 'distance' && !hasLocation ? 'price' : sort]);
  return {
    total: matched.length,
    offset,
    limit,
    items: matched.slice(offset, offset + limit).map(({ o, near }) => presentOffer(o, near)),
  };
}

export function productDetail(index, key, params = {}) {
  const product = index.products.get(key);
  if (!product) return null;
  const lat = num(params.lat);
  const lon = num(params.lon);
  const offers = index.offers.filter((o) => o.product.key === key && (!params.city || o.city === params.city));
  const branches = offers
    .flatMap((o) => o.rows)
    .map((r) => {
      const km = lat != null && lon != null ? distanceKm(lat, lon, r.venue.lat, r.venue.lon) : null;
      return { ...presentVenue(r.venue, km), price: toGel(r.price), originalPrice: toGel(r.originalPrice) };
    })
    .sort((a, b) => a.price - b.price || (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
  const history = Object.fromEntries(
    offers.map((o) => [o.city, (index.history[o.id] ?? []).map((pt) => ({ date: pt.d, price: toGel(pt.p) }))]),
  );
  return { product, branches, history };
}

export function queryVenues(index, params = {}) {
  const brands = new Set(list(params.brand));
  const lat = num(params.lat);
  const lon = num(params.lon);
  const hasLocation = lat != null && lon != null;
  const promoOnly = params.promo === '1' || params.promo === true;
  const items = [];
  for (const v of index.venues.values()) {
    if (params.city && v.city !== params.city) continue;
    if (brands.size && !brands.has(v.brand)) continue;
    if (promoOnly && !v.promotions?.length) continue;
    items.push(presentVenue(v, hasLocation ? distanceKm(lat, lon, v.lat, v.lon) : null));
  }
  items.sort((a, b) =>
    hasLocation
      ? a.distanceKm - b.distanceKm
      : b.promotions.length - a.promotions.length || (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name),
  );
  return { total: items.length, items };
}

// For one branch: the cheapest full meal, and the biggest meal within budget.
// A full meal is a combo/set, or a main + side + drink (no side if the branch sells
// none). "Biggest" means the priciest main or combo that still fits once paired with
// the cheapest side and drink, so the extra money goes into food, not a fancy drink.
export function mealsForVenue(rows, budget) {
  const byKind = { combo: [], main: [], side: [], drink: [] };
  for (const r of rows) if (byKind[r.product.kind] && !r.product.alcohol) byKind[r.product.kind].push(r);
  for (const k of Object.keys(byKind)) byKind[k].sort((a, b) => a.price - b.price);

  const candidates = byKind.combo.map((c) => ({ type: 'combo', items: [c], total: c.price }));
  const [side] = byKind.side;
  const [drink] = byKind.drink;
  if (drink) {
    for (const m of byKind.main) {
      const items = side ? [m, side, drink] : [m, drink];
      candidates.push({ type: 'meal', items, total: items.reduce((sum, r) => sum + r.price, 0) });
    }
  }
  if (!candidates.length) return null;

  let cheapest = candidates[0];
  let best = null;
  for (const c of candidates) {
    if (c.total < cheapest.total) cheapest = c;
    if (c.total <= budget && (!best || c.total > best.total)) best = c;
  }
  return { cheapest, best };
}

const presentMeal = (meal) =>
  meal && {
    type: meal.type,
    total: toGel(meal.total),
    items: meal.items.map((r) => ({ key: r.product.key, name: r.product.name, nameKa: r.product.nameKa, kind: r.product.kind, price: toGel(r.price), image: r.product.image })),
  };

export function budgetMeals(index, params = {}) {
  const budget = Math.round((num(params.budget) ?? 10) * 100);
  const brands = new Set(list(params.brand));
  const lat = num(params.lat);
  const lon = num(params.lon);
  const hasLocation = lat != null && lon != null;

  const rowsByVenue = new Map();
  for (const o of index.offers) {
    if (params.city && o.city !== params.city) continue;
    if (brands.size && !brands.has(o.brand)) continue;
    for (const r of o.rows) {
      if (!rowsByVenue.has(r.venue.slug)) rowsByVenue.set(r.venue.slug, []);
      rowsByVenue.get(r.venue.slug).push({ product: o.product, price: r.price });
    }
  }

  const perBrand = new Map();
  for (const [slug, rows] of rowsByVenue) {
    const venue = index.venues.get(slug);
    const meals = mealsForVenue(rows, budget);
    if (!meals) continue;
    const km = hasLocation ? distanceKm(lat, lon, venue.lat, venue.lon) : null;
    const cur = perBrand.get(venue.brand);
    const better =
      !cur ||
      meals.cheapest.total < cur.meals.cheapest.total ||
      (meals.cheapest.total === cur.meals.cheapest.total && km != null && km < cur.km);
    if (better) perBrand.set(venue.brand, { venue, meals, km });
  }

  const results = [...perBrand.values()]
    .map(({ venue, meals, km }) => ({
      brand: venue.brand,
      venue: presentVenue(venue, km),
      fits: meals.cheapest.total <= budget,
      cheapest: presentMeal(meals.cheapest),
      best: presentMeal(meals.best),
    }))
    .sort((a, b) => Number(b.fits) - Number(a.fits) || a.cheapest.total - b.cheapest.total);
  return { budget: toGel(budget), results };
}

export function meta(index) {
  const { snapshot } = index;
  const count = (arr, key) => arr.reduce((m, x) => m.set(x[key], (m.get(x[key]) ?? 0) + 1), new Map());
  const venuesPerCity = count(snapshot.venues, 'city');
  const venuesPerBrand = count(snapshot.venues, 'brand');
  return {
    generatedAt: snapshot.generatedAt,
    source: snapshot.source,
    cities: snapshot.cities.filter((c) => venuesPerCity.has(c.slug)).map((c) => ({ ...c, venues: venuesPerCity.get(c.slug) })),
    brands: snapshot.brands.map((b) => ({ ...b, venues: venuesPerBrand.get(b.slug) ?? 0 })),
    kinds: ['main', 'combo', 'side', 'drink', 'dessert', 'extra'],
    totals: { venues: snapshot.venues.length, products: snapshot.products.length, offers: index.offers.length, prices: snapshot.prices.length },
  };
}
