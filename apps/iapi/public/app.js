// Iapi front end: vanilla JS, no build step. Talks to the JSON API in src/server.js.

const I18N = {
  en: {
    tagline: 'Cheapest fast food in Georgia',
    city: 'City',
    allCities: 'All cities',
    tabDeals: 'Deals',
    tabBudget: 'Budget',
    tabBranches: 'Branches',
    tabSaved: 'Saved',
    save: 'Save',
    searchPlaceholder: 'Search: burger, cola, nuggets…',
    maxPrice: 'Max price',
    any: 'any',
    onlyDeals: 'Only discounts & price drops',
    sortBy: 'Sort',
    sortPrice: 'Cheapest first',
    sortDiscount: 'Biggest discount',
    sortSavings: 'Most saved at cheapest branch',
    sortDrop: 'Recent price drops',
    sortDistance: 'Nearest branch',
    nearMe: 'Near me',
    loadMore: 'Show more',
    budgetQuestion: 'How much do you want to spend?',
    find: 'Find meals',
    budgetHint: 'A full meal is a combo, or a main + side + drink from the same branch.',
    promoOnly: 'Only branches with promotions',
    savedHint: 'Tap ♥ on any item to track its price here.',
    disclaimer: 'Prices come from Wolt delivery menus. In-store prices can be lower, and promotions may need a minimum order.',
    allFood: 'All food',
    kind_main: 'Mains',
    kind_combo: 'Combos & sets',
    kind_side: 'Sides',
    kind_drink: 'Drinks',
    kind_dessert: 'Desserts',
    kind_extra: 'Sauces & extras',
    allBrands: 'All chains',
    results: (n) => `${n} items`,
    branchesCount: (n) => `${n} branches`,
    off: (p) => `−${p}%`,
    dropped: (d) => `↓ ${d} since last check`,
    saveAt: (s) => `Save ${s} at cheapest branch`,
    atBranches: (n) => (n === 1 ? 'at 1 branch' : `at ${n} branches`),
    cheapestAt: 'Cheapest at',
    nearest: (km) => `${km} km away`,
    hlCheapestMain: 'Cheapest main',
    hlCheapestCombo: 'Cheapest combo',
    hlBiggestDiscount: 'Biggest discount',
    hlBranchSaving: 'Biggest branch price gap',
    noResults: 'Nothing matches. Try removing a filter.',
    noData: 'No price data yet. Run `npm run refresh` on the server.',
    updated: (t) => `Prices updated ${t}`,
    pricesByBranch: 'Price at each branch',
    openWolt: 'Open on Wolt',
    openMap: 'Map',
    history: 'Price history (lowest in city)',
    fitsBudget: 'Fits your budget',
    overBudget: (x) => `Needs ${x} more`,
    bestMeal: 'Biggest meal for your budget',
    cheapestMeal: 'Cheapest full meal',
    combo: 'Combo',
    total: 'Total',
    promotions: 'Promotions',
    noPromotions: 'No current promotions',
    delivery: (p) => (p === 0 ? 'Free delivery' : `Delivery ${p}`),
    rating: (r, n) => `★ ${r} (${n})`,
    savedAt: (p) => `Saved at ${p}`,
    nowCheaper: (d) => `Now ${d} cheaper!`,
    nowPricier: (d) => `Now ${d} more`,
    savedEmpty: 'Nothing saved yet.',
    locating: 'Finding your location…',
    locationFailed: 'Could not get your location.',
    added: 'Saved: you can track the price in the Saved tab',
    removed: 'Removed from saved',
    unavailable: 'No longer listed',
    loadFailed: 'Could not load data. Check your connection.',
  },
  ka: {
    tagline: 'ყველაზე იაფი სწრაფი კვება საქართველოში',
    city: 'ქალაქი',
    allCities: 'ყველა ქალაქი',
    tabDeals: 'შეთავაზებები',
    tabBudget: 'ბიუჯეტი',
    tabBranches: 'ფილიალები',
    tabSaved: 'შენახული',
    save: 'შენახვა',
    searchPlaceholder: 'ძებნა: ბურგერი, კოლა, ნაგეტსი…',
    maxPrice: 'მაქს. ფასი',
    any: 'ნებისმიერი',
    onlyDeals: 'მხოლოდ ფასდაკლებები',
    sortBy: 'დალაგება',
    sortPrice: 'ჯერ იაფი',
    sortDiscount: 'დიდი ფასდაკლება',
    sortSavings: 'ფილიალებს შორის სხვაობა',
    sortDrop: 'ბოლოს გაიაფებული',
    sortDistance: 'უახლოესი ფილიალი',
    nearMe: 'ჩემთან ახლოს',
    loadMore: 'მეტის ნახვა',
    budgetQuestion: 'რამდენის დახარჯვა გინდა?',
    find: 'ძებნა',
    budgetHint: 'სრული კვება = კომბო, ან მთავარი კერძი + გარნირი + სასმელი ერთი ფილიალიდან.',
    promoOnly: 'მხოლოდ აქციიანი ფილიალები',
    savedHint: 'დააჭირე ♥-ს და ფასს აქ გააკონტროლებ.',
    disclaimer: 'ფასები აღებულია Wolt-ის მენიუდან. ადგილზე შეიძლება უფრო იაფი იყოს; აქციებს შეიძლება მინიმალური შეკვეთა სჭირდებოდეს.',
    allFood: 'ყველა საჭმელი',
    kind_main: 'მთავარი',
    kind_combo: 'კომბო და სეტები',
    kind_side: 'გარნირი',
    kind_drink: 'სასმელი',
    kind_dessert: 'დესერტი',
    kind_extra: 'სოუსები',
    allBrands: 'ყველა ქსელი',
    results: (n) => `${n} პროდუქტი`,
    branchesCount: (n) => `${n} ფილიალი`,
    off: (p) => `−${p}%`,
    dropped: (d) => `↓ ${d} გაიაფდა`,
    saveAt: (s) => `დაზოგე ${s} იაფ ფილიალში`,
    atBranches: (n) => `${n} ფილიალში`,
    cheapestAt: 'ყველაზე იაფი:',
    nearest: (km) => `${km} კმ`,
    hlCheapestMain: 'ყველაზე იაფი კერძი',
    hlCheapestCombo: 'ყველაზე იაფი კომბო',
    hlBiggestDiscount: 'დიდი ფასდაკლება',
    hlBranchSaving: 'ფასის სხვაობა ფილიალებში',
    noResults: 'ვერაფერი მოიძებნა. სცადე ფილტრის მოხსნა.',
    noData: 'ფასები ჯერ არ არის. სერვერზე გაუშვი `npm run refresh`.',
    updated: (t) => `ფასები განახლდა ${t}`,
    pricesByBranch: 'ფასი ფილიალების მიხედვით',
    openWolt: 'Wolt-ზე გახსნა',
    openMap: 'რუკა',
    history: 'ფასის ისტორია (ქალაქში მინიმუმი)',
    fitsBudget: 'ბიუჯეტში ჯდება',
    overBudget: (x) => `აკლია ${x}`,
    bestMeal: 'ყველაზე დიდი კვება ამ ფასად',
    cheapestMeal: 'ყველაზე იაფი სრული კვება',
    combo: 'კომბო',
    total: 'ჯამი',
    promotions: 'აქციები',
    noPromotions: 'აქციები არ არის',
    delivery: (p) => (p === 0 ? 'უფასო მიტანა' : `მიტანა ${p}`),
    rating: (r, n) => `★ ${r} (${n})`,
    savedAt: (p) => `შენახვისას ${p}`,
    nowCheaper: (d) => `ახლა ${d}-ით იაფია!`,
    nowPricier: (d) => `ახლა ${d}-ით ძვირია`,
    savedEmpty: 'ჯერ არაფერია შენახული.',
    locating: 'მდებარეობის ძებნა…',
    locationFailed: 'მდებარეობა ვერ მოიძებნა.',
    added: 'შენახულია: ფასს „შენახულში“ ნახავ',
    removed: 'წაიშალა',
    unavailable: 'აღარ იყიდება',
    loadFailed: 'მონაცემები ვერ ჩაიტვირთა.',
  },
};

