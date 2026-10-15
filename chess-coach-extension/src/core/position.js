/*
 * Reconciles what the site shows: the move list (best - gives move order and
 * history) and the pieces on the board (always available, but no history).
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const { Chess } = root.ChessJS;
  const FILES = 'abcdefgh';

  /** pieces: [{ sq: 'e4', color: 'w'|'b', type: 'p'|'n'|... }] -> FEN placement field */
  function placementFromPieces(pieces) {
    const grid = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (const p of pieces) {
      const f = FILES.indexOf(p.sq[0]);
      const r = Number(p.sq[1]) - 1;
      if (f < 0 || r < 0 || r > 7) continue;
      grid[r][f] = p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase();
    }
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const c = grid[r][f];
        if (!c) empty++;
        else {
          if (empty) row += empty;
          empty = 0;
          row += c;
        }
      }
      if (empty) row += empty;
      rows.push(row);
    }
    return rows.join('/');
  }

  function inferCastling(placement) {
    const rows = placement.split('/');
    const expand = (row) => row.replace(/\d/g, (d) => '.'.repeat(Number(d)));
    const r1 = expand(rows[7] || '');
    const r8 = expand(rows[0] || '');
    let c = '';
    if (r1[4] === 'K') {
      if (r1[7] === 'R') c += 'K';
      if (r1[0] === 'R') c += 'Q';
    }
    if (r8[4] === 'k') {
      if (r8[7] === 'r') c += 'k';
      if (r8[0] === 'r') c += 'q';
    }
    return c || '-';
  }

  /** Clean a SAN token scraped from a page (annotations, figurines, move numbers). */
  function cleanSan(text) {
    if (!text) return '';
    let t = String(text).trim();
    const map = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N' };
    t = t.replace(/[♔♕♖♗♘♚♛♜♝♞]/g, (m) => map[m]);
    t = t.replace(/[♙♟]/g, '');
    t = t.replace(/^\d+\.(\.\.)?\s*/, '');
    t = t.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
    t = t.replace(/\s+/g, '');
    // keep only characters that can appear in SAN
    t = t.replace(/[^a-hKQRBNx1-8O\-=+#]/g, '');
    return t;
  }

  /** Replay SAN moves; returns the legal prefix and placements after every ply. */
  function replay(sans) {
    const chess = new Chess();
    const placements = [chess.fen().split(' ')[0]];
    const fens = [chess.fen()];
    const legal = [];
    const moves = [];
    for (const san of sans) {
      if (!san) continue;
      let mv;
      try {
        mv = chess.move(san);
      } catch (e) {
        break;
      }
      legal.push(mv.san);
      moves.push(mv);
      placements.push(chess.fen().split(' ')[0]);
      fens.push(chess.fen());
    }
    return { sans: legal, moves, placements, fens };
  }

  /**
   * input: { sans: [string], pieces: [{sq,color,type}] | null, lastMove: [sq, sq] | null }
   * output: { source, sans, moves, fen, fenBefore, browsing }
   */
  function resolve(input) {
    const rawSans = (input.sans || []).map(cleanSan).filter(Boolean);
    const r = replay(rawSans);
    const boardPlacement = input.pieces && input.pieces.length ? placementFromPieces(input.pieces) : null;
    const fromMoves = (n) => ({
      source: 'moves',
      sans: r.sans.slice(0, n),
      moves: r.moves.slice(0, n),
      fen: r.fens[n],
      fenBefore: n > 0 ? r.fens[n - 1] : null,
      browsing: n < r.sans.length
    });

    if (r.sans.length && (!boardPlacement || boardPlacement === r.placements[r.sans.length])) return fromMoves(r.sans.length);
    if (boardPlacement) {
      // The user may be browsing an earlier move in the list.
      for (let i = r.placements.length - 1; i >= 0; i--) {
        if (r.placements[i] === boardPlacement && (r.sans.length || i === 0)) return fromMoves(i);
      }
      // Board only: guess the side to move from the last-move highlight.
      let turn = 'w';
      if (input.lastMove && input.lastMove.length) {
        const moved = input.pieces.find((p) => input.lastMove.includes(p.sq));
        if (moved) turn = moved.color === 'w' ? 'b' : 'w';
      }
      const fen = `${boardPlacement} ${turn} ${inferCastling(boardPlacement)} - 0 1`;
      let valid = true;
      try {
        new Chess(fen);
      } catch (e) {
        valid = false;
      }
      if (valid) return { source: 'board', sans: [], moves: [], fen, fenBefore: null, browsing: false };
    }
    if (r.sans.length) return fromMoves(r.sans.length);
    return null;
  }

  CC.Position = { placementFromPieces, inferCastling, cleanSan, replay, resolve };
})(globalThis);
