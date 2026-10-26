import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetMeals, buildIndex, meta, productDetail, queryDeals, queryVenues } from '../src/deals.js';
import { updateHistory } from '../src/store.js';
import { mergeInto } from '../src/refresh.js';
import { sampleSnapshot } from './helpers.js';

const index = buildIndex(sampleSnapshot());

test('offers aggregate prices across branches in a city', () => {
  const { items } = queryDeals(index, { city: 'tbilisi', q: 'big mac', kind: 'main' });
  assert.equal(items.length, 1);
  const [bigMac] = items;
  assert.equal(bigMac.price, 10);
  assert.equal(bigMac.maxPrice, 11);
  assert.equal(bigMac.savings, 1);
  assert.equal(bigMac.branches, 2);
  assert.equal(bigMac.cheapestVenue.slug, 'mcd-center');
});

test('extras are hidden unless asked for', () => {
  const names = (params) => queryDeals(index, { city: 'tbilisi', ...params }).items.map((i) => i.name);
  assert.ok(!names({}).includes('Ketchup'));
  assert.ok(names({ extras: '1' }).includes('Ketchup'));
  assert.deepEqual(names({ kind: 'extra' }), ['Ketchup']);
});

test('default sort is cheapest first and max price filters', () => {
  const { items } = queryDeals(index, { city: 'tbilisi', max: '5' });
  assert.deepEqual(items.map((i) => i.price), [3, 4.45, 4.5, 4.8, 4.95]);
});

test('discount sort and discounted filter', () => {
  const { items } = queryDeals(index, { city: 'tbilisi', discounted: '1', sort: 'discount' });
  assert.equal(items.length, 1);
  assert.equal(items[0].name, 'Cheeseburger');
  assert.equal(items[0].discountPct, 25);
  assert.equal(items[0].originalPrice, 6);
});

test('brand filter, Georgian search and city "all"', () => {
  assert.ok(queryDeals(index, { brand: 'wendys' }).items.every((i) => i.brand === 'wendys'));
  assert.equal(queryDeals(index, { q: 'cheeseburger ka' }).total, 2, 'matches Tbilisi and Batumi');
});

test('distance sort uses the nearest branch', () => {
  const { items } = queryDeals(index, { city: 'tbilisi', q: 'cheeseburger', sort: 'distance', lat: '41.69', lon: '44.80' });
  assert.equal(items[0].nearest.slug, 'mcd-center');
  assert.equal(items[0].nearest.price, 5);
  assert.equal(items[0].nearest.distanceKm, 0);
});

test('pagination', () => {
  const page = queryDeals(index, { city: 'tbilisi', limit: '2', offset: '2' });
  assert.equal(page.items.length, 2);
  assert.equal(page.offset, 2);
  assert.ok(page.total > 4);
});

test('price history marks drops since the previous day', () => {
  const yesterday = sampleSnapshot('2026-10-25T10:00:00.000Z');
  yesterday.prices.find((p) => p.product === 'mcdonalds:fries' && p.venue === 'mcd-vake').price = 495;
  yesterday.prices.find((p) => p.product === 'mcdonalds:fries' && p.venue === 'mcd-center').price = 495;
  let history = updateHistory({}, yesterday);
  const today = sampleSnapshot();
  history = updateHistory(history, today);
  history = updateHistory(history, today); // a second refresh on the same day does not add a point
  assert.equal(history['mcdonalds:fries@tbilisi'].length, 2);
  const idx = buildIndex(today, history);
  const { items } = queryDeals(idx, { city: 'tbilisi', sort: 'drop', discounted: '1' });
  assert.equal(items[0].name, 'French fries');
  assert.equal(items[0].priceDrop, 0.5);
  assert.equal(items[0].previousPrice, 4.95);
});

test('productDetail lists every branch, cheapest first', () => {
  const detail = productDetail(index, 'mcdonalds:cheeseburger', { city: 'tbilisi' });
  assert.deepEqual(detail.branches.map((b) => [b.slug, b.price]), [['mcd-vake', 4.5], ['mcd-center', 5]]);
  assert.equal(productDetail(index, 'nope'), null);
});

test('venues: promotions first, then filters and distance', () => {
  assert.equal(queryVenues(index, { city: 'tbilisi' }).items[0].slug, 'mcd-vake');
  assert.deepEqual(queryVenues(index, { city: 'tbilisi', promo: '1' }).items.map((v) => v.slug), ['mcd-vake']);
  const near = queryVenues(index, { lat: '41.62', lon: '41.64' });
  assert.equal(near.items[0].slug, 'mcd-batumi');
});

test('budget meals: combos or main+side+drink from one branch, no alcohol', () => {
  const { results } = budgetMeals(index, { city: 'tbilisi', budget: '15' });
  const mcd = results.find((r) => r.brand === 'mcdonalds');
  // Cheapest full meal: cheeseburger 4.50 at Vake + fries 4.45 + cola 4.90 = 13.85
  assert.equal(mcd.cheapest.total, 13.85);
  assert.equal(mcd.venue.slug, 'mcd-vake');
  assert.deepEqual(mcd.cheapest.items.map((i) => i.kind), ['main', 'side', 'drink']);
  assert.ok(mcd.fits);
  // Wendy's has no sides: burger + cola (beer is excluded)
  const wendys = results.find((r) => r.brand === 'wendys');
  assert.equal(wendys.cheapest.total, 18.2);
  assert.ok(!wendys.fits);
  assert.equal(wendys.best, null);
  assert.equal(results[0].brand, 'mcdonalds', 'meals that fit come first');
});

test('budget meals: "best" is the biggest meal that fits', () => {
  const { results } = budgetMeals(index, { city: 'tbilisi', budget: '21', brand: 'mcdonalds' });
  const [mcd] = results;
  assert.equal(mcd.best.type, 'meal');
  assert.equal(mcd.best.total, 20.35); // Big Mac 11.00 + fries 4.45 + cola 4.90 at Vake
  const tight = budgetMeals(index, { city: 'tbilisi', budget: '18', brand: 'mcdonalds' }).results[0];
  assert.equal(tight.best.type, 'combo');
  assert.equal(tight.best.total, 17.95);
});

test('meta counts venues per city and brand', () => {
  const m = meta(index);
  assert.deepEqual(m.cities.map((c) => [c.slug, c.venues]), [['tbilisi', 3], ['batumi', 1]]);
  assert.equal(m.brands.find((b) => b.slug === 'mcdonalds').venues, 3);
});

test('mergeInto keeps branches a partial crawl did not cover', () => {
  const previous = sampleSnapshot();
  const fresh = {
    ...sampleSnapshot(),
    cities: [previous.cities[1]],
    brands: [previous.brands[0]],
    crawledBrands: ['mcdonalds'],
    venues: [{ ...previous.venues[3] }],
    prices: [{ venue: 'mcd-batumi', product: 'mcdonalds:cheeseburger', price: 499, originalPrice: null }],
    products: [previous.products[0]],
  };
  const merged = mergeInto(fresh, previous);
  assert.equal(merged.venues.length, 4);
  assert.equal(merged.prices.find((p) => p.venue === 'mcd-batumi').price, 499);
  assert.equal(merged.prices.filter((p) => p.venue === 'mcd-batumi').length, 1);
  assert.deepEqual(merged.cities.map((c) => c.slug).sort(), ['batumi', 'tbilisi']);
  assert.deepEqual(merged.brands.map((b) => b.slug).sort(), ['mcdonalds', 'wendys']);
});