const KIND_ICON = { main: '🍔', combo: '🍱', side: '🍟', drink: '🥤', dessert: '🍦', extra: '🧂' };
const PAGE = 48;

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`iapi:${key}`);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`iapi:${key}`, JSON.stringify(value));
    } catch {
      /* private mode: preferences just won't persist */
    }
  },
};

const state = {
  lang: storage.get('lang', navigator.language?.startsWith('ka') ? 'ka' : 'en'),
  city: storage.get('city', 'tbilisi'),
  tab: 'deals',
  brands: new Set(),
  kind: 'main',
  q: '',
  max: null,
  discounted: false,
  sort: 'price',
  offset: 0,
  loc: null,
  meta: null,
  branchBrands: new Set(),
  promoOnly: false,
  favorites: storage.get('favorites', {}),
};

const $ = (sel) => document.querySelector(sel);
const t = (key, ...args) => {
  const v = I18N[state.lang][key] ?? I18N.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
};
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const gel = (n) => (n == null ? '' : `${Number(n).toFixed(2)} ₾`);
const itemName = (o) => (state.lang === 'ka' ? o.nameKa || o.name : o.name || o.nameKa);
const brandOf = (slug) => state.meta?.brands.find((b) => b.slug === slug) ?? { name: slug, color: '#555' };
const mapUrl = (v) => `https://www.google.com/maps/search/?api=1&query=${v.lat},${v.lon}`;

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 2600);
}

