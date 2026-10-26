#!/usr/bin/env node
// Re-applies the item type rules in src/classify.js to the saved snapshot,
// so rule changes take effect without re-crawling Wolt.
import { classifyItem } from '../src/classify.js';
import { SNAPSHOT_FILE, readJson, writeJson } from '../src/store.js';

const snapshot = await readJson(SNAPSHOT_FILE, null);
if (!snapshot) {
  console.error('No snapshot yet. Run `npm run refresh` first.');
  process.exit(1);
}
let changed = 0;
for (const p of snapshot.products) {
  const kind = classifyItem(p);
  if (kind !== p.kind) {
    changed++;
    p.kind = kind;
  }
}
await writeJson(SNAPSHOT_FILE, snapshot);
console.log(`reclassified ${changed} of ${snapshot.products.length} products`);
