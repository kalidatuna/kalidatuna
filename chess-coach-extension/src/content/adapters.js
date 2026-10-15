/*
 * chess.com adapter: reads the board, the move list and the kind of page from
 * the DOM. All chess.com selectors live in this file so they are easy to fix
 * when the site changes its markup.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const FILES = 'abcdefgh';

  /* ---------------------------------------------------------------- chess.com */
  const chesscom = {
    site: 'chess.com',
    matches: (loc) => /(^|\.)chess\.com$/.test(loc.hostname),

    board(doc) {
      const boards = [...doc.querySelectorAll('wc-chess-board, chess-board')];
      return boards.find((b) => b.offsetParent !== null || b.getClientRects().length) || boards[0] || null;
    },

    orientation(doc) {
      const board = this.board(doc);
      return board && board.classList.contains('flipped') ? 'b' : 'w';
    },

    squareOf(el) {
      const m = /square-(\d)(\d)/.exec(el.className);
      if (!m) return null;
      const f = Number(m[1]);
      const r = Number(m[2]);
      if (f < 1 || f > 8 || r < 1 || r > 8) return null;
      return FILES[f - 1] + r;
    },

    pieces(doc) {
      const board = this.board(doc);
      if (!board) return null;
      const out = [];
      for (const el of board.querySelectorAll('.piece')) {
        if (el.classList.contains('dragging')) continue;
        const code = [...el.classList].find((c) => /^[wb][pnbrqk]$/.test(c));
        const sq = this.squareOf(el);
        if (code && sq) out.push({ sq, color: code[0], type: code[1] });
      }
      return out;
    },

    lastMove(doc) {
      const board = this.board(doc);
      if (!board) return null;
      return [...board.querySelectorAll('.highlight')].map((el) => this.squareOf(el)).filter(Boolean);
    },

    nodeSan(node) {
      // Figurine notation: <span data-figurine="N"></span>f3
      const target = node.querySelector('.node-highlight-content') || node;
      let s = '';
      const walk = (el) => {
        for (const c of el.childNodes) {
          if (c.nodeType === 3) s += c.textContent;
          else if (c.nodeType === 1) {
            if (c.dataset && c.dataset.figurine) s += c.dataset.figurine;
            else if (!/(move-time|clock|eval|annotation)/.test(c.className || '')) walk(c);
          }
        }
      };
      walk(target);
      return s.trim();
    },

    moves(doc) {
      let nodes = doc.querySelectorAll('.main-line-ply');
      if (!nodes.length) nodes = doc.querySelectorAll('wc-simple-move-list .node, .move-list .node, vertical-move-list .node');
      return [...nodes].map((n) => this.nodeSan(n));
    },

    signals(doc, loc) {
      const path = loc.pathname;
      const isAnalysis = /^\/(analysis|explorer|lessons|lesson|learn|drills|openings)(\/|$)/.test(path);
      const isPuzzle = /^\/(puzzles?|solo-chess)(\/|$)/.test(path);
      const opponentIsComputer = /^\/(play\/computer|play\/coach|game\/computer)(\/|$)/.test(path);
      const isCorrespondence = /^\/(daily|game\/daily|play\/daily)(\/|$)/.test(path);
      const isGamePage = !isAnalysis && !isPuzzle && (/^\/(game|live|play)(\/|$)/.test(path) || /^\/(daily)(\/|$)/.test(path)) && !!this.board(doc);
      const gameOver = !!doc.querySelector('.game-over-modal-content, .game-over-modal-shell-content, .game-result, .game-over-header-component');
      const idMatch = /\/(\d{5,})/.exec(path);
      return {
        isAnalysis,
        isPuzzle,
        isGamePage,
        gameOver,
        opponentIsComputer,
        isCorrespondence,
        isPlayer: gameOver && !!doc.querySelector('.game-over-modal-content, .game-over-modal-shell-content'),
        gameId: idMatch ? idMatch[1] : null
      };
    }
  };

  const ADAPTERS = [chesscom];

  function forLocation(loc) {
    return ADAPTERS.find((a) => a.matches(loc)) || null;
  }

  /** Read everything the coach needs from the page. */
  function readPage(adapter, doc, loc) {
    const board = adapter.board(doc);
    if (!board) return null;
    return {
      site: adapter.site,
      sans: adapter.moves(doc),
      pieces: adapter.pieces(doc),
      lastMove: adapter.lastMove(doc),
      orientation: adapter.orientation(doc),
      signals: adapter.signals(doc, loc)
    };
  }

  CC.Adapters = { chesscom, forLocation, readPage };
})(globalThis);