async function api(path, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, v);
  const res = await fetch(`${path}${qs.size ? `?${qs}` : ''}`);
  if (!res.ok) throw Object.assign(new Error((await res.json().catch(() => ({}))).error ?? res.statusText), { status: res.status });
  return res.json();
}

const locParams = () => (state.loc ? { lat: state.loc.lat.toFixed(5), lon: state.loc.lon.toFixed(5) } : {});

function timeAgo(iso) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  const rtf = new Intl.RelativeTimeFormat(state.lang, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-mins, 'minute');
  if (mins < 48 * 60) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 1440), 'day');
}

// ---------- static text ----------
function applyI18n() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  $('#lang').textContent = state.lang === 'en' ? 'ქა' : 'EN';
  updateMaxOutput();
}

function updateMaxOutput() {
  $('#max-out').textContent = state.max == null ? t('any') : gel(state.max);
}

// ---------- filters ----------
function renderCitySelect() {
  const sel = $('#city');
  const cities = state.meta.cities;
  if (!cities.some((c) => c.slug === state.city) && state.city !== '') state.city = cities[0]?.slug ?? '';
  sel.innerHTML =
    cities.map((c) => `<option value="${esc(c.slug)}">${esc(state.lang === 'ka' ? c.nameKa : c.name)}</option>`).join('') +
    `<option value="">${esc(t('allCities'))}</option>`;
  sel.value = state.city;
}

function brandChips(container, selected, onChange) {
  const brands = state.meta.brands.filter((b) => b.venues > 0);
  container.innerHTML =
    `<button class="chip" type="button" data-brand="" aria-pressed="${selected.size === 0}">${esc(t('allBrands'))}</button>` +
    brands
      .map(
        (b) =>
          `<button class="chip" type="button" data-brand="${esc(b.slug)}" aria-pressed="${selected.has(b.slug)}" style="--c:${esc(b.color)}"><span class="dot"></span>${esc(b.name)}</button>`,
      )
      .join('');
  container.onclick = (e) => {
    const chip = e.target.closest('[data-brand]');
    if (!chip) return;
    const slug = chip.dataset.brand;
    if (!slug) selected.clear();
    else if (selected.has(slug)) selected.delete(slug);
    else selected.add(slug);
    brandChips(container, selected, onChange);
    onChange();
  };
}

