import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, normalizeAssortment, slugify, venueMatchesBrand } from '../src/crawl.js';
import { extractVenues, normalizeVenue, promotionTexts } from '../src/wolt.js';

const rawVenue = (slug, name, lon, lat, extra = {}) => ({
  slug,
  name,
  address: `${name} st`,
  location: [lon, lat],
  rating: { score: 8.8, volume: 4805 },
  online: true,
  promotions: [{ text: '12 GEL off (spend 30 GEL)' }],
  promotions_for_telemetry: [{ text: '0 GEL delivery fee' }],
  ...extra,
});

const brandPage = (venues) => ({ name: 'brand/x', sections: [{ items: venues.map((venue) => ({ template: 'venue-large', venue })) }] });

const assortment = (items, categories) => ({ items, categories });

test('extractVenues finds nested venue objects once each', () => {
  const v = rawVenue('a', "McDonald's A", 44.8, 41.7);
  const page = { sections: [{ items: [{ venue: v }] }, { items: [{ nested: { venue: v } }] }] };
  assert.deepEqual(extractVenues(page).map((x) => x.slug), ['a']);
});

test('normalizeVenue maps coordinates, rating and promotions', () => {
  const v = normalizeVenue(rawVenue('a', "McDonald's A", 44.8, 41.7, { delivery_price_int: 0 }), { city: 'tbilisi', brand: 'mcdonalds' });
  assert.equal(v.lat, 41.7);
  assert.equal(v.lon, 44.8);
  assert.equal(v.rating, 8.8);
  assert.equal(v.deliveryPrice, 0);
  assert.deepEqual(v.promotions, ['12 GEL off (spend 30 GEL)', '0 GEL delivery fee']);
  assert.equal(v.url, 'https://wolt.com/en/geo/tbilisi/restaurant/a');
});

test('promotionTexts de-duplicates badges and promotions', () => {
  const texts = promotionTexts({ promotions: [{ text: 'A' }], badges_v2: [{ icon: 'coupon-fill', text: 'A' }, { icon: 'other', text: 'B' }] });
  assert.deepEqual(texts, ['A']);
});

test('venueMatchesBrand ignores apostrophes and punctuation', () => {
  assert.ok(venueMatchesBrand('Dunkin Mrgvali Baghi', "Dunkin'"));
  assert.ok(venueMatchesBrand("Wendy's Chicken Sanapiro", "Wendy's"));
  assert.ok(!venueMatchesBrand('Shaurma XL', "McDonald's"));
});

test('slugify keeps Georgian letters', () => {
  assert.equal(slugify('ბიგ მაკი'), 'ბიგ-მაკი');
  assert.equal(slugify("Café Latte!"), 'cafe-latte');
});

test('normalizeAssortment merges languages, keeps discounts and skips unavailable items', () => {
  const en = assortment(
    [
      { id: '1', name: 'Cheeseburger', price: 450, original_price: 600, images: [{ url: 'img' }] },
      { id: '2', name: 'Ketchup', price: 185 },
      { id: '3', name: 'Sold out', price: 500, disabled_info: { reason: 'x' } },
      { id: '4', name: 'Free', price: 0 },
      { id: '5', name: 'Cheeseburger', price: 460 },
      { id: '6', name: 'Cola', price: 490, original_price: 490 },
    ],
    [
      { name: 'Sandwiches', item_ids: ['1', '5'] },
      { name: 'Sauces', item_ids: [], subcategories: [{ name: 'Sauces', item_ids: ['2'] }] },
      { name: 'cold drinks', item_ids: ['6'] },
    ],
  );
  const ka = assortment(
    [
      { id: '1', name: 'ჩიზბურგერი' },
      { id: '2', name: 'კეტჩუპი' },
      { id: '5', name: 'ჩიზბურგერი' },
      { id: '6', name: 'კოკა-კოლა' },
    ],
    [],
  );
  const { products, prices } = normalizeAssortment({ brand: 'mcdonalds', venueSlug: 'v1', byLanguage: { en, ka } });
  assert.deepEqual(
    products.map((p) => [p.key, p.kind, p.category]),
    [
      ['mcdonalds:ჩიზბურგერი', 'main', 'Sandwiches'],
      ['mcdonalds:კეტჩუპი', 'extra', 'Sauces'],
      ['mcdonalds:კოკა-კოლა', 'drink', 'cold drinks'],
    ],
  );
  assert.equal(products[0].image, 'img');
  assert.equal(products[0].nameKa, 'ჩიზბურგერი');
  assert.deepEqual(prices[0], { venue: 'v1', product: 'mcdonalds:ჩიზბურგერი', price: 450, originalPrice: 600 });
  assert.equal(prices[2].originalPrice, null, 'original price equal to price is not a discount');
});

