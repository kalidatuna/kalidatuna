// Crawls Wolt brand branch lists and venue menus and produces a normalized snapshot:
//   venues   – every branch with address, coordinates and promotions
//   products – one entry per distinct item per brand (shared across branches)
//   prices   – the price of a product at a specific branch, in tetri
import {
  assortmentUrl,
  brandVenuesUrl,
  extractVenues,
  fetchWithRetry,
  normalizeVenue,
  sleep,
} from './wolt.js';
import { classifyItem } from './classify.js';
import { distanceKm } from './geo.js';

export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

const looseName = (s) => s.toLowerCase().replace(/['’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// A brand page can show "you might also like" venues; keep only those whose name
// starts with the brand's first word (e.g. "Dunkin Mrgvali Baghi" for "Dunkin'").
export function venueMatchesBrand(venueName, brandName) {
  const first = looseName(brandName).split(' ')[0];
  return looseName(venueName ?? '').includes(first);
}

const SIZE = /\d+\s*(cm|სმ|см)/i;
export const sizeFromCategory = (category) => category.match(/(\d+)\s*(cm|სმ|см)/i)?.[1] ?? null;

function categoryIndex(categories, index = new Map()) {
  for (const c of categories ?? []) {
    for (const id of c.item_ids ?? []) if (!index.has(id)) index.set(id, c.name?.trim() ?? '');
    categoryIndex(c.subcategories, index);
  }
  return index;
}

// Turns one venue's assortment (in several languages) into product + price records.
export function normalizeAssortment({ brand, venueSlug, byLanguage }) {
  const primary = byLanguage.en ?? Object.values(byLanguage)[0];
  if (!primary?.items) return { products: [], prices: [] };
  const categories = categoryIndex(primary.categories);
  const kaNames = new Map((byLanguage.ka?.items ?? []).map((i) => [i.id, i.name?.trim()]));

  const products = [];
  const prices = [];
  const seen = new Set();
  for (const item of primary.items) {
    if (typeof item.price !== 'number' || item.price <= 0) continue;
    if (item.disabled_info) continue;
    let name = item.name?.trim() || kaNames.get(item.id);
    if (!name) continue;
    let nameKa = kaNames.get(item.id) || name;
    const category = categories.get(item.id) ?? '';
    // Subway uses the same name for the 15 cm and 30 cm sandwich and puts the size
    // only in the category, so the size becomes part of the name and key.
    const size = sizeFromCategory(category);
    if (size && !SIZE.test(name) && !SIZE.test(nameKa)) {
      name = `${name} (${size} cm)`;
      nameKa = `${nameKa} (${size} სმ)`;
    }
    const key = `${brand}:${slugify(nameKa) || slugify(name)}`;
    if (seen.has(key)) continue; // same item listed in two categories
    seen.add(key);
    products.push({
      key,
      brand,
      name,
      nameKa,
      category,
      kind: classifyItem({ name, nameKa, category }),
      description: item.description?.trim() || '',
      image: item.images?.[0]?.url ?? null,
      alcohol: (item.alcohol_permille ?? 0) > 0,
    });
    const original = typeof item.original_price === 'number' && item.original_price > item.price ? item.original_price : null;
    prices.push({ venue: venueSlug, product: key, price: item.price, originalPrice: original });
  }
  return { products, prices };
}

export async function crawl(config, { fetchImpl = fetch, log = () => {}, delayMs, cities, brands } = {}) {
  const delay = delayMs ?? config.crawl?.delayMs ?? 700;
  const languages = config.crawl?.languages ?? ['en', 'ka'];
  const maxPerBrand = config.crawl?.maxVenuesPerBrandPerCity ?? 0;
  const citySet = cities ? new Set(cities) : null;
  const brandSet = brands ? new Set(brands) : null;
  const targetCities = config.cities.filter((c) => !citySet || citySet.has(c.slug));
  const targetBrands = config.brands.filter((b) => !brandSet || brandSet.has(b.slug));
  const get = (url, as) => fetchWithRetry(url, { as, fetchImpl });

  const errors = [];
  // venue slug -> { venue, brandSlugLength }; a venue listed on several brand pages
  // (e.g. "wendys" and "wendys-chicken") goes to the most specific brand.
  const venueMap = new Map();

  for (const city of targetCities) {
    for (const brand of targetBrands) {
      const url = brandVenuesUrl(brand.slug, city.lat, city.lon);
      try {
        const page = await get(url, 'json');
        // The brand list is centred on the city; drop anything far outside it.
        const raw = (page ? extractVenues(page) : []).filter(
          (v) => distanceKm(city.lat, city.lon, v.location[1], v.location[0]) <= (config.crawl?.cityRadiusKm ?? 40),
        );
        let found = raw.filter((v) => venueMatchesBrand(v.name, brand.name));
        if (maxPerBrand > 0) found = found.slice(0, maxPerBrand);
        for (const v of found) {
          const prev = venueMap.get(v.slug);
          if (prev && prev.brandSlugLength >= brand.slug.length) continue;
          venueMap.set(v.slug, { venue: normalizeVenue(v, { city: city.slug, brand: brand.slug }), brandSlugLength: brand.slug.length });
        }
        log(`brand  ${city.slug}/${brand.slug}: ${found.length} branches`);
      } catch (err) {
        errors.push({ url, error: String(err.message ?? err) });
        log(`brand  ${city.slug}/${brand.slug}: FAILED ${err.message}`);
      }
      await sleep(delay);
    }
  }

  const venues = [...venueMap.values()].map((v) => v.venue);
  const products = new Map();
  const prices = [];
  let done = 0;
  for (const venue of venues) {
    const byLanguage = {};
    for (const language of languages) {
      const url = assortmentUrl(venue.slug, language);
      try {
        const data = await get(url, 'json');
        if (data) byLanguage[language] = data;
      } catch (err) {
        errors.push({ url, error: String(err.message ?? err) });
      }
      await sleep(delay);
    }
    const result = normalizeAssortment({ brand: venue.brand, venueSlug: venue.slug, byLanguage });
    for (const p of result.products) if (!products.has(p.key)) products.set(p.key, p);
    prices.push(...result.prices);
    venue.itemCount = result.prices.length;
    done++;
    log(`menu   [${done}/${venues.length}] ${venue.name}: ${result.prices.length} items`);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'wolt.com (Georgia)',
    cities: targetCities,
    brands: targetBrands.filter((b) => venues.some((v) => v.brand === b.slug)),
    crawledBrands: targetBrands.map((b) => b.slug),
    venues: venues.filter((v) => v.itemCount > 0),
    products: [...products.values()],
    prices,
    errors,
  };
}
