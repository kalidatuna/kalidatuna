/*
 * Small promise wrapper around chrome.storage with a localStorage fallback
 * (used when a page is opened outside the extension, e.g. in tests).
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  const DEFAULT_SETTINGS = {
    enabled: true,
    revealBookMoves: 'click', // 'click' = try to remember first, 'auto' = always show
    showExplanations: true,
    showTips: true,
    showTactics: true,
    recordGames: true,
    panel: { x: null, y: 80, collapsed: false }
  };

  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function lsGet(keys) {
    const out = {};
    for (const k of keys) {
      try {
        const v = root.localStorage && root.localStorage.getItem('chesscoach:' + k);
        if (v !== null && v !== undefined) out[k] = JSON.parse(v);
      } catch (e) {
        /* storage unavailable */
      }
    }
    return out;
  }

  function lsSet(obj) {
    for (const [k, v] of Object.entries(obj)) {
      try {
        root.localStorage && root.localStorage.setItem('chesscoach:' + k, JSON.stringify(v));
      } catch (e) {
        /* storage unavailable */
      }
    }
  }

  function get(keys) {
    if (!hasChrome) return Promise.resolve(lsGet(keys));
    return new Promise((resolve) => chrome.storage.local.get(keys, (v) => resolve(v || {})));
  }

  function set(obj) {
    if (!hasChrome) {
      lsSet(obj);
      return Promise.resolve();
    }
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
  }

  async function getSettings() {
    const { settings } = await get(['settings']);
    return Object.assign({}, DEFAULT_SETTINGS, settings || {}, {
      panel: Object.assign({}, DEFAULT_SETTINGS.panel, (settings && settings.panel) || {})
    });
  }

  async function saveSettings(patch) {
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    await set({ settings: next });
    return next;
  }

  /** Store a finished game summary (deduplicated by id). Keeps the latest 300. */
  async function recordGame(game) {
    const { games } = await get(['games']);
    const list = (games || []).filter((g) => g.id !== game.id);
    list.unshift(game);
    await set({ games: list.slice(0, 300) });
  }

  async function getGames() {
    const { games } = await get(['games']);
    return games || [];
  }

  async function getSrs() {
    const { srs } = await get(['srs']);
    return srs || {};
  }

  async function saveSrs(lineId, record) {
    const all = await getSrs();
    all[lineId] = record;
    await set({ srs: all });
    return all;
  }

  function onChange(cb) {
    if (hasChrome && chrome.storage.onChanged) chrome.storage.onChanged.addListener(cb);
  }

  CC.Storage = { DEFAULT_SETTINGS, get, set, getSettings, saveSettings, recordGame, getGames, getSrs, saveSrs, onChange };
})(globalThis);
