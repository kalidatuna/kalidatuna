/*
 * Teaching logic: plain-language move explanations, opening-principle checks,
 * loose-piece detection and post-game review. No engine - everything here is
 * rule-based so it can explain *why* in human terms.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});
  const { Chess } = root.ChessJS;

  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
  const CENTER = ['d4', 'e4', 'd5', 'e5'];
  const WIDE_CENTER = ['c3', 'd3', 'e3', 'f3', 'c4', 'f4', 'c5', 'f5', 'c6', 'd6', 'e6', 'f6'];
  const MINOR_HOME = { w: ['b1', 'c1', 'f1', 'g1'], b: ['b8', 'c8', 'f8', 'g8'] };
  const FILES = 'abcdefgh';

  const other = (c) => (c === 'w' ? 'b' : 'w');
  const colorName = (c) => (c === 'w' ? 'White' : 'Black');

  function allSquares() {
    const out = [];
    for (let r = 1; r <= 8; r++) for (const f of FILES) out.push(f + r);
    return out;
  }
  const SQUARES = allSquares();

  function piecesOf(chess, color) {
    const out = [];
    for (const sq of SQUARES) {
      const p = chess.get(sq);
      if (p && p.color === color) out.push({ sq, type: p.type, color });
    }
    return out;
  }

  /** Attackers of `sq` belonging to `color`, as [{sq, type}] sorted cheapest first. */
  function attackersOf(chess, sq, color) {
    return chess
      .attackers(sq, color)
      .map((s) => ({ sq: s, type: chess.get(s).type }))
      .sort((a, b) => VALUES[a.type] - VALUES[b.type]);
  }

  function fileState(chess, file) {
    let w = false;
    let b = false;
    for (let r = 1; r <= 8; r++) {
      const p = chess.get(file + r);
      if (p && p.type === 'p') {
        if (p.color === 'w') w = true;
        else b = true;
      }
    }
    return { w, b };
  }

  /**
   * Explain a single move in plain language.
   * `prevMove` (optional) is the move played just before, as { to, captured }.
   */
  function explainMove(fenBefore, san, prevMove) {
    const chess = new Chess(fenBefore);
    let mv;
    try {
      mv = chess.move(san);
    } catch (e) {
      return null;
    }
    const us = mv.color;
    const them = other(us);
    const parts = [];
    const fullmove = Number(fenBefore.split(' ')[5] || 1);
    const backRank = us === 'w' ? '1' : '8';

    if (mv.flags.includes('k') || mv.flags.includes('q')) {
      parts.push(`Castles ${mv.flags.includes('k') ? 'kingside' : 'queenside'}: the king gets to safety and the rooks can connect.`);
    } else {
      if (mv.captured) {
        const recapture = !!(prevMove && prevMove.captured && prevMove.to === mv.to);
        parts.push(`${recapture ? 'Recaptures' : 'Captures'} the ${NAMES[mv.captured]} on ${mv.to}.`);
      }
      switch (mv.piece) {
        case 'n':
        case 'b': {
          if (mv.from[1] === backRank && !mv.captured) {
            const fianchetto = mv.piece === 'b' && ['g2', 'b2', 'g7', 'b7'].includes(mv.to);
            if (fianchetto) parts.push(`Fianchettoes the bishop: from ${mv.to} it controls the long diagonal.`);
            else if (mv.piece === 'n' && (mv.to[0] === 'a' || mv.to[0] === 'h')) parts.push('Develops the knight, but to the edge, where it controls fewer squares.');
            else parts.push(`Develops the ${NAMES[mv.piece]}${isCentralish(mv.to) ? ' toward the center' : ''}.`);
          } else if (mv.piece === 'b' && pinsSomething(chess, mv.to, us)) {
            parts.push('Pins an enemy piece to a more valuable one behind it.');
          }
          break;
        }
        case 'p': {
          const file = mv.to[0];
          const rank = Number(mv.to[1]);
          if (CENTER.includes(mv.to) && !mv.captured) parts.push('Puts a pawn in the center, gaining space and controlling key squares.');
          else if ((file === 'c' || file === 'f') && Math.abs(rank - Number(mv.from[1])) === 2) parts.push('Fights for the center from the side.');
          else if (['g3', 'b3', 'g6', 'b6'].includes(mv.to) && !mv.captured) parts.push(`Prepares to fianchetto the bishop on ${file === 'g' ? (us === 'w' ? 'g2' : 'g7') : (us === 'w' ? 'b2' : 'b7')}.`);
          else if (['h3', 'h6'].includes(mv.to) && !mv.captured) parts.push(`Takes the ${us === 'w' ? 'g4' : 'g5'} square away from enemy pieces (no annoying pin) and gives the king some air.`);
          else if (['a3', 'a6'].includes(mv.to) && !mv.captured) parts.push(`Controls ${us === 'w' ? 'b4' : 'b5'}, keeping enemy pieces off it and preparing queenside expansion.`);
          else if (['e3', 'e6', 'd3', 'd6', 'c3', 'c6'].includes(mv.to) && !mv.captured) parts.push('Supports the center and opens a diagonal for a bishop.');
          if (mv.promotion) parts.push(`Promotes to a ${NAMES[mv.promotion]}!`);
          break;
        }
        case 'q':
          if (fullmove <= 6 && !mv.captured) parts.push('An early queen move: it can become a target for the opponent\'s developing moves.');
          break;
        case 'r': {
          const fs = fileState(chess, mv.to[0]);
          if (!fs.w && !fs.b) parts.push(`Puts the rook on the open ${mv.to[0]}-file.`);
          else if (!fs[us]) parts.push(`Puts the rook on the half-open ${mv.to[0]}-file.`);
          break;
        }
        case 'k':
          if (fullmove <= 15) parts.push('Moves the king by hand - this gives up castling rights.');
          break;
        default:
          break;
      }
    }

    // What does the moved piece newly attack?
    if (!chess.isCheckmate()) {
      const targets = [];
      for (const p of piecesOf(chess, them)) {
        if (p.type === 'k' || p.type === 'p') continue;
        if (!chess.attackers(p.sq, us).includes(mv.to)) continue;
        const defenders = chess.attackers(p.sq, them).length;
        if (VALUES[p.type] > VALUES[mv.piece] || defenders === 0) targets.push(p);
      }
      if (targets.length >= 2) parts.push(`Double attack: hits the ${NAMES[targets[0].type]} on ${targets[0].sq} and the ${NAMES[targets[1].type]} on ${targets[1].sq}.`);
      else if (targets.length === 1) parts.push(`Attacks the ${NAMES[targets[0].type]} on ${targets[0].sq}.`);
    }

    if (chess.isCheckmate()) parts.push('Checkmate!');
    else if (chess.inCheck()) parts.push('Gives check.');

    if (!mv.flags.includes('k') && preparesCastling(fenBefore, chess, us)) parts.push('Clears the way to castle kingside.');

    if (!parts.length) parts.push(`${colorName(us)} repositions the ${NAMES[mv.piece]} from ${mv.from} to ${mv.to}.`);
    return parts.join(' ');
  }

  function isCentralish(sq) {
    return CENTER.includes(sq) || WIDE_CENTER.includes(sq);
  }

  function pinsSomething(chess, sq, us) {
    // Look along bishop/rook/queen lines from sq for: enemy piece, then a more valuable enemy piece.
    const piece = chess.get(sq);
    if (!piece) return false;
    const dirs = piece.type === 'b' ? [[1, 1], [1, -1], [-1, 1], [-1, -1]] : piece.type === 'r' ? [[1, 0], [-1, 0], [0, 1], [0, -1]] : [[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
    const f0 = FILES.indexOf(sq[0]);
    const r0 = Number(sq[1]);
    for (const [df, dr] of dirs) {
      let first = null;
      for (let i = 1; i < 8; i++) {
        const f = f0 + df * i;
        const r = r0 + dr * i;
        if (f < 0 || f > 7 || r < 1 || r > 8) break;
        const p = chess.get(FILES[f] + r);
        if (!p) continue;
        if (p.color === us) break;
        if (!first) {
          first = p;
          continue;
        }
        if (VALUES[p.type] > VALUES[first.type]) return true;
        break;
      }
    }
    return false;
  }

  function preparesCastling(fenBefore, after, us) {
    const castling = fenBefore.split(' ')[2] || '';
    const right = us === 'w' ? 'K' : 'k';
    if (!castling.includes(right)) return false;
    const r = us === 'w' ? '1' : '8';
    const clear = (c) => !c.get('f' + r) && !c.get('g' + r);
    return clear(after) && !clear(new Chess(fenBefore));
  }

  /** Track per-side facts from a game's move history. */
  function historyFacts(sans) {
    const chess = new Chess();
    const facts = {
      w: { castledPly: null, kingMovedPly: null, queenEarly: null, moves: 0, pieceMoves: {}, repeatPiece: null, developedPly: null },
      b: { castledPly: null, kingMovedPly: null, queenEarly: null, moves: 0, pieceMoves: {}, repeatPiece: null, developedPly: null }
    };
    // pieceId tracks a piece by its starting square as it moves around.
    const idAt = {};
    for (const sq of SQUARES) {
      const p = chess.get(sq);
      if (p) idAt[sq] = sq;
    }
    sans.forEach((san, i) => {
      let mv;
      try {
        mv = chess.move(san);
      } catch (e) {
        return;
      }
      const f = facts[mv.color];
      const ply = i + 1;
      f.moves++;
      const id = idAt[mv.from];
      delete idAt[mv.from];
      idAt[mv.to] = id;
      if (mv.flags.includes('k') || mv.flags.includes('q')) {
        f.castledPly = f.castledPly || ply;
        const r = mv.color === 'w' ? '1' : '8';
        const rookFrom = mv.flags.includes('k') ? 'h' + r : 'a' + r;
        const rookTo = mv.flags.includes('k') ? 'f' + r : 'd' + r;
        idAt[rookTo] = idAt[rookFrom];
        delete idAt[rookFrom];
      } else if (mv.piece === 'k' && f.kingMovedPly === null) {
        f.kingMovedPly = ply;
      }
      const undeveloped = MINOR_HOME[mv.color].filter((s) => {
        const p = chess.get(s);
        return p && p.color === mv.color && (p.type === 'n' || p.type === 'b');
      }).length;
      if (mv.piece === 'q' && f.moves <= 5 && undeveloped >= 2 && !mv.captured && f.queenEarly === null) f.queenEarly = ply;
      if (['n', 'b'].includes(mv.piece) && f.moves <= 8 && !mv.captured) {
        f.pieceMoves[id] = (f.pieceMoves[id] || 0) + 1;
        if (f.pieceMoves[id] === 2 && undeveloped >= 2 && f.repeatPiece === null && !chess.inCheck()) {
          f.repeatPiece = { ply, piece: mv.piece, to: mv.to };
        }
      }
      if (undeveloped === 0 && f.developedPly === null) f.developedPly = ply;
    });
    return facts;
  }

  /** Opening-principle tips for `color` in the current position. */
  function principleTips(fen, sans, color) {
    const chess = new Chess(fen);
    const facts = historyFacts(sans || [])[color];
    const fullmove = Number(fen.split(' ')[5] || 1);
    const tips = [];
    const homeMinors = MINOR_HOME[color].filter((s) => {
      const p = chess.get(s);
      return p && p.color === color && (p.type === 'n' || p.type === 'b');
    });
    const developed = 4 - homeMinors.length;
    const kingSq = piecesOf(chess, color).find((p) => p.type === 'k');
    const castled = facts.castledPly !== null;
    const castlingRights = (fen.split(' ')[2] || '').split('').filter((c) => (color === 'w' ? /[KQ]/ : /[kq]/).test(c)).length > 0;

    if (developed < 4 && fullmove >= 7 && homeMinors.length >= 2) {
      tips.push({ level: 'warn', text: `${homeMinors.length} minor pieces are still at home (${homeMinors.join(', ')}). Bring them out before starting operations.` });
    }
    if (!castled && fullmove >= 9 && kingSq && ['e1', 'e8', 'd1', 'd8'].includes(kingSq.sq)) {
      tips.push({ level: 'warn', text: castlingRights ? 'Your king is still in the center. Look for a safe moment to castle.' : 'Your king is stuck in the center without castling rights - keep the position closed and tuck it away manually.' });
    }
    if (facts.queenEarly !== null && fullmove <= 12) {
      tips.push({ level: 'info', text: 'You moved your queen early. Watch out: your opponent can develop with tempo by attacking it.' });
    }
    if (facts.repeatPiece && fullmove <= 12) {
      tips.push({ level: 'info', text: `You moved the same ${NAMES[facts.repeatPiece.piece]} twice in the opening. Prefer developing a new piece unless there is a concrete reason.` });
    }
    for (const p of piecesOf(chess, color)) {
      if (p.type === 'n' && (p.sq[0] === 'a' || p.sq[0] === 'h') && fullmove <= 20) {
        tips.push({ level: 'info', text: `Knight on ${p.sq}: "a knight on the rim is dim" - it controls few squares there.` });
        break;
      }
    }
    const centerPawns = CENTER.filter((s) => {
      const p = chess.get(s);
      return p && p.type === 'p' && p.color === color;
    }).length;
    if (fullmove >= 4 && fullmove <= 10 && centerPawns === 0) {
      const hasCenterFight = ['c4', 'c5', 'd3', 'd6', 'e3', 'e6', 'f4', 'f5'].some((s) => {
        const p = chess.get(s);
        return p && p.type === 'p' && p.color === color;
      });
      if (!hasCenterFight) tips.push({ level: 'info', text: 'You have no pawns in the center. Make sure you can challenge it with a pawn break (...c5, ...e5, ...d5 or c4, e4, d4).' });
    }
    if (castled && developed === 4 && fullmove <= 20) {
      tips.push({ level: 'good', text: 'Development complete and king safe. Now connect your rooks and find a plan (pawn break, weak square, or open file).' });
    }
    return {
      tips,
      meters: { developed, castled, kingSquare: kingSq ? kingSq.sq : null, castlingRights }
    };
  }

  /** Pieces that are attacked and undefended, or attacked by something cheaper. */
  function loosePieces(fen, color) {
    const chess = new Chess(fen);
    const them = other(color);
    const out = [];
    for (const p of piecesOf(chess, color)) {
      if (p.type === 'k') continue;
      const attackers = attackersOf(chess, p.sq, them);
      if (!attackers.length) continue;
      const defenders = chess.attackers(p.sq, color).length;
      const cheapest = attackers[0];
      if (defenders === 0) out.push({ sq: p.sq, type: p.type, reason: 'undefended', by: cheapest });
      else if (VALUES[cheapest.type] < VALUES[p.type]) out.push({ sq: p.sq, type: p.type, reason: 'cheaper-attacker', by: cheapest });
    }
    out.sort((a, b) => VALUES[b.type] - VALUES[a.type]);
    return out;
  }

  function tacticalTips(fen, color) {
    const chess = new Chess(fen);
    const toMove = fen.split(' ')[1];
    const tips = [];
    if (chess.isGameOver()) return tips;
    const mine = loosePieces(fen, color);
    const theirs = loosePieces(fen, other(color));
    for (const p of mine.slice(0, 2)) {
      const by = `${NAMES[p.by.type]} on ${p.by.sq}`;
      tips.push({
        level: 'warn',
        text: p.reason === 'undefended'
          ? `Your ${NAMES[p.type]} on ${p.sq} is attacked by the ${by} and not defended.`
          : `Your ${NAMES[p.type]} on ${p.sq} is attacked by a cheaper piece (${by}).`
      });
    }
    if (toMove === color) {
      for (const p of theirs.slice(0, 2)) {
        tips.push({
          level: 'good',
          text: p.reason === 'undefended'
            ? `Look: the ${NAMES[p.type]} on ${p.sq} is undefended and you attack it. Can you win it safely?`
            : `Look: you can attack the ${NAMES[p.type]} on ${p.sq} with a cheaper piece. Check whether the trade favors you.`
        });
      }
    }
    return tips;
  }

  /** Post-game opening review for the player of `color`. */
  function reviewGame(sans, color, book) {
    const res = book.analyzeGame(sans);
    const facts = historyFacts(sans)[color];
    const moveNo = (ply) => Math.ceil(ply / 2);
    const fmtPly = (ply) => `${moveNo(ply)}${ply % 2 === 1 ? '.' : '...'}${res.moves[ply - 1] ? res.moves[ply - 1].san : ''}`;
    const out = { opening: res.opening, items: [], leftBook: null, plies: res.legalPlies };

    if (res.leftBookPly !== null) {
      const ply = res.leftBookPly;
      const mover = ply % 2 === 1 ? 'w' : 'b';
      const prevKey = res.positions[ply - 1].key;
      const alternatives = book.continuations(prevKey).map((c) => c.san);
      out.leftBook = { ply, byYou: mover === color, move: fmtPly(ply), alternatives };
      if (mover === color) {
        out.items.push({
          level: alternatives.length ? 'warn' : 'info',
          text: alternatives.length
            ? `You left the book with ${fmtPly(ply)}. Book moves here: ${alternatives.join(', ')}. Drill this line in the trainer.`
            : `You were the first to leave known theory at ${fmtPly(ply)} - that's fine, the book here ends.`
        });
      } else {
        out.items.push({
          level: 'info',
          text: `Your opponent left the book with ${fmtPly(ply)}${alternatives.length ? ` (book: ${alternatives.join(', ')})` : ''}. Deviations are often weaker - next time look for a way to punish it.`
        });
      }
    } else if (res.legalPlies > 0) {
      out.items.push({ level: 'good', text: `The whole game stayed within the coach's opening book (${res.legalPlies} plies).` });
    }

    if (facts.castledPly) out.items.push({ level: 'good', text: `You castled on move ${moveNo(facts.castledPly)}.` });
    else if (facts.moves >= 10) out.items.push({ level: 'warn', text: 'You never castled. In open positions an uncastled king is a frequent reason for losing.' });
    if (facts.developedPly) out.items.push({ level: facts.developedPly <= 24 ? 'good' : 'info', text: `All four minor pieces were developed by move ${moveNo(facts.developedPly)}.` });
    else if (facts.moves >= 12) out.items.push({ level: 'warn', text: 'Some minor pieces never left their starting squares.' });
    if (facts.queenEarly) out.items.push({ level: 'info', text: `Early queen move at ${fmtPly(facts.queenEarly)} - check whether it cost you time.` });
    if (facts.repeatPiece) out.items.push({ level: 'info', text: `You moved the same ${NAMES[facts.repeatPiece.piece]} twice early (${fmtPly(facts.repeatPiece.ply)}).` });
    return out;
  }

  CC.Coach = { explainMove, principleTips, loosePieces, tacticalTips, reviewGame, historyFacts, NAMES, VALUES };
})(globalThis);