function renderKindChips() {
  const kinds = ['', 'main', 'combo', 'side', 'drink', 'dessert', 'extra'];
  const el = $('#kind-chips');
  el.innerHTML = kinds
    .map(
      (k) =>
        `<button class="chip" type="button" data-kind="${k}" aria-pressed="${state.kind === k}">${k ? `<span aria-hidden="true">${KIND_ICON[k]}</span>` : ''}${esc(k ? t(`kind_${k}`) : t('allFood'))}</button>`,
    )
    .join('');
  el.onclick = (e) => {
    const chip = e.target.closest('[data-kind]');
    if (!chip) return;
    state.kind = chip.dataset.kind;
    renderKindChips();
    loadDeals();
  };
}

// ---------- deals ----------
function offerBadges(o) {
  const out = [];
  if (o.discountPct > 0) out.push(`<span class="badge deal">${esc(t('off', o.discountPct))}</span>`);
  if (o.priceDrop > 0) out.push(`<span class="badge good">${esc(t('dropped', gel(o.priceDrop)))}</span>`);
  if (o.savings >= 0.1) out.push(`<span class="badge">${esc(t('saveAt', gel(o.savings)))}</span>`);
  return out.join('');
}

function offerCard(o) {
  const brand = brandOf(o.brand);
  const fav = Boolean(state.favorites[o.id]);
  const where = o.nearest
    ? `${esc(o.nearest.name)} · ${esc(t('nearest', o.nearest.distanceKm))}`
    : `${esc(t('cheapestAt'))} ${esc(o.cheapestVenue.name)}`;
  return `<article class="card">
    <button class="card-open" type="button" data-open="${esc(o.key)}" data-city="${esc(o.city)}">
      <div class="thumb">${o.image ? `<img src="${esc(o.image)}" alt="" loading="lazy" decoding="async">` : KIND_ICON[o.kind] ?? '🍽️'}</div>
      <div class="body">
        <div class="name">${esc(itemName(o))}</div>
        <div class="price-row"><span class="price">${gel(o.nearest?.price ?? o.price)}</span>${o.originalPrice ? `<span class="was">${gel(o.originalPrice)}</span>` : ''}</div>
        <div class="badges">${offerBadges(o)}</div>
        <div class="meta">${where} · ${esc(t('atBranches', o.branches))}</div>
      </div>
    </button>
    <span class="brand-tag" style="--c:${esc(brand.color)}">${esc(brand.name)}</span>
    <button class="fav" type="button" data-fav="${esc(o.id)}" aria-pressed="${fav}" aria-label="Save">${fav ? '♥' : '♡'}</button>
  </article>`;
}

let lastDeals = [];
let dealsRequest = 0;

function dealParams(extra = {}) {
  return {
    city: state.city,
    brand: [...state.brands].join(','),
    kind: state.kind,
    q: state.q,
    max: state.max,
    discounted: state.discounted ? '1' : '',
    sort: state.sort,
    ...locParams(),
    ...extra,
  };
}

async function loadDeals({ append = false } = {}) {
  const req = ++dealsRequest;
  if (!append) {
    state.offset = 0;
    $('#deals').innerHTML = '<div class="skeleton"></div>'.repeat(6);
  }
  try {
    const data = await api('/api/deals', dealParams({ limit: PAGE, offset: state.offset }));
    if (req !== dealsRequest) return;
    lastDeals = append ? [...lastDeals, ...data.items] : data.items;
    $('#deals-count').textContent = t('results', data.total);
    $('#deals').innerHTML = lastDeals.length ? lastDeals.map(offerCard).join('') : `<p class="empty">${esc(t('noResults'))}</p>`;
    $('#more').hidden = data.offset + data.items.length >= data.total;
  } catch (err) {
    if (req === dealsRequest) $('#deals').innerHTML = `<p class="empty">${esc(err.status === 503 ? t('noData') : t('loadFailed'))}</p>`;
  }
}

