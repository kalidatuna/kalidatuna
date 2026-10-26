// HTTP server: JSON API under /api and the PWA from public/. No dependencies.
//   PORT=3000            port to listen on
//   REFRESH_HOURS=6      re-crawl Wolt in the background every N hours (off when unset)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, loadData } from './store.js';
import { budgetMeals, buildIndex, meta, productDetail, queryDeals, queryVenues } from './deals.js';
import { refresh } from './refresh.js';

const PUBLIC_DIR = join(APP_ROOT, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(req, res, status, body, type, extraHeaders = {}) {
  const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', ...extraHeaders };
  let payload = typeof body === 'string' ? Buffer.from(body) : body;
  if (payload.length > 1024 && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '') && !type.startsWith('image/png')) {
    payload = gzipSync(payload);
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  headers['content-length'] = payload.length;
  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

const sendJson = (req, res, status, value) =>
  send(req, res, status, JSON.stringify(value), MIME['.json'], { 'cache-control': 'no-cache' });

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + sep)) return sendJson(req, res, 403, { error: 'forbidden' });
  try {
    if (!(await stat(file)).isFile()) throw Object.assign(new Error(), { code: 'ENOENT' });
    const type = MIME[extname(file)] ?? 'application/octet-stream';
    // index.html and the service worker must revalidate so updates reach users.
    const cache = /(index\.html|sw\.js)$/.test(file) ? 'no-cache' : 'public, max-age=3600';
    return send(req, res, 200, await readFile(file), type, { 'cache-control': cache });
  } catch (err) {
    if (err.code === 'ENOENT') return sendJson(req, res, 404, { error: 'not found' });
    throw err;
  }
}

// state: { index, refreshing, lastRefresh } – mutable so background refreshes can swap the index.
export function createHandler(state) {
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    const params = Object.fromEntries(url.searchParams);
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(req, res, 405, { error: 'method not allowed' });
      if (!pathname.startsWith('/api/')) return await serveStatic(req, res, pathname);
      if (pathname === '/api/health') return sendJson(req, res, 200, { ok: true, hasData: !!state.index, refreshing: state.refreshing, lastRefresh: state.lastRefresh ?? null });
      if (!state.index) return sendJson(req, res, 503, { error: 'No price data yet. Run `npm run refresh` first.' });
      const { index } = state;
      switch (pathname) {
        case '/api/meta':
          return sendJson(req, res, 200, meta(index));
        case '/api/deals':
          return sendJson(req, res, 200, queryDeals(index, params));
        case '/api/venues':
          return sendJson(req, res, 200, queryVenues(index, params));
        case '/api/budget':
          return sendJson(req, res, 200, budgetMeals(index, params));
      }
      if (pathname.startsWith('/api/products/')) {
        const detail = productDetail(index, decodeURIComponent(pathname.slice('/api/products/'.length)), params);
        return detail ? sendJson(req, res, 200, detail) : sendJson(req, res, 404, { error: 'product not found' });
      }
      return sendJson(req, res, 404, { error: 'not found' });
    } catch (err) {
      console.error(err);
      return sendJson(req, res, 500, { error: 'internal error' });
    }
  };
}

export async function loadState() {
  const { snapshot, history } = await loadData();
  return { index: snapshot ? buildIndex(snapshot, history) : null, refreshing: false };
}

async function main() {
  const state = await loadState();
  const port = Number(process.env.PORT ?? 3000);
  createServer(createHandler(state)).listen(port, () => {
    console.log(`Iapi running at http://localhost:${port}`);
    if (!state.index) console.log('No data yet: run `npm run refresh` (takes a few minutes).');
    else console.log(`Loaded ${state.index.offers.length} offers from snapshot of ${state.index.snapshot.generatedAt}`);
  });

  const hours = Number(process.env.REFRESH_HOURS ?? 0);
  if (hours > 0) {
    const run = async () => {
      if (state.refreshing) return;
      state.refreshing = true;
      try {
        const { snapshot, history } = await refresh({ log: (m) => console.log(`[refresh] ${m}`) });
        state.index = buildIndex(snapshot, history);
        state.lastRefresh = snapshot.generatedAt;
      } catch (err) {
        console.error('[refresh] failed:', err);
      } finally {
        state.refreshing = false;
      }
    };
    setInterval(run, hours * 3600 * 1000).unref();
    const ageHours = state.index ? (Date.now() - Date.parse(state.index.snapshot.generatedAt)) / 3600000 : Infinity;
    if (ageHours > hours) run();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
