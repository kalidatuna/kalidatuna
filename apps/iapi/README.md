# Iapi (იაფი): cheap eats in Georgia

Iapi finds the cheapest fast-food items and the best current deals at chains in Georgia
(McDonald's, Wendy's, Subway, Domino's, Dunkin', Burger King, Pizza Hut, Shaurma Club and others)
across Tbilisi, Batumi, Kutaisi, Rustavi, Zugdidi and Gori.

It uses real prices: a crawler reads every branch's public Wolt menu and stores the prices, and a small
web app lets you search them.

## What it finds

| Feature | What you get |
| --- | --- |
| **Cheapest items** | Every item ranked by price, with sauces and add-ons hidden by default. Filter by chain, type (mains, combos, sides, drinks, desserts) and max price. |
| **Discounts** | Items Wolt shows with a crossed-out price, with the % off. |
| **Price drops** | Each refresh is compared with the price history, and items that got cheaper are flagged. |
| **Cheapest branch** | The same item can cost different amounts at different branches (for example, McNuggets 6 pcs cost 10.00 ₾ at one branch and 9.30 ₾ at another). Iapi shows where it's cheapest and how much you save. |
| **Branch promotions** | Offers like "12 GEL off (spend 30 GEL)" and free delivery, per branch. |
| **Budget meals** | "I have 10 ₾": the cheapest full meal per chain (a combo, or a main + side + drink from one branch) and the biggest meal that fits your budget. |
| **Near me** | Sorts by distance to the nearest branch (uses your browser location; nothing is stored on the server). |
| **Saved items** | ♥ items to track their price, stored in your browser. |
| **English / ქართული** | One tap switches the interface and item names. |

It works on phones and can be installed as an app (PWA). After the first visit it still opens offline,
showing the last prices it loaded.

## Quick start

Requires **Node.js 20+**. No `npm install` is needed because there are no dependencies.

```bash
cd apps/iapi
npm start            # http://localhost:3000
```

A price snapshot is included in `data/`, so the app works straight away. To fetch fresh prices:

```bash
npm run refresh                                  # all cities and chains (~5–10 min)
npm run refresh -- --city tbilisi                # one city (other cities are kept)
npm run refresh -- --brand mcdonalds,wendys      # some chains only
```

To keep prices fresh automatically, run the server with a refresh interval:

```bash
REFRESH_HOURS=6 PORT=8080 npm start
```

Run the tests:

```bash
npm test
```

## How the data is collected

1. For each city and chain in `config/sources.json`, the crawler asks Wolt for the list of branches
   (`consumer-api.wolt.com/v1/pages/brand/<chain>`). This gives the address, GPS location, rating and promotions.
2. For each branch it downloads the menu in English and Georgian
   (`consumer-api.wolt.com/.../venues/slug/<branch>/assortment`). This gives every item, its price in tetri,
   and the old price when an item is discounted.
3. Items are matched across branches by name, classified (main / combo / side / drink / dessert / extra),
   and saved to `data/snapshot.json`. The lowest price per item per city is added to `data/history.json`,
   which is used to detect price drops.

The crawler sends one request at a time with a pause between requests, and backs off when Wolt asks it to
slow down (HTTP 429).

To add a chain or a city, add its Wolt slug to `config/sources.json`. The chain slug is the last part of
`wolt.com/en/geo/tbilisi/brand/<slug>`.

## API

All prices are in GEL.

| Endpoint | Parameters |
| --- | --- |
| `GET /api/meta` | Snapshot time, cities, chains and counts |
| `GET /api/deals` | `city`, `brand` (comma-separated), `kind`, `q`, `max`, `discounted=1`, `extras=1`, `sort` (`price`, `discount`, `savings`, `drop`, `distance`, `name`), `lat`, `lon`, `limit`, `offset` |
| `GET /api/products/:key` | `city`, `lat`, `lon`: the price at every branch, plus price history |
| `GET /api/venues` | `city`, `brand`, `promo=1`, `lat`, `lon` |
| `GET /api/budget` | `city`, `budget`, `brand`, `lat`, `lon` |
| `GET /api/health` | Whether data is loaded and whether a refresh is running |

Example: the 5 cheapest combos in Batumi:

```bash
curl "http://localhost:3000/api/deals?city=batumi&kind=combo&limit=5"
```

## Project layout

```
config/sources.json   cities and chains to crawl
src/wolt.js           HTTP client (retries, back-off) and Wolt response parsing
src/crawl.js          crawl → normalized snapshot
src/classify.js       item type rules (English + Georgian keywords)
src/deals.js          search, sorting, cheapest branch, budget meals
src/store.js          snapshot + price history files
src/server.js         API + static file server
src/refresh.js        crawl + save (used by the CLI and REFRESH_HOURS)
public/               the web app (vanilla JS, no build step)
test/                 node:test unit and API tests
```

## Limitations

- **These are Wolt delivery prices.** Restaurants often charge more on delivery apps than at the counter,
  so in-store prices can be lower. Branch promotions may need a minimum order or apply only to delivery.
- **Only chains on Wolt are covered.** KFC, for example, isn't on Wolt in Georgia, so it has no prices yet.
  Its slug is in the config, so it is picked up automatically if it joins.
- Item types are assigned by keyword rules, so an unusual item name can land in the wrong group.
- Wolt's endpoints are public but undocumented, and they can change. If a refresh returns no prices, the
  previous snapshot is kept, and the crawl log shows which requests failed.
- Use the crawler for personal, low-volume use, and respect Wolt's terms of service.