async function loadHighlights() {
  const base = { city: state.city, limit: 1 };
  const picks = [
    ['hlCheapestMain', { ...base, kind: 'main', sort: 'price' }, (o) => gel(o.price)],
    ['hlCheapestCombo', { ...base, kind: 'combo', sort: 'price' }, (o) => gel(o.price)],
    ['hlBiggestDiscount', { ...base, discounted: '1', sort: 'discount' }, (o) => (o.discountPct ? t('off', o.discountPct) : gel(o.priceDrop))],
    ['hlBranchSaving', { ...base, sort: 'savings' }, (o) => gel(o.savings)],
  ];
  const results = await Promise.all(picks.map(([, params]) => api('/api/deals', params).catch(() => null)));
  $('#highlights').innerHTML = picks
    .map(([label, , value], i) => {
      const o = results[i]?.items[0];
      if (!o || (label === 'hlBranchSaving' && !o.savings)) return '';
      return `<button class="highlight" type="button" data-open="${esc(o.key)}" data-city="${esc(o.city)}">
        <div class="label">${esc(t(label))}</div>
        <div class="value">${esc(value(o))}</div>
        <div class="what">${esc(itemName(o))} · ${esc(brandOf(o.brand).name)}</div>
      </button>`;
    })
    .join('');
}

// ---------- product detail ----------
function sparkline(points) {
  if (!points || points.length < 2) return '';
  const w = 300;
  const h = 60;
  const prices = points.map((p) => p.price);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const x = (i) => (i / (points.length - 1)) * (w - 8) + 4;
  const y = (p) => (hi === lo ? h / 2 : h - 6 - ((p - lo) / (hi - lo)) * (h - 12));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(t('history'))}"><path d="${d}"/><circle cx="${x(points.length - 1)}" cy="${y(prices.at(-1))}" r="3"/></svg>
    <p class="muted small">${esc(points[0].date)}: ${gel(points[0].price)} → ${esc(points.at(-1).date)}: ${gel(points.at(-1).price)}</p>`;
}

async function openDetail(key, city) {
  const dialog = $('#detail');
  const content = $('#detail-content');
  content.innerHTML = '<div class="skeleton"></div>';
  if (!dialog.open) dialog.showModal();
  try {
    const data = await api(`/api/products/${encodeURIComponent(key)}`, { city, ...locParams() });
    const p = data.product;
    const brand = brandOf(p.brand);
    const id = `${key}@${city}`;
    const fav = Boolean(state.favorites[id]);
    const history = data.history[city] ?? [];
    content.innerHTML = `
      ${p.image ? `<img class="detail-img" src="${esc(p.image)}" alt="">` : ''}
      <div class="detail-head">
        <span class="badge" style="background:${esc(brand.color)};color:#fff;justify-self:start">${esc(brand.name)}</span>
        <h2 id="detail-title">${esc(itemName(p))}</h2>
        ${p.description ? `<p class="muted small">${esc(p.description)}</p>` : ''}
        <div class="price-row"><span class="price">${gel(data.branches[0]?.price)}</span>
          <button class="ghost" type="button" data-fav-detail="${esc(id)}" aria-pressed="${fav}">${fav ? `♥ ${esc(t('tabSaved'))}` : `♡ ${esc(t('save'))}`}</button></div>
      </div>
      ${history.length > 1 ? `<h3 class="small">${esc(t('history'))}</h3>${sparkline(history)}` : ''}
      <h3 class="small">${esc(t('pricesByBranch'))}</h3>
      <div>${data.branches
        .map(
          (b) => `<div class="branch-row">
            <div><strong>${esc(b.name)}</strong><div class="muted small">${esc(b.address)}${b.distanceKm != null ? ` · ${esc(t('nearest', b.distanceKm))}` : ''}</div>
              <div class="links"><a href="${esc(b.url)}" target="_blank" rel="noopener">${esc(t('openWolt'))}</a><a href="${esc(mapUrl(b))}" target="_blank" rel="noopener">${esc(t('openMap'))}</a></div></div>
            <div class="bprice">${gel(b.price)}${b.originalPrice ? `<div class="was small">${gel(b.originalPrice)}</div>` : ''}</div>
          </div>`,
        )
        .join('')}</div>`;
    content.querySelector('[data-fav-detail]').onclick = (e) => {
      toggleFavorite(id, { key, city, name: p.name, nameKa: p.nameKa, brand: p.brand, image: p.image, price: data.branches[0]?.price });
      const on = Boolean(state.favorites[id]);
      e.currentTarget.setAttribute('aria-pressed', on);
      e.currentTarget.textContent = on ? `♥ ${t('tabSaved')}` : `♡ ${t('save')}`;
    };
  } catch {
    content.innerHTML = `<p class="empty">${esc(t('loadFailed'))}</p>`;
  }
}

// ---------- favourites ----------
function toggleFavorite(id, info) {
  if (state.favorites[id]) {
    delete state.favorites[id];
    toast(t('removed'));
  } else {
    state.favorites[id] = { ...info, savedPrice: info.price, savedAt: new Date().toISOString() };
    toast(t('added'));
  }
  storage.set('favorites', state.favorites);
  for (const btn of document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`)) {
    const on = Boolean(state.favorites[id]);
    btn.setAttribute('aria-pressed', on);
    btn.textContent = on ? '♥' : '♡';
  }
  if (state.tab === 'saved') loadSaved();
}

