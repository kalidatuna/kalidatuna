/* Opening trainer: learn lines step by step, then drill them with spaced repetition. */
(function () {
  const CC = window.ChessCoach;
  const { Chess } = window.ChessJS;
  const book = CC.getBook();
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const colorName = (c) => (c === 'w' ? 'White' : 'Black');

  const lines = book.lines.slice().sort((a, b) => a.moves.localeCompare(b.moves));

  const state = {
    tab: 'learn',
    line: null,
    replay: null, // { fens, moves, keys }
    ply: 0,
    orientation: 'w',
    srs: {},
    drill: null, // { color, ply, mistakes, triesThisMove, done }
    queue: []
  };

  const board = new CC.Board($('#board'), {
    pieceUrl: (code) => `../../assets/pieces/${code[0]}${code[1]}.svg`,
    onMove: onBoardMove
  });

  /* ------------------------------------------------------------ helpers */
  function replayLine(line) {
    const chess = new Chess();
    const fens = [chess.fen()];
    const moves = [];
    for (const san of line.sans) {
      moves.push(chess.move(san));
      fens.push(chess.fen());
    }
    return { fens, moves, keys: fens.map(CC.positionKey) };
  }

  function noteFor(ply) {
    // Note for the move that reaches `ply`.
    const r = state.replay;
    const san = r.moves[ply - 1].san;
    return book.noteFor(r.keys[ply - 1], san) || CC.Coach.explainMove(r.fens[ply - 1], san, ply > 1 ? r.moves[ply - 2] : null);
  }

  function setFeedback(html, kind) {
    const el = $('#feedback');
    el.className = 'feedback' + (kind ? ' ' + kind : '');
    el.innerHTML = html || '';
  }

  function srsBadge(line) {
    const rec = state.srs[line.id];
    if (!rec) return '<span class="badge new">new</span>';
    if (CC.SRS.isDue(rec)) return '<span class="badge due">due</span>';
    const days = Math.max(1, Math.round((rec.due - Date.now()) / CC.SRS.DAY));
    return `<span class="badge">in ${days}d</span>`;
  }

  function dueLines() {
    return lines.filter((l) => state.srs[l.id] && CC.SRS.isDue(state.srs[l.id]));
  }

  /* ------------------------------------------------------------ picker */
  function renderList() {
    const q = $('#search').value.trim().toLowerCase();
    const side = $('#filter-side').value;
    const items = lines.filter((l) => {
      if (side === 'w' || side === 'b') {
        if (l.side !== side) return false;
      } else if (side === 'due') {
        if (!(state.srs[l.id] && CC.SRS.isDue(state.srs[l.id]))) return false;
      }
      if (!q) return true;
      return (l.name + ' ' + l.eco + ' ' + l.moves).toLowerCase().includes(q);
    });
    $('#line-list').innerHTML = items.length
      ? items
          .map(
            (l) => `<li data-id="${esc(l.id)}" class="${state.line && state.line.id === l.id ? 'active' : ''}">
              <span class="name">${esc(l.name)} <span class="eco">${esc(l.eco)}</span><span class="sub">${esc(formatMoves(l.sans))}</span></span>
              <span class="badge side">${l.side === 'w' ? 'W' : 'B'}</span>${srsBadge(l)}</li>`
          )
          .join('')
      : '<li class="muted">No openings match.</li>';
    $('#due-info').textContent = dueLines().length ? `${dueLines().length} line(s) due for review.` : 'Nothing due right now - pick any line below to drill it.';
  }

  function formatMoves(sans, upTo) {
    const out = [];
    sans.slice(0, upTo == null ? sans.length : upTo).forEach((s, i) => out.push(i % 2 === 0 ? `${i / 2 + 1}.${s}` : s));
    return out.join(' ');
  }

  /* ------------------------------------------------------------ line card */
  function renderLineCard() {
    const l = state.line;
    if (!l) {
      $('#line-card').innerHTML = '<p class="muted">Choose an opening below.</p>';
      return;
    }
    const plans = (c) => (l.plans[c] || []).map((p) => `<li>${esc(p)}</li>`).join('');
    $('#line-card').innerHTML = `
      <h2>${esc(l.name)}<span class="eco">${esc(l.eco)}</span></h2>
      <div class="line-moves">${esc(formatMoves(l.sans))}</div>
      <p>${esc(l.summary || '')}</p>
      <h3>Key idea of the last move</h3><p>${esc(l.why || '')}</p>
      ${l.plans.w && l.plans.w.length ? `<h3>Plans for White</h3><ul>${plans('w')}</ul>` : ''}
      ${l.plans.b && l.plans.b.length ? `<h3>Plans for Black</h3><ul>${plans('b')}</ul>` : ''}
      ${l.traps.length ? `<h3>Traps &amp; pitfalls</h3><ul class="traps">${l.traps.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="row" style="margin-top:12px"><button class="primary" data-act="drill-this">Drill this line</button></div>`;
  }

  function renderMoveList() {
    const r = state.replay;
    if (!r) {
      $('#moves').innerHTML = '';
      return;
    }
    const inDrill = state.tab === 'drill' && state.drill;
    const current = inDrill ? state.drill.ply : state.ply;
    const limit = inDrill ? state.drill.ply : r.moves.length;
    const parts = [];
    for (let i = 0; i < limit; i++) {
      if (i % 2 === 0) parts.push(`<span class="num">${i / 2 + 1}.</span>`);
      const cls = ['mv'];
      if (i + 1 === current) cls.push('current');
      if (!inDrill && i + 1 > current) cls.push('future');
      parts.push(`<span class="${cls.join(' ')}" data-ply="${i + 1}">${esc(r.moves[i].san)}</span>`);
    }
    $('#moves').innerHTML = parts.join(' ');
  }

  /* ------------------------------------------------------------ learn mode */
  function goTo(ply) {
    if (!state.replay) return;
    state.ply = Math.max(0, Math.min(ply, state.replay.moves.length));
    const mv = state.ply > 0 ? state.replay.moves[state.ply - 1] : null;
    board.setPosition(state.replay.fens[state.ply], mv ? { from: mv.from, to: mv.to } : null);
    board.setMarks({});
    const turn = state.replay.fens[state.ply].split(' ')[1];
    board.setInteractive(state.ply < state.replay.moves.length ? turn : null);
    renderNote();
    renderMoveList();
    updateNavButtons();
  }

  function renderNote() {
    const r = state.replay;
    const total = r.moves.length;
    let html;
    if (state.ply === 0) {
      html = `<h3>Start</h3><p>Press ▶ (or →) to step through the line, or try to play the next move yourself on the board.</p>`;
    } else {
      const mv = r.moves[state.ply - 1];
      html = `<p class="move-head"><b>${esc(CC.moveLabel(state.ply, mv.san))}</b> · ${colorName(mv.color)} · move ${state.ply} of ${total}</p><p>${esc(noteFor(state.ply))}</p>`;
    }
    if (state.ply < total) {
      const turn = r.fens[state.ply].split(' ')[1];
      html += `<p class="muted">${colorName(turn)} to move. Can you find the book move?</p>`;
    } else {
      html += `<p class="muted">End of the line. Switch to <b>Drill</b> to test yourself.</p>`;
    }
    $('#note-card').innerHTML = html;
    setFeedback('');
  }

  function updateNavButtons() {
    const learn = state.tab === 'learn' && state.replay;
    for (const id of ['#btn-start', '#btn-prev', '#btn-next', '#btn-end']) $(id).disabled = !learn;
  }

  /* ------------------------------------------------------------ drill mode */
  function drillColor() {
    const v = $('#drill-color').value;
    return v === 'w' || v === 'b' ? v : state.line.side;
  }

  function startDrill() {
    if (!state.line) return;
    const color = drillColor();
    state.drill = { color, ply: 0, mistakes: 0, triesThisMove: 0, done: false };
    state.orientation = color;
    board.setOrientation(color);
    board.setMarks({});
    board.setPosition(state.replay.fens[0]);
    renderDrillCard();
    setFeedback(`Play the <b>${esc(state.line.name)}</b> as ${colorName(color)}.`, 'info');
    renderMoveList();
    continueDrill();
  }

  function continueDrill() {
    const d = state.drill;
    const r = state.replay;
    if (d.ply >= r.moves.length) return finishDrill();
    const turn = r.fens[d.ply].split(' ')[1];
    if (turn !== d.color) {
      board.setInteractive(null);
      setTimeout(() => {
        if (state.drill !== d) return;
        const mv = r.moves[d.ply];
        d.ply++;
        board.setPosition(r.fens[d.ply], { from: mv.from, to: mv.to });
        renderMoveList();
        continueDrill();
      }, 450);
    } else {
      d.triesThisMove = 0;
      board.setInteractive(d.color);
    }
  }

  function drillMove(move) {
    const d = state.drill;
    const r = state.replay;
    const expected = r.moves[d.ply];
    const probe = new Chess(r.fens[d.ply]);
    const played = probe.move(move);
    if (played.san === expected.san) {
      d.ply++;
      board.setMarks({});
      board.setPosition(r.fens[d.ply], { from: expected.from, to: expected.to });
      setFeedback(`✓ <b>${esc(CC.moveLabel(d.ply, expected.san))}</b> - ${esc(noteFor(d.ply))}`, 'good');
      renderMoveList();
      continueDrill();
      return;
    }
    // Wrong move: is it at least another book move?
    const alt = book.continuations(r.keys[d.ply]).find((c) => c.san === played.san);
    board.setPosition(r.fens[d.ply], d.ply > 0 ? { from: r.moves[d.ply - 1].from, to: r.moves[d.ply - 1].to } : null);
    board.setInteractive(d.color);
    board.shake();
    if (alt) {
      board.setMarks({ [expected.from]: 'hint' });
      setFeedback(`<b>${esc(played.san)}</b> is also a book move${alt.opening ? ` (${esc(alt.opening)})` : ''}, but this line continues differently. Try again - the highlighted piece moves.`, 'info');
      return;
    }
    d.mistakes++;
    d.triesThisMove++;
    if (d.triesThisMove === 1) {
      board.setMarks({ [played.from]: 'wrong', [expected.from]: 'hint' });
      setFeedback(`✗ <b>${esc(played.san)}</b> is not the book move. Hint: move the highlighted ${CC.Coach.NAMES[expected.piece]}.`, 'bad');
    } else {
      board.setMarks({ [expected.from]: 'hint', [expected.to]: 'good' });
      setFeedback(`✗ The book move is <b>${esc(expected.san)}</b>: ${esc(noteFor(d.ply + 1))}`, 'bad');
    }
    renderDrillCard();
  }

  async function finishDrill() {
    const d = state.drill;
    if (d.done) return;
    d.done = true;
    board.setInteractive(null);
    const quality = CC.SRS.qualityFromMistakes(d.mistakes);
    const rec = CC.SRS.grade(state.srs[state.line.id], quality);
    state.srs = await CC.Storage.saveSrs(state.line.id, rec);
    const next = rec.interval >= 1 ? `in ${rec.interval} day${rec.interval > 1 ? 's' : ''}` : 'again soon (practice it once more today)';
    state.queue = state.queue.filter((id) => id !== state.line.id);
    const hasNext = state.queue.length > 0;
    setFeedback(
      `${d.mistakes === 0 ? '🎉 Perfect!' : `Line complete with ${d.mistakes} mistake${d.mistakes > 1 ? 's' : ''}.`} Next review ${next}.
       <div class="row" style="margin-top:8px"><button data-act="again">Drill again</button>${hasNext ? `<button class="primary" data-act="next-due">Next due line (${state.queue.length})</button>` : ''}</div>`,
      d.mistakes === 0 ? 'good' : 'info'
    );
    renderDrillCard();
    renderList();
  }

  function renderDrillCard() {
    const d = state.drill;
    const l = state.line;
    if (!l) {
      $('#drill-card').innerHTML = '<p class="muted">Choose an opening below, or review your due lines.</p>';
      return;
    }
    const rec = state.srs[l.id];
    $('#drill-card').innerHTML = `
      <h2>${esc(l.name)}<span class="eco">${esc(l.eco)}</span></h2>
      <p class="muted">${l.sans.length} plies · you play ${colorName(d ? d.color : drillColor())}</p>
      ${d ? `<p>Progress: ${Math.min(d.ply, l.sans.length)}/${l.sans.length} · mistakes: ${d.mistakes}</p>` : ''}
      ${rec ? `<p class="muted">Reviewed ${rec.reps} time(s) in a row correctly · lapses: ${rec.lapses}</p>` : '<p class="muted">Not drilled yet.</p>'}
      ${!d || d.done ? '<button class="primary" data-act="start-drill">Start drill</button>' : ''}`;
  }

  /* ------------------------------------------------------------ progress & guide */
  async function renderProgress() {
    const games = await CC.Storage.getGames();
    const srsIds = Object.keys(state.srs);
    const byOpening = new Map();
    for (const g of games) {
      const name = g.opening ? g.opening.name : 'Unknown / out of book early';
      const e = byOpening.get(name) || { name, id: g.opening && g.opening.id, games: 0, youLeft: 0, plySum: 0, plyCount: 0, color: g.color };
      e.games++;
      if (g.leftBookByYou) e.youLeft++;
      if (g.leftBookPly) {
        e.plySum += g.leftBookPly;
        e.plyCount++;
      }
      byOpening.set(name, e);
    }
    const rows = [...byOpening.values()].sort((a, b) => b.games - a.games);
    const weak = rows.filter((r) => r.youLeft > 0 && r.id).sort((a, b) => b.youLeft / b.games - a.youLeft / a.games).slice(0, 5);
    $('#progress-card').innerHTML = `
      <h2>My progress</h2>
      <div class="kpis">
        <div class="kpi"><b>${games.length}</b>games reviewed</div>
        <div class="kpi"><b>${srsIds.length}</b>lines drilled</div>
        <div class="kpi"><b>${dueLines().length}</b>due now</div>
      </div>
      ${weak.length ? `<h3>Practice these - you leave the book here</h3><ul>${weak.map((w) => `<li><button class="link" data-act="open-line" data-id="${esc(w.id)}">${esc(w.name)}</button> - you left theory first in ${w.youLeft} of ${w.games} game(s)</li>`).join('')}</ul>` : ''}
      <h3>Openings in your games</h3>
      ${rows.length ? `<table class="stats"><tr><th>Opening</th><th>Games</th><th>You left book first</th><th>Avg. book length</th></tr>
        ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.games}</td><td>${r.youLeft}</td><td>${r.plyCount ? 'move ' + Math.ceil(r.plySum / r.plyCount / 2) : '-'}</td></tr>`).join('')}</table>`
        : '<p class="muted">Finish a game on chess.com with the extension enabled and its opening review will show up here.</p>'}`;
  }

  function renderGuide() {
    $('#guide-card').innerHTML = `
      <h2>Opening principles</h2>
      <ul>${CC.PRINCIPLES.opening.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <h3>Thinking checklist (use it every move)</h3>
      <ul>${CC.PRINCIPLES.checklist.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <h3>How to use this trainer</h3>
      <ol>
        <li>Pick 1-2 openings for White and one defense each against 1.e4 and 1.d4.</li>
        <li>Use <b>Learn</b> to walk through the line and read why each move is played.</li>
        <li><b>Drill</b> the line until you play it without mistakes. It will come back for review in 1, 3, 7… days.</li>
        <li>Play games vs the computer on chess.com with the coach panel open, then rated games without it - the post-game review shows where you left the book.</li>
      </ol>`;
  }

  /* ------------------------------------------------------------ wiring */
  function selectLine(id, opts) {
    const line = book.byId.get(id);
    if (!line) return;
    state.line = line;
    state.replay = replayLine(line);
    state.drill = null;
    if (opts && opts.color) $('#drill-color').value = opts.color;
    state.orientation = state.tab === 'drill' ? drillColor() : line.side;
    board.setOrientation(state.orientation);
    renderLineCard();
    renderDrillCard();
    renderList();
    if (state.tab === 'drill') startDrill();
    else goTo(0);
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    for (const t of ['learn', 'drill', 'progress', 'guide']) $('#panel-' + t).hidden = t !== tab;
    if (tab === 'progress') renderProgress();
    if (tab === 'guide') renderGuide();
    if (tab === 'drill' && state.line) startDrill();
    if (tab === 'learn' && state.line) {
      state.drill = null;
      board.setOrientation(state.orientation);
      goTo(state.ply);
    }
    updateNavButtons();
    renderMoveList();
  }

  function onBoardMove(move) {
    if (state.tab === 'drill' && state.drill && !state.drill.done) return drillMove(move);
    if (state.tab === 'learn' && state.replay) {
      const expected = state.replay.moves[state.ply];
      const probe = new Chess(state.replay.fens[state.ply]);
      const played = probe.move(move);
      if (expected && played.san === expected.san) {
        goTo(state.ply + 1);
        setFeedback(`✓ Correct - ${esc(played.san)} is the book move.`, 'good');
      } else {
        goTo(state.ply);
        board.shake();
        setFeedback(`${esc(played.san)} is not the move in this line. Try again or press ▶ to see it.`, 'bad');
      }
    }
  }

  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });
  $('#line-list').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) {
      state.queue = [];
      selectLine(li.dataset.id);
    }
  });
  $('#search').addEventListener('input', renderList);
  $('#filter-side').addEventListener('change', renderList);
  $('#drill-color').addEventListener('change', () => state.tab === 'drill' && state.line && startDrill());
  $('#btn-start').addEventListener('click', () => goTo(0));
  $('#btn-prev').addEventListener('click', () => goTo(state.ply - 1));
  $('#btn-next').addEventListener('click', () => goTo(state.ply + 1));
  $('#btn-end').addEventListener('click', () => state.replay && goTo(state.replay.moves.length));
  $('#btn-flip').addEventListener('click', () => {
    state.orientation = state.orientation === 'w' ? 'b' : 'w';
    board.setOrientation(state.orientation);
  });
  $('#btn-restart').addEventListener('click', () => {
    if (state.tab === 'drill') startDrill();
    else goTo(0);
  });
  $('#btn-hint').addEventListener('click', () => {
    if (!state.replay) return;
    if (state.tab === 'drill' && state.drill && !state.drill.done) {
      const mv = state.replay.moves[state.drill.ply];
      if (!mv) return;
      state.drill.mistakes++;
      board.setMarks({ [mv.from]: 'hint', [mv.to]: 'good' });
      setFeedback(`Hint: ${esc(mv.san)} (counts as a mistake for scheduling).`, 'info');
      renderDrillCard();
    } else if (state.tab === 'learn') {
      const mv = state.replay.moves[state.ply];
      if (mv) board.setMarks({ [mv.from]: 'hint', [mv.to]: 'good' });
    }
  });
  $('#btn-due').addEventListener('click', () => {
    state.queue = dueLines().map((l) => l.id);
    if (!state.queue.length) {
      setFeedback('Nothing is due. Pick any line to drill it.', 'info');
      return;
    }
    selectLine(state.queue[0]);
  });
  $('#moves').addEventListener('click', (e) => {
    const m = e.target.closest('[data-ply]');
    if (m && state.tab === 'learn') goTo(Number(m.dataset.ply));
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'drill-this') setTab('drill');
    else if (act === 'start-drill' || act === 'again') startDrill();
    else if (act === 'next-due' && state.queue.length) selectLine(state.queue[0]);
    else if (act === 'open-line') {
      setTab('learn');
      selectLine(b.dataset.id);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (state.tab !== 'learn' || !state.replay || e.target.matches('input, select')) return;
    if (e.key === 'ArrowRight') goTo(state.ply + 1);
    else if (e.key === 'ArrowLeft') goTo(state.ply - 1);
    else if (e.key === 'Home') goTo(0);
    else if (e.key === 'End') goTo(state.replay.moves.length);
    else return;
    e.preventDefault();
  });

  (async function init() {
    state.srs = await CC.Storage.getSrs();
    const params = new URLSearchParams(location.search);
    const id = params.get('line');
    const color = params.get('color');
    renderList();
    renderLineCard();
    renderDrillCard();
    if (id && book.byId.has(id)) {
      if (color === 'w' || color === 'b') $('#drill-color').value = color;
      setTab(params.get('tab') || 'drill');
      selectLine(id, { color });
    } else {
      selectLine(lines.find((l) => l.id === 'italian-game') ? 'italian-game' : lines[0].id);
    }
  })();
})();
