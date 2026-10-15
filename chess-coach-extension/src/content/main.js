/*
 * Content script entry point: watches the page, rebuilds the view model when
 * the position changes, and renders the panel.
 */
(function (root) {
  const CC = root.ChessCoach;
  if (!CC || root.__chessCoachStarted) return;
  root.__chessCoachStarted = true;

  const adapter = CC.Adapters.forLocation(location);
  if (!adapter) return;

  let settings = CC.Storage.DEFAULT_SETTINGS;
  let panel = null;
  let lastSignature = '';
  const state = { revealedKey: null };
  const recording = new Set();
  const saved = new Set();
  let scheduled = null;

  function ensurePanel() {
    if (panel) return panel;
    panel = new CC.Panel({
      onAction(action, data) {
        if (action === 'reveal') {
          state.revealedKey = lastKey;
          refresh(true);
        } else if (action === 'drill') {
          const msg = { type: 'open-trainer', line: data.line, color: data.color || lastColor };
          try {
            chrome.runtime.sendMessage(msg);
          } catch (e) {
            /* extension reloaded - ignore */
          }
        }
      },
      onLayout(patch) {
        settings = Object.assign({}, settings, { panel: Object.assign({}, settings.panel, patch) });
        CC.Storage.saveSettings({ panel: settings.panel });
      }
    });
    panel.setPosition(settings.panel);
    panel.setCollapsed(settings.panel.collapsed);
    return panel;
  }

  let lastKey = null;
  let lastColor = 'w';

  function refresh(force) {
    scheduled = null;
    if (!settings.enabled) {
      if (panel) panel.setVisible(false);
      return;
    }
    let page;
    try {
      page = CC.Adapters.readPage(adapter, document, location);
    } catch (e) {
      console.warn('[Chess Coach] could not read the page', e);
      return;
    }
    if (!page) {
      if (panel) panel.setVisible(false);
      lastSignature = '';
      return;
    }
    const signature = JSON.stringify([page.sans, page.pieces && page.pieces.map((p) => p.sq + p.color + p.type).sort(), page.orientation, page.signals, state.revealedKey]);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    const vm = CC.buildViewModel(page, settings, state);
    lastKey = vm.key;
    lastColor = vm.userColor;
    if (vm.gameRecord && !recording.has(vm.gameRecord.id)) {
      const id = vm.gameRecord.id;
      recording.add(id);
      CC.Storage.recordGame(vm.gameRecord).then(() => {
        saved.add(id);
        refresh(true);
      });
    }
    vm.recorded = !!(vm.gameRecord && saved.has(vm.gameRecord.id));
    const p = ensurePanel();
    p.setVisible(vm.ctx.name !== 'none');
    p.render(vm);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = setTimeout(refresh, 200);
  }

  async function loadRepertoire() {
    const [srs, games] = await Promise.all([CC.Storage.getSrs(), CC.Storage.getGames()]);
    state.repertoire = CC.Repertoire.suggest(CC.getBook(), srs, games);
  }

  async function start() {
    settings = await CC.Storage.getSettings();
    await loadRepertoire();
    CC.Storage.onChange((changes) => {
      if (changes.srs || changes.games) loadRepertoire().then(() => refresh(true));
      if (changes.settings) {
        const keepPanel = settings.panel;
        settings = Object.assign({}, CC.Storage.DEFAULT_SETTINGS, changes.settings.newValue || {});
        settings.panel = Object.assign({}, CC.Storage.DEFAULT_SETTINGS.panel, keepPanel, (changes.settings.newValue || {}).panel || {});
        refresh(true);
      }
    });
    const observer = new MutationObserver((mutations) => {
      // Ignore changes inside our own panel.
      if (mutations.every((m) => panel && (m.target === panel.host || panel.host.contains(m.target)))) return;
      schedule();
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    setInterval(schedule, 1500); // safety net for changes the observer misses (e.g. SPA navigation)
    refresh(true);
  }

  start();
})(globalThis);