async function loadSaved() {
  const favs = Object.entries(state.favorites);
  const el = $('#saved');
  if (!favs.length) {
    el.innerHTML = `<p class="empty">${esc(t('savedEmpty'))}</p>`;
    return;
  }
  const details = await Promise.all(
    favs.map(([, f]) => api(`/api/products/${encodeURIComponent(f.key)}`, { city: f.city }).catch(() => null)),
  );
  el.innerHTML = favs
    .map(([id, f], i) => {
      const now = details[i]?.branches[0]?.price ?? null;
      const brand = brandOf(f.brand);
      let change = '';
      if (now == null) change = `<span class="badge">${esc(t('unavailable'))}</span>`;
      else if (now < f.savedPrice) change = `<span class="badge good">${esc(t('nowCheaper', gel(f.savedPrice - now)))}</span>`;
      else if (now > f.savedPrice) change = `<span class="badge deal">${esc(t('nowPricier', gel(now - f.savedPrice)))}</span>`;
      return `<article class="card">
        <button class="card-open" type="button" data-open="${esc(f.key)}" data-city="${esc(f.city)}">
          <div class="thumb">${f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : '🍽️'}</div>
          <div class="body">
            <div class="name">${esc(itemName(f))}</div>
            <div class="price-row"><span class="price">${gel(now)}</span></div>
            <div class="badges">${change}</div>
            <div class="meta">${esc(t('savedAt', gel(f.savedPrice)))}</div>
          </div>
        </button>
        <span class="brand-tag" style="--c:${esc(brand.color)}">${esc(brand.name)}</span>
        <button class="fav" type="button" data-fav="${esc(id)}" aria-pressed="true" aria-label="Remove">♥</button>
      </article>`;
    })
    .join('');
}

// ---------- budget ----------
function mealLines(meal) {
  return meal.items
    .map((i) => `<div class="line"><span>${KIND_ICON[i.kind] ?? ''} ${esc(itemName(i))}</span><span>${gel(i.price)}</span></div>`)
    .join('');
}

