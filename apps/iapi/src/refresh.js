// Runs a crawl and saves the snapshot plus updated price history.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crawl } from './crawl.js';
import { APP_ROOT, loadData, saveData, updateHistory } from './store.js';

export async function loadConfig() {
  return JSON.parse(await readFile(join(APP_ROOT, 'config', 'sources.json'), 'utf8'));
}

export async function refresh({ log = console.log, cities, brands, delayMs } = {}) {
  const config = await loadConfig();
  const snapshot = await crawl(config, { log, cities, brands, delayMs });
  if (!snapshot.prices.length) throw new Error(`Crawl returned no prices (${snapshot.errors.length} errors); keeping the old snapshot.`);
  const { snapshot: previous, history } = await loadData();
  if (previous && (cities || brands)) mergeInto(snapshot, previous);
  const nextHistory = updateHistory(history, snapshot);
  await saveData(snapshot, nextHistory);
  log(`saved ${snapshot.venues.length} branches, ${snapshot.products.length} products, ${snapshot.prices.length} prices (${snapshot.errors.length} errors)`);
  return { snapshot, history: nextHistory };
}

// A partial crawl (--city / --brand) only replaces the branches it covered, so the
// rest of the previous snapshot is kept.
export function mergeInto(snapshot, previous) {
  const crawledCities = new Set(snapshot.cities.map((c) => c.slug));
  const crawledBrands = new Set(snapshot.crawledBrands ?? snapshot.brands.map((b) => b.slug));
  const covered = (v) => crawledCities.has(v.city) && crawledBrands.has(v.brand);
  const fresh = new Set(snapshot.venues.map((v) => v.slug));
  const keptVenues = previous.venues.filter((v) => !covered(v) && !fresh.has(v.slug));
  const kept = new Set(keptVenues.map((v) => v.slug));
  snapshot.venues = [...snapshot.venues, ...keptVenues];
  snapshot.prices = [...snapshot.prices, ...previous.prices.filter((p) => kept.has(p.venue))];
  const products = new Map(previous.products.map((p) => [p.key, p]));
  for (const p of snapshot.products) products.set(p.key, p);
  const used = new Set(snapshot.prices.map((p) => p.product));
  snapshot.products = [...products.values()].filter((p) => used.has(p.key));
  const bySlug = (list) => [...new Map(list.map((x) => [x.slug, x])).values()];
  snapshot.cities = bySlug([...previous.cities, ...snapshot.cities]);
  const brandsInUse = new Set(snapshot.venues.map((v) => v.brand));
  snapshot.brands = bySlug([...previous.brands, ...snapshot.brands]).filter((b) => brandsInUse.has(b.slug));
  return snapshot;
}
