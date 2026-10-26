import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.js';
import { buildIndex } from '../src/deals.js';
import { sampleSnapshot } from './helpers.js';

let server;
let base;
const state = { index: buildIndex(sampleSnapshot()), refreshing: false };

before(async () => {
  server = createServer(createHandler(state));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const getJson = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test('GET /api/meta', async () => {
  const { status, body } = await getJson('/api/meta');
  assert.equal(status, 200);
  assert.equal(body.totals.venues, 4);
});

test('GET /api/deals with filters', async () => {
  const { body } = await getJson('/api/deals?city=tbilisi&kind=main&sort=price&limit=1');
  assert.equal(body.items[0].name, 'Cheeseburger');
  assert.equal(body.items[0].price, 4.5);
});

test('GET /api/products/:key handles Georgian keys', async () => {
  state.index.products.set('mcdonalds:ბიგ-მაკი', state.index.products.get('mcdonalds:big-mac'));
  const ok = await getJson(`/api/products/${encodeURIComponent('mcdonalds:big-mac')}?city=tbilisi`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.branches[0].price, 10);
  const missing = await getJson('/api/products/nope');
  assert.equal(missing.status, 404);
});

test('GET /api/budget and /api/venues', async () => {
  const budget = await getJson('/api/budget?city=tbilisi&budget=15');
  assert.equal(budget.body.budget, 15);
  const venues = await getJson('/api/venues?city=batumi');
  assert.equal(venues.body.total, 1);
});

test('serves the app shell and blocks path traversal', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(await res.text(), /Iapi/);
  const traversal = await fetch(base + '/..%2Fpackage.json');
  assert.ok([403, 404].includes(traversal.status));
  const unknown = await fetch(base + '/api/unknown');
  assert.equal(unknown.status, 404);
  const post = await fetch(base + '/api/meta', { method: 'POST' });
  assert.equal(post.status, 405);
});

test('responds 503 when there is no data yet', async () => {
  const saved = state.index;
  state.index = null;
  try {
    const { status, body } = await getJson('/api/deals');
    assert.equal(status, 503);
    assert.match(body.error, /npm run refresh/);
    assert.equal((await getJson('/api/health')).body.hasData, false);
  } finally {
    state.index = saved;
  }
});
