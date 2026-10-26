// Snapshot and price-history persistence. Both are plain JSON files in data/.
import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.IAPI_DATA_DIR ?? join(APP_ROOT, 'data');
export const SNAPSHOT_FILE = join(DATA_DIR, 'snapshot.json');
export const HISTORY_FILE = join(DATA_DIR, 'history.json');
export const MAX_HISTORY_POINTS = 90;

export async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// Write to a temp file first so a crash mid-write never leaves a truncated snapshot.
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export const historyKey = (productKey, city) => `${productKey}@${city}`;

// Lowest price of each product per city in this snapshot, in tetri.
export function cityMinPrices(snapshot) {
  const venueCity = new Map(snapshot.venues.map((v) => [v.slug, v.city]));
  const mins = new Map();
  for (const p of snapshot.prices) {
    const city = venueCity.get(p.venue);
    if (!city) continue;
    const key = historyKey(p.product, city);
    const prev = mins.get(key);
    if (prev === undefined || p.price < prev) mins.set(key, p.price);
  }
  return mins;
}

// history: { "<product>@<city>": [{ d: "2026-10-26", p: 445 }, ...] } (oldest first).
// One point per day; a second refresh on the same day overwrites that day's point.
export function updateHistory(history, snapshot) {
  const day = snapshot.generatedAt.slice(0, 10);
  const next = { ...history };
  for (const [key, price] of cityMinPrices(snapshot)) {
    const points = [...(next[key] ?? [])];
    if (points.length && points.at(-1).d === day) points[points.length - 1] = { d: day, p: price };
    else points.push({ d: day, p: price });
    next[key] = points.slice(-MAX_HISTORY_POINTS);
  }
  return next;
}

export async function loadData() {
  const snapshot = await readJson(SNAPSHOT_FILE, null);
  const history = await readJson(HISTORY_FILE, {});
  return { snapshot, history };
}

export async function saveData(snapshot, history) {
  await writeJson(SNAPSHOT_FILE, snapshot);
  await writeJson(HISTORY_FILE, history);
}
