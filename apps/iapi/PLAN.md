# Iapi (იაფი): plan

**Goal:** find the cheapest fast-food items and the best deals at chains in Georgia
(McDonald's, Wendy's, Subway, Domino's, Dunkin', Burger King, Pizza Hut, and others),
using live prices instead of guesses.

## Data source

Wolt Georgia publishes public pages and JSON for every venue:

| What | Where | Gives us |
| --- | --- | --- |
| Branch list | `wolt.com/en/geo/<city>/brand/<brand>` (embedded JSON) | name, address, GPS, rating, promotions ("12 GEL off (spend 30 GEL)", free delivery) |
| Menu | `consumer-api.wolt.com/.../venues/slug/<venue>/assortment?language=en\|ka` | every item, price in tetri, `original_price` when discounted, category, image |

Prices differ slightly between branches (for example, McNuggets 6 pcs cost 10.00 ₾ at one branch and 9.30 ₾ at another),
so we crawl **every branch** and show where each item is cheapest.

Limitations: these are Wolt delivery prices, and in-store prices can be lower. KFC, Popeyes and some other
chains are not on Wolt, so they are not covered yet. The crawler is slow on purpose: one request at a time,
with a delay between requests.

## Deal types the app finds

1. **Discounted items**: Wolt shows the old price as `original_price`, so we can show "% off".
2. **Branch promotions**: spend-and-save offers and free delivery, per branch.
3. **Super cheap items**: the cheapest main, side, drink and dessert, with sauces and add-ons hidden by default.
4. **Cheapest branch**: how much you save by ordering an item from the cheapest branch.
5. **Price drops**: each refresh is compared with the price history, and new lows are flagged.
6. **Budget meals**: "I have 10 ₾". The app finds a full meal (a combo, or a main + side + drink) per chain within the budget.

## Architecture (Node 22, zero dependencies)

```
apps/iapi/
  config/sources.json   cities + brand slugs to crawl
  src/wolt.js           polite HTTP client (retries, 429 backoff), HTML/JSON parsers
  src/classify.js       item kind: main / combo / side / drink / dessert / extra
  src/crawl.js          crawl → normalized snapshot
  src/store.js          load snapshot, merge price history
  src/deals.js          search, filter, sort, aggregate, budget builder
  src/server.js         node:http JSON API + static files (+ optional auto-refresh)
  scripts/refresh.js    CLI: npm run refresh
  public/               mobile-first PWA (vanilla JS), EN / ქართული
  data/snapshot.json    latest crawl (committed so the app works out of the box)
  data/history.json     price history used to detect drops
  test/                 node --test unit + API tests with fixtures
```

### API

- `GET /api/meta`: snapshot time, cities, brands, counts
- `GET /api/deals?city&brand&kind&q&max&discounted&sort&lat&lon&limit&offset`: aggregated items
- `GET /api/products/:key?city`: the item's price at every branch
- `GET /api/venues?city&brand&lat&lon`: branches, promotions, distance
- `GET /api/budget?city&budget&brand`: best full meals within a budget

### UI

Tabs: **Deals** (filters, sort, "near me"), **Budget** ("I have X ₾"), **Branches** (promotions, distance,
links to Wolt and Google Maps), **Saved** (favourites in localStorage). Works offline after the first load.

## Milestones

1. Crawler + snapshot + classification (with tests)
2. Deals engine + budget builder (with tests)
3. HTTP API (with tests)
4. Frontend PWA
5. First real crawl, README, commit and push
