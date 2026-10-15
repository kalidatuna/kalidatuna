/*
 * Site adapters: read the board, the move list and the kind of page from the
 * DOM. All site-specific selectors live in this file so they are easy to fix
 * when a site changes its markup.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const FILES = 'abcdefgh';
  const TYPE = { pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k' };

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').trim();
  }

  function translateOf(el) {
    const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*\)/.exec(el.style.transform || '');
    return m ? [Number(m[1]), Number(m[2])] : null;
  }

  /* ------------------------------------------------------------------ lichess */
  const lichess = {
    site: 'lichess',
    matches: (loc) => /(^|\.)lichess\.org$/.test(loc.hostname),

    board(doc) {
      return doc.querySelector('.main-board cg-board') || doc.querySelector('cg-board');
    },

    orientation(doc) {
      const board = this.board(doc);
      const wrap = board && board.closest('.cg-wrap');
      return wrap && wrap.classList.contains('orientation-black') ? 'b' : 'w';
    },

    squareFromTransform(el, size, orientation) {
      const t = translateOf(el);
      if (!t || !size) return null;
      const fx = Math.round(t[0] / size);
      const fy = Math.round(t[1] / size);
      if (fx < 0 || fx > 7 || fy < 0 || fy > 7) return null;
      return orientation === 'w' ? FILES[fx] + (8 - fy) : FILES[7 - fx] + (fy + 1);
    },

    boardSize(board) {
      const container = board.closest('cg-container') || board;
      const w = parseFloat(container.style.width) || board.getBoundingClientRect().width;
      return w / 8;
    },

    pieces(doc) {
      const board = this.board(doc);
      if (!board) return null;
      const size = this.boardSize(board);
      const orientation = this.orientation(doc);
      const out = [];
      for (const el of board.querySelectorAll('piece')) {
        if (el.classList.contains('ghost') || el.classList.contains('fading')) continue;
        const color = el.classList.contains('white') ? 'w' : el.classList.contains('black') ? 'b' : null;
        const typeName = Object.keys(TYPE).find((t) => el.classList.contains(t));
        const sq = this.squareFromTransform(el, size, orientation);
        if (color && typeName && sq) out.push({ sq, color, type: TYPE[typeName] });
      }
      return out;
    },

    lastMove(doc) {
      const board = this.board(doc);
      if (!board) return null;
      const size = this.boardSize(board);
      const orientation = this.orientation(doc);
      return [...board.querySelectorAll('square.last-move')].map((el) => this.squareFromTransform(el, size, orientation)).filter(Boolean);
    },

    moves(doc) {
      // Live/finished game page.
      let nodes = doc.querySelectorAll('rm6 l4x kwdb, rm6 l4x u8t, .moves move');
      if (nodes.length) return [...nodes].map((n) => textOf(n));
      // Analysis / study: main line moves are direct children of .tview2.
      const tview = doc.querySelector('.tview2');
      if (tview) {
        return [...tview.children]
          .filter((c) => c.tagName.toLowerCase() === 'move')
          .map((m) => textOf(m.querySelector('san')) || textOf(m));
      }
      return [];
    },

    signals(doc, loc) {
      const path = loc.pathname;
      const isAnalysis = /^\/(analysis|study|practice|opening|broadcast)(\/|$)/.test(path);
      const isPuzzle = /^\/(training|streak|storm|racer)(\/|$)/.test(path);
      const roundApp = doc.querySelector('.round__app, main.round');
      const meta = textOf(doc.querySelector('.game__meta')) + ' ' + [...doc.querySelectorAll('.ruser, .ruser-top, .ruser-bottom')].map(textOf).join(' ');
      const opponentIsComputer = /stockfish|level \d|\bBOT\b/i.test(meta) || !!doc.querySelector('.ruser .utitle[data-bot], .ruser-top .utitle[data-bot]');
      const isCorrespondence = /correspondence/i.test(meta) || !!doc.querySelector('.rclock-correspondence');
      const gameOver = !!doc.querySelector('.result-wrap, .follow-up, .rcontrols .rematch');
      const isPlayer = !!doc.querySelector('.rcontrols');
      const idMatch = /^\/([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/|$)/.exec(path);
      return {
        isAnalysis,
        isPuzzle,
        isGamePage: !!roundApp && !isAnalysis && !isPuzzle,
        gameOver,
        opponentIsComputer,
        isCorrespondence,
        isPlayer,
        gameId: idMatch ? idMatch[1] : null
      };
    }
  };

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
      const opponentIsComputer = /^\/(play\/computer|game\/computer)(\/|$)/.test(path);
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

  const ADAPTERS = [lichess, chesscom];

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

  CC.Adapters = { lichess, chesscom, forLocation, readPage };
})(globalThis);
