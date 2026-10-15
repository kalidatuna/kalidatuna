/*
 * Floating coach panel injected into the page (inside a shadow root so the
 * site's CSS cannot break it and ours cannot leak out).
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  const CSS = `
  :host { all: initial; }
  .panel {
    --bg: #1f2227; --bg2: #2a2e35; --fg: #e8e6e3; --muted: #a3a8b0; --line: #3a3f47;
    --accent: #7fb45a; --warn: #e3a33c; --info: #6aa4e0; --good: #7fb45a; --live: #d06a5a;
    position: fixed; z-index: 2147483000; width: 330px; max-height: calc(100vh - 40px);
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35);
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: move; user-select: none;
    border-bottom: 1px solid var(--line); background: var(--bg2); border-radius: 10px 10px 0 0; }
  .panel.collapsed .head { border-bottom: 0; border-radius: 10px; }
  .title { font-weight: 700; font-size: 14px; flex: 1; white-space: nowrap; }
  .pill { font-size: 11px; padding: 2px 8px; border-radius: 99px; background: #3a4a33; color: #cfe8bd; white-space: nowrap; }
  .pill.paused { background: #4d2f2a; color: #f2c1b8; }
  .pill.partial { background: #4a4230; color: #f0dcae; }
  button { font: inherit; color: inherit; cursor: pointer; }
  .icon { background: none; border: 0; color: var(--muted); font-size: 16px; padding: 0 4px; line-height: 1; }
  .icon:hover { color: var(--fg); }
  .body { overflow-y: auto; padding: 4px 12px 12px; }
  .panel.collapsed .body { display: none; }
  section { padding: 10px 0; border-bottom: 1px solid var(--line); }
  section:last-child { border-bottom: 0; }
  h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .opening-name { font-size: 15px; font-weight: 700; }
  .eco { color: var(--muted); font-weight: 500; font-size: 12px; margin-left: 4px; }
  p { margin: 4px 0; }
  ul { margin: 4px 0; padding-left: 18px; }
  li { margin: 2px 0; }
  .muted { color: var(--muted); }
  .status { display: inline-block; font-size: 12px; margin-top: 4px; padding: 1px 7px; border-radius: 4px; background: var(--bg2); }
  .status.in { color: var(--good); } .status.out { color: var(--warn); }
  .san { font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .moves { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
  .move { background: var(--bg2); border-radius: 6px; padding: 6px 8px; }
  .move .san { color: #b9e08f; margin-right: 6px; }
  .move .leads { color: var(--muted); font-size: 12px; }
  .tip { border-left: 3px solid var(--info); padding: 2px 0 2px 8px; margin: 6px 0; }
  .tip.warn { border-color: var(--warn); } .tip.good { border-color: var(--good); }
  .meters { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--muted); }
  .meters b { color: var(--fg); }
  .btn { background: var(--bg2); border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; margin-top: 6px; }
  .btn:hover { border-color: var(--accent); }
  .btn.primary { background: #4a6b34; border-color: #5d8541; }
  .note { font-size: 12px; color: var(--muted); }
  .live-note { background: #33231f; border: 1px solid #5a362f; border-radius: 6px; padding: 8px; margin-top: 8px; }
  .traps li { color: #f0dcae; }
  `;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const colorName = (c) => (c === 'w' ? 'White' : 'Black');

  class Panel {
    constructor(opts) {
      this.opts = opts || {};
      this.host = document.createElement('div');
      this.host.id = 'chess-coach-root';
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `<style>${CSS}</style><div class="panel" part="panel"><div class="head"><span class="title">♞ Chess Coach</span><span class="pill"></span><button class="icon" data-action="collapse" title="Collapse">–</button></div><div class="body"></div></div>`;
      this.el = this.shadow.querySelector('.panel');
      this.bodyEl = this.shadow.querySelector('.body');
      this.pillEl = this.shadow.querySelector('.pill');
      document.documentElement.appendChild(this.host);
      this._bindDrag();
      this.shadow.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'collapse') this.setCollapsed(!this.el.classList.contains('collapsed'), true);
        else if (this.opts.onAction) this.opts.onAction(action, btn.dataset);
      });
    }

    setPosition(pos) {
      const x = pos && pos.x != null ? pos.x : Math.max(10, window.innerWidth - 350);
      const y = pos && pos.y != null ? pos.y : 80;
      this.el.style.left = Math.min(Math.max(0, x), window.innerWidth - 60) + 'px';
      this.el.style.top = Math.min(Math.max(0, y), window.innerHeight - 40) + 'px';
    }

    setCollapsed(collapsed, user) {
      this.el.classList.toggle('collapsed', !!collapsed);
      const b = this.shadow.querySelector('[data-action="collapse"]');
      b.textContent = collapsed ? '+' : '–';
      b.title = collapsed ? 'Expand' : 'Collapse';
      if (user && this.opts.onLayout) this.opts.onLayout({ collapsed: !!collapsed });
    }

    setVisible(v) {
      this.host.style.display = v ? '' : 'none';
    }

    _bindDrag() {
      const head = this.shadow.querySelector('.head');
      let start = null;
      head.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return;
        const r = this.el.getBoundingClientRect();
        start = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        head.setPointerCapture(e.pointerId);
      });
      head.addEventListener('pointermove', (e) => {
        if (!start) return;
        this.setPosition({ x: e.clientX - start.dx, y: e.clientY - start.dy });
      });
      head.addEventListener('pointerup', () => {
        if (!start) return;
        start = null;
        const r = this.el.getBoundingClientRect();
        if (this.opts.onLayout) this.opts.onLayout({ x: Math.round(r.left), y: Math.round(r.top) });
      });
    }

    render(vm) {
      const ctx = vm.ctx;
      this.pillEl.textContent = ctx.label;
      const allowAll = ctx.allow.book && ctx.allow.tips;
      this.pillEl.className = 'pill' + (!ctx.allow.book ? ' paused' : allowAll ? '' : ' partial');
      const html = [];

      if (vm.repertoire) html.push(this._repertoire(vm));
      if (vm.emptyGame) html.push('<section><p class="muted">The game ended before any moves were played - nothing to review.</p></section>');
      if (vm.openingOver) html.push(this._openingOver(vm));
      if (vm.review) html.push(this._review(vm));
      if (vm.opening || vm.bookStatus) html.push(this._opening(vm));
      if (vm.lastMove) html.push(this._lastMove(vm));
      if (vm.continuations) html.push(this._continuations(vm));
      if (vm.meters || (vm.tips && vm.tips.length) || (vm.tactics && vm.tactics.length)) html.push(this._tips(vm));
      if (vm.checklist) html.push(this._checklist(vm));
      if (!html.length) html.push(`<section><p class="muted">${esc(ctx.note || 'Waiting for a position...')}</p></section>`);
      this.bodyEl.innerHTML = html.join('');
    }

    _opening(vm) {
      const o = vm.opening;
      const plans = o && o.plans && o.plans[vm.userColor];
      const parts = ['<section><h3>Opening</h3>'];
      if (o) {
        parts.push(`<div class="opening-name">${esc(o.name)}<span class="eco">${esc(o.eco)}</span></div>`);
        if (o.family) parts.push(`<p class="note">Ideas below come from the parent opening, the ${esc(o.family)}.</p>`);
        if (o.summary) parts.push(`<p>${esc(o.summary)}</p>`);
      } else {
        parts.push('<p class="muted">No named opening yet.</p>');
      }
      if (vm.bookStatus) parts.push(`<span class="status ${vm.bookStatus.inBook ? 'in' : 'out'}">${esc(vm.bookStatus.text)}</span>`);
      if (plans && plans.length) {
        parts.push(`<h3 style="margin-top:10px">Your plan as ${colorName(vm.userColor)}</h3><ul>${plans.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`);
      }
      if (o && o.traps && o.traps.length && vm.ctx.allow.book) {
        parts.push(`<h3 style="margin-top:10px">Watch out</h3><ul class="traps">${o.traps.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`);
      }
      if (o) parts.push(`<button class="btn" data-action="drill" data-line="${esc(o.id)}">Drill this opening in the trainer</button>`);
      parts.push('</section>');
      return parts.join('');
    }

    _lastMove(vm) {
      const m = vm.lastMove;
      return `<section><h3>Last move - ${m.byYou ? 'yours' : 'opponent'}</h3>
        <p><span class="san">${esc(m.label)}</span> ${m.inBook ? '<span class="status in">book</span>' : ''}</p>
        ${m.bookNote ? `<p>${esc(m.bookNote)}</p>` : ''}
        ${m.text && m.text !== m.bookNote ? `<p class="${m.bookNote ? 'note' : ''}">${esc(m.text)}</p>` : ''}
        ${!m.inBook && m.firstOut && !m.byYou ? '<p class="note">Your opponent left theory. Ask: what does this move attack, and what did it neglect? Non-book moves are often slower or weaker.</p>' : ''}
      </section>`;
    }

    _continuations(vm) {
      const list = vm.continuations;
      const who = vm.toMoveIsYou ? 'Your book moves' : 'Book replies to expect';
      if (!list.length) return `<section><h3>${who}</h3><p class="muted">The coach's book ends here. Use the principles: develop, castle, fight for the center.</p></section>`;
      if (!vm.revealed) {
        return `<section><h3>${who}</h3><p class="note">${vm.toMoveIsYou ? 'Try to recall the theory first, then check yourself.' : 'Can you guess what your opponent will play?'} (${list.length} known move${list.length > 1 ? 's' : ''})</p><button class="btn primary" data-action="reveal">Show book moves</button></section>`;
      }
      const items = list
        .slice(0, 5)
        .map((c) => `<div class="move"><span class="san">${esc(c.label)}</span>${c.main ? '<span class="status in" style="margin:0 6px 0 0">main line</span>' : ''}${c.opening ? `<span class="leads">${esc(c.opening)}</span>` : c.leadsTo.length ? `<span class="leads">→ ${esc(c.leadsTo.join(', '))}</span>` : ''}${c.note ? `<div>${esc(c.note)}</div>` : ''}</div>`)
        .join('');
      return `<section><h3>${who}</h3><div class="moves">${items}</div></section>`;
    }

    _tips(vm) {
      const parts = ['<section><h3>Coach</h3>'];
      if (vm.meters) {
        const m = vm.meters;
        parts.push(`<div class="meters"><span>Development <b>${m.developed}/4</b></span><span>King <b>${m.castled ? 'castled' : m.castlingRights ? 'not castled yet' : 'no castling'}</b></span></div>`);
      }
      for (const t of (vm.tactics || []).concat(vm.tips || [])) parts.push(`<div class="tip ${esc(t.level)}">${esc(t.text)}</div>`);
      if (!(vm.tips || []).length && !(vm.tactics || []).length) parts.push('<p class="note">No warnings right now. Keep following the principles.</p>');
      parts.push('</section>');
      return parts.join('');
    }

    _repertoire(vm) {
      const items = vm.repertoire
        .filter((r) => r.line)
        .map((r) => {
          const color = r.slot === 'w' ? 'w' : 'b';
          const moves = r.line.sans.map((s, i) => (i % 2 === 0 ? `${i / 2 + 1}.${s}` : s)).join(' ');
          const plans = (r.line.plans[color] || []).slice(0, 2);
          return `<div class="move"><h3>${esc(r.label)}</h3><b>${esc(r.line.name)}</b> <span class="eco">${esc(r.line.eco)}</span>
            <div class="san" style="font-weight:400">${esc(moves)}</div>
            <p class="note">${esc(r.reason)}</p>
            ${plans.length ? `<ul>${plans.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
            <button class="btn" data-action="drill" data-line="${esc(r.line.id)}" data-color="${color}">Drill it first</button></div>`;
        })
        .join('');
      return `<section><h3>Your openings for the next game</h3><p class="note">${esc(vm.ctx.note)}</p><div class="moves">${items}</div></section>`;
    }

    _openingOver(vm) {
      const o = vm.openingOver;
      return `<section><h3>Opening phase over</h3>
        <p>${o.opening ? `You played the <b>${esc(o.opening.name)}</b>.` : 'You left known openings early.'}${o.leftBook ? ` Theory ended at ${esc(o.leftBook)}.` : ''}</p>
        <p class="note">The opening coach steps back now. Your full opening review appears when the game ends.</p>
        ${o.opening ? `<button class="btn" data-action="drill" data-line="${esc(o.opening.id)}">Drill this opening later</button>` : ''}</section>`;
    }

    _checklist(vm) {
      return `<section><div class="live-note">${esc(vm.ctx.note)}</div>
        <h3 style="margin-top:10px">Your own thinking checklist</h3>
        <ul>${vm.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
        <p class="note">Tip: open chess.com's Play page before you start a game - the coach shows which openings to play there.</p></section>`;
    }

    _review(vm) {
      const r = vm.review;
      return `<section><h3>Post-game opening review</h3>
        ${r.opening ? `<p><b>${esc(r.opening.name)}</b> <span class="eco">${esc(r.opening.eco)}</span></p>` : ''}
        ${r.items.map((t) => `<div class="tip ${esc(t.level)}">${esc(t.text)}</div>`).join('')}
        ${vm.recorded ? '<p class="note">Saved to your opening stats (see the extension popup).</p>' : ''}
      </section>`;
    }
  }

  CC.Panel = Panel;
})(globalThis);
