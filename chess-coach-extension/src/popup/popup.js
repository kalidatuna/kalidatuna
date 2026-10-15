/* Extension popup: settings and a quick look at recent reviews. */
(function () {
  const CC = window.ChessCoach;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const FLAGS = ['enabled', 'showExplanations', 'showTips', 'showTactics', 'recordGames'];

  async function init() {
    const s = await CC.Storage.getSettings();
    for (const f of FLAGS) {
      $(f).checked = !!s[f];
      $(f).addEventListener('change', () => CC.Storage.saveSettings({ [f]: $(f).checked }));
    }
    $('revealAuto').checked = s.revealBookMoves === 'auto';
    $('revealAuto').addEventListener('change', () => CC.Storage.saveSettings({ revealBookMoves: $('revealAuto').checked ? 'auto' : 'click' }));

    $('open-trainer').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/trainer/trainer.html') });
      window.close();
    });

    const srs = await CC.Storage.getSrs();
    const due = Object.values(srs).filter((r) => CC.SRS.isDue(r)).length;
    $('due').textContent = due ? `${due} opening line(s) due for review` : Object.keys(srs).length ? 'No lines due - nice!' : 'Start by drilling an opening you play.';

    const games = (await CC.Storage.getGames()).slice(0, 5);
    $('games').innerHTML = games.length
      ? games
          .map((g) => {
            const left = g.leftBookMove ? `${g.leftBookByYou ? 'You' : 'Opponent'} left book at ${g.leftBookMove}` : 'Stayed in book';
            return `<li>${esc(g.opening ? g.opening.name : 'Unknown opening')} <small>${g.color === 'w' ? 'White' : 'Black'} · ${esc(g.site)} · ${esc(left)}</small></li>`;
          })
          .join('')
      : '<li class="muted">No games reviewed yet.</li>';
  }

  init();
})();
