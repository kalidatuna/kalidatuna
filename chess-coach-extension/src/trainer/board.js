/*
 * Minimal interactive chessboard (click-to-move and drag-and-drop).
 * Rules come from chess.js; this class only draws and reports moves.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const { Chess } = root.ChessJS;
  const FILES = 'abcdefgh';

  class Board {
    /**
     * opts: { orientation: 'w'|'b', pieceUrl: (code) => url, onMove: (move) => void }
     * onMove receives { from, to, promotion } for a legal move.
     */
    constructor(el, opts) {
      this.el = el;
      this.opts = Object.assign({ orientation: 'w' }, opts);
      this.orientation = this.opts.orientation;
      this.chess = new Chess();
      this.interactiveColor = null;
      this.selected = null;
      this.lastMove = null;
      this.marks = {};
      this.el.classList.add('cc-board');
      this.el.addEventListener('pointerdown', (e) => this._down(e));
      window.addEventListener('pointermove', (e) => this._move(e));
      window.addEventListener('pointerup', (e) => this._up(e));
      this.render();
    }

    setPosition(fen, lastMove) {
      this.chess = new Chess(fen);
      this.lastMove = lastMove || null;
      this.selected = null;
      this.render();
    }

    setOrientation(o) {
      this.orientation = o;
      this.render();
    }

    /** Only pieces of `color` may be moved (null = board locked). */
    setInteractive(color) {
      this.interactiveColor = color;
      this.selected = null;
      this.render();
    }

    /** marks: { square: 'hint' | 'wrong' | 'good' } */
    setMarks(marks) {
      this.marks = marks || {};
      this.render();
    }

    shake() {
      this.el.classList.remove('shake');
      void this.el.offsetWidth;
      this.el.classList.add('shake');
    }

    _squareAt(clientX, clientY) {
      const r = this.el.getBoundingClientRect();
      const fx = Math.floor(((clientX - r.left) / r.width) * 8);
      const fy = Math.floor(((clientY - r.top) / r.height) * 8);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
      return this.orientation === 'w' ? FILES[fx] + (8 - fy) : FILES[7 - fx] + (fy + 1);
    }

    _canMove(sq) {
      const p = this.chess.get(sq);
      return p && p.color === this.interactiveColor && this.chess.turn() === this.interactiveColor;
    }

    _tryMove(from, to) {
      const legal = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
      if (!legal.length) return false;
      const promotion = legal.some((m) => m.promotion) ? 'q' : undefined;
      this.selected = null;
      if (this.opts.onMove) this.opts.onMove({ from, to, promotion });
      return true;
    }

    _down(e) {
      if (e.button !== 0) return;
      const sq = this._squareAt(e.clientX, e.clientY);
      if (!sq) return;
      if (this.selected && this.selected !== sq && this._tryMove(this.selected, sq)) return;
      if (this._canMove(sq)) {
        this.selected = sq;
        this.drag = { sq, x: e.clientX, y: e.clientY, moved: false };
        this.render();
        e.preventDefault();
      } else {
        this.selected = null;
        this.render();
      }
    }

    _move(e) {
      if (!this.drag) return;
      const img = this.el.querySelector(`[data-sq="${this.drag.sq}"] img`);
      if (!img) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
      img.style.transform = `translate(${dx}px, ${dy}px)`;
      img.style.zIndex = 10;
      img.style.pointerEvents = 'none';
    }

    _up(e) {
      if (!this.drag) return;
      const drag = this.drag;
      this.drag = null;
      if (drag.moved) {
        const to = this._squareAt(e.clientX, e.clientY);
        if (to && to !== drag.sq && this._tryMove(drag.sq, to)) return;
        this.render();
      }
    }

    render() {
      const targets = new Set(this.selected ? this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : []);
      const ranks = this.orientation === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
      const files = this.orientation === 'w' ? FILES.split('') : FILES.split('').reverse();
      const html = [];
      ranks.forEach((r, ri) => {
        files.forEach((f, fi) => {
          const sq = f + r;
          const light = (FILES.indexOf(f) + r) % 2 === 1;
          const p = this.chess.get(sq);
          const cls = ['sq', light ? 'light' : 'dark'];
          if (this.lastMove && (this.lastMove.from === sq || this.lastMove.to === sq)) cls.push('last');
          if (this.selected === sq) cls.push('selected');
          if (this.marks[sq]) cls.push('mark-' + this.marks[sq]);
          if (targets.has(sq)) cls.push(p ? 'target-capture' : 'target');
          const coordFile = ri === 7 ? `<span class="coord file">${f}</span>` : '';
          const coordRank = fi === 0 ? `<span class="coord rank">${r}</span>` : '';
          const img = p ? `<img alt="${p.color}${p.type}" draggable="false" src="${this.opts.pieceUrl(p.color + p.type.toUpperCase())}">` : '';
          html.push(`<div class="${cls.join(' ')}" data-sq="${sq}">${coordRank}${coordFile}${img}</div>`);
        });
      });
      this.el.innerHTML = html.join('');
    }
  }

  CC.Board = Board;
})(globalThis);