test('crawl assigns venues to the most specific brand and drops far-away or unrelated venues', async () => {
  const config = {
    cities: [{ slug: 'tbilisi', lat: 41.7151, lon: 44.8271 }],
    brands: [
      { slug: 'wendys', name: "Wendy's" },
      { slug: 'wendys-chicken', name: "Wendy's Chicken" },
    ],
    crawl: { languages: ['en'] },
  };
  const chicken = rawVenue('wendys-chicken-1', "Wendy's Chicken Sanapiro", 44.8, 41.7);
  const pages = {
    wendys: brandPage([
      rawVenue('wendys-1', "Wendy's Dolidze", 44.75, 41.72),
      chicken,
      rawVenue('wendys-batumi', "Wendy's Batumi", 41.63, 41.62),
      rawVenue('other', 'Shaurma Club', 44.8, 41.7),
    ]),
    'wendys-chicken': brandPage([chicken]),
  };
  const menu = assortment([{ id: '1', name: 'Burger', price: 1325 }], [{ name: 'Burgers', item_ids: ['1'] }]);
  const fetchImpl = async (url) => {
    const brand = url.match(/pages\/brand\/([^?]+)/)?.[1];
    const body = brand ? pages[brand] : menu;
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  const snapshot = await crawl(config, { fetchImpl, delayMs: 0 });
  assert.deepEqual(
    snapshot.venues.map((v) => [v.slug, v.brand]).sort(),
    [
      ['wendys-1', 'wendys'],
      ['wendys-chicken-1', 'wendys-chicken'],
    ],
  );
  assert.equal(snapshot.prices.length, 2);
  assert.deepEqual(new Set(snapshot.products.map((p) => p.key)), new Set(['wendys:burger', 'wendys-chicken:burger']));
  assert.deepEqual(snapshot.errors, []);
});

test('crawl records errors instead of failing the whole run', async () => {
  const config = { cities: [{ slug: 'tbilisi', lat: 41.7, lon: 44.8 }], brands: [{ slug: 'kfc', name: 'KFC' }], crawl: {} };
  const fetchImpl = async () => ({ ok: false, status: 403 });
  const snapshot = await crawl(config, { fetchImpl, delayMs: 0 });
  assert.equal(snapshot.errors.length, 1);
  assert.equal(snapshot.venues.length, 0);
});

test('normalizeAssortment keeps sizes apart when only the category names them', () => {
  const en = assortment(
    [
      { id: '1', name: 'Veggie', price: 1395 },
      { id: '2', name: 'Veggie', price: 2395 },
      { id: '3', name: 'Mexican 18cm', price: 1194 },
    ],
    [
      { name: 'Sandwich 15 Cm.', item_ids: ['1'] },
      { name: 'Sandwich 30 Cm.', item_ids: ['2'] },
      { name: 'Pizza 18 cm', item_ids: ['3'] },
    ],
  );
  const { products } = normalizeAssortment({ brand: 'subway', venueSlug: 'v', byLanguage: { en } });
  assert.deepEqual(products.map((p) => p.name), ['Veggie (15 cm)', 'Veggie (30 cm)', 'Mexican 18cm']);
  assert.equal(new Set(products.map((p) => p.key)).size, 3);
});