async function loadBudget() {
  const budget = Number($('#budget').value) || 10;
  const el = $('#budget-results');
  el.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  try {
    const data = await api('/api/budget', { city: state.city, budget, ...locParams() });
    if (!data.results.length) {
      el.innerHTML = `<p class="empty">${esc(t('noResults'))}</p>`;
      return;
    }
    el.innerHTML = data.results
      .map((r) => {
        const brand = brandOf(r.brand);
        const best = r.best;
        const sameAsCheapest = best && best.total === r.cheapest.total && best.items.length === r.cheapest.items.length;
        return `<section class="panel branded" style="--c:${esc(brand.color)}">
          <header>
            <div><h3>${esc(r.venue.name)}</h3>
              <div class="muted small">${esc(r.venue.address)}${r.venue.distanceKm != null ? ` · ${esc(t('nearest', r.venue.distanceKm))}` : ''}</div></div>
            ${r.fits ? `<span class="badge good">${esc(t('fitsBudget'))}</span>` : `<span class="badge deal">${esc(t('overBudget', gel(r.cheapest.total - data.budget)))}</span>`}
          </header>
          ${best ? `<h4 class="small muted">${esc(t('bestMeal'))}</h4>${mealLines(best)}<div class="line total"><span>${esc(t('total'))}</span><span>${gel(best.total)}</span></div>` : ''}
          ${!sameAsCheapest ? `<h4 class="small muted">${esc(t('cheapestMeal'))}</h4>${mealLines(r.cheapest)}<div class="line total"><span>${esc(t('total'))}</span><span>${gel(r.cheapest.total)}</span></div>` : ''}
          <div class="links"><a href="${esc(r.venue.url)}" target="_blank" rel="noopener">${esc(t('openWolt'))}</a><a href="${esc(mapUrl(r.venue))}" target="_blank" rel="noopener">${esc(t('openMap'))}</a></div>
        </section>`;
      })
      .join('');
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.status === 503 ? t('noData') : t('loadFailed'))}</p>`;
  }
}

// ---------- branches ----------
async function loadBranches() {
  const el = $('#branches');
  el.innerHTML = '<div class="skeleton"></div>'.repeat(3);
  try {
    const data = await api('/api/venues', {
      city: state.city,
      brand: [...state.branchBrands].join(','),
      promo: state.promoOnly ? '1' : '',
      ...locParams(),
    });
    $('#branches-count').textContent = t('branchesCount', data.total);
    el.innerHTML = data.items.length
      ? data.items
          .map((v) => {
            const brand = brandOf(v.brand);
            const promos = v.promotions.length
              ? v.promotions.map((p) => `<span class="badge deal">🏷️ ${esc(p)}</span>`).join('')
              : `<span class="muted small">${esc(t('noPromotions'))}</span>`;
            const facts = [
              v.distanceKm != null ? t('nearest', v.distanceKm) : null,
              v.rating != null ? t('rating', v.rating, v.ratingCount) : null,
              v.deliveryPrice != null ? t('delivery', v.deliveryPrice === 0 ? 0 : gel(v.deliveryPrice)) : null,
            ].filter(Boolean);
            return `<section class="panel branded" style="--c:${esc(brand.color)}">
              <header><div><h3>${esc(v.name)}</h3>
                <div class="muted small">${esc(v.address)}</div></div></header>
              <div class="badges">${promos}</div>
              <p class="muted small">${facts.map(esc).join(' · ')}</p>
              <div class="links"><a href="${esc(v.url)}" target="_blank" rel="noopener">${esc(t('openWolt'))}</a><a href="${esc(mapUrl(v))}" target="_blank" rel="noopener">${esc(t('openMap'))}</a></div>
            </section>`;
          })
          .join('')
      : `<p class="empty">${esc(t('noResults'))}</p>`;
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.status === 503 ? t('noData') : t('loadFailed'))}</p>`;
  }
}

