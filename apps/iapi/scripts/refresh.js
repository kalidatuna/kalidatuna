#!/usr/bin/env node
// Usage: npm run refresh [-- --city tbilisi,batumi] [--brand mcdonalds,wendys] [--delay 700]
import { parseArgs } from 'node:util';
import { refresh } from '../src/refresh.js';

const { values } = parseArgs({
  options: {
    city: { type: 'string' },
    brand: { type: 'string' },
    delay: { type: 'string' },
  },
});
const split = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);

try {
  await refresh({
    cities: split(values.city),
    brands: split(values.brand),
    delayMs: values.delay ? Number(values.delay) : undefined,
  });
} catch (err) {
  console.error(err.message ?? err);
  process.exitCode = 1;
}