// ---------- navigation ----------
function showTab(tab) {
  state.tab = tab;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${tab}`;
  if (tab === 'budget') loadBudget();
  if (tab === 'branches') loadBranches();
  if (tab === 'saved') loadSaved();
  window.scrollTo({ top: 0 });
}

function refreshAll() {
  loadDeals();
  loadHighlights();
  if (state.tab !== 'deals') showTab(state.tab);
}

function locate() {
  if (!navigator.geolocation) return toast(t('locationFailed'));
  toast(t('locating'));
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      for (const b of [$('#locate'), $('#locate2')]) b.setAttribute('aria-pressed', 'true');
      state.sort = 'distance';
      $('#sort').value = 'distance';
      refreshAll();
    },
    () => toast(t('locationFailed')),
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
  );
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function bindEvents() {
  $('#lang').onclick = () => {
    state.lang = state.lang === 'en' ? 'ka' : 'en';
    storage.set('lang', state.lang);
    applyI18n();
    renderCitySelect();
    renderKindChips();
    brandChips($('#brand-chips'), state.brands, loadDeals);
    brandChips($('#branch-brand-chips'), state.branchBrands, loadBranches);
    renderBudgetQuick();
    renderUpdated();
    refreshAll();
  };
  $('#city').onchange = (e) => {
    state.city = e.target.value;
    storage.set('city', state.city);
    refreshAll();
  };
  for (const b of document.querySelectorAll('[data-tab]')) b.onclick = () => showTab(b.dataset.tab);
  $('#q').oninput = debounce((e) => {
    state.q = e.target.value;
    loadDeals();
  }, 250);
  $('#max').oninput = (e) => {
    const v = Number(e.target.value);
    state.max = v >= Number(e.target.max) ? null : v;
    updateMaxOutput();
  };
  $('#max').onchange = () => loadDeals();
  $('#discounted').onchange = (e) => {
    state.discounted = e.target.checked;
    loadDeals();
  };
  $('#sort').onchange = (e) => {
    state.sort = e.target.value;
    if (state.sort === 'distance' && !state.loc) return locate();
    loadDeals();
  };
  $('#locate').onclick = locate;
  $('#locate2').onclick = locate;
  $('#more').onclick = () => {
    state.offset += PAGE;
    loadDeals({ append: true });
  };
  $('#promo-only').onchange = (e) => {
    state.promoOnly = e.target.checked;
    loadBranches();
  };
  $('#budget-form').onsubmit = (e) => {
    e.preventDefault();
    loadBudget();
  };
  document.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (fav) {
      const id = fav.dataset.fav;
      const o = lastDeals.find((d) => d.id === id);
      const info = o
        ? { key: o.key, city: o.city, name: o.name, nameKa: o.nameKa, brand: o.brand, image: o.image, price: o.price }
        : state.favorites[id];
      if (info) toggleFavorite(id, info);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) openDetail(open.dataset.open, open.dataset.city);
  });
  const dialog = $('#detail');
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
  });
}

function renderBudgetQuick() {
  const el = $('#budget-quick');
  el.innerHTML = [5, 8, 10, 15, 20, 30].map((n) => `<button class="chip" type="button" data-budget="${n}">${n} ₾</button>`).join('');
  el.onclick = (e) => {
    const chip = e.target.closest('[data-budget]');
    if (!chip) return;
    $('#budget').value = chip.dataset.budget;
    loadBudget();
  };
}

function renderUpdated() {
  if (state.meta) $('#updated').textContent = t('updated', timeAgo(state.meta.generatedAt));
}

async function init() {
  applyI18n();
  bindEvents();
  renderBudgetQuick();
  renderKindChips();
  try {
    state.meta = await api('/api/meta');
  } catch (err) {
    $('#deals').innerHTML = `<p class="empty">${esc(err.status === 503 ? t('noData') : t('loadFailed'))}</p>`;
    return;
  }
  renderCitySelect();
  renderUpdated();
  brandChips($('#brand-chips'), state.brands, loadDeals);
  brandChips($('#branch-brand-chips'), state.branchBrands, loadBranches);
  refreshAll();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

init();
