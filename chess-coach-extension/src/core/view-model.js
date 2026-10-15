/*
 * Turns what was read from the page into what the panel should show,
 * applying the fair-play rules. Pure function - unit tested without a browser.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  const moveLabel = (ply, san) => CC.moveLabel(ply, san);

  /**
   * page:     result of Adapters.readPage
   * settings: Storage settings
   * state:    { revealedKey }
   */
  function buildViewModel(page, settings, state) {
    const book = CC.getBook();
    const { Coach, FairPlay, Position, positionKey } = CC;
    state = state || {};
    const ctxName = FairPlay.classify(page.signals);
    const ctxDef = FairPlay.CONTEXTS[ctxName];
    const ctx = Object.assign({ name: ctxName }, ctxDef);
    const allow = ctx.allow;
    const userColor = page.orientation || 'w';
    const vm = { ctx, userColor, key: null };

    if (ctxName === 'none') return vm;
    if (ctxName === 'prep') {
      vm.repertoire = state.repertoire || null;
      return vm;
    }
    if (ctxName === 'live') {
      vm.checklist = CC.PRINCIPLES.checklist;
      return vm;
    }
    if (ctxName === 'puzzle') return vm;

    const pos = Position.resolve({ sans: page.sans, pieces: page.pieces, lastMove: page.lastMove });
    if (!pos) return vm;
    if (ctxName === 'review' && pos.source === 'moves' && pos.sans.length < 2 && !pos.browsing) {
      vm.emptyGame = true;
      return vm;
    }
    const key = positionKey(pos.fen);
    // On a finished game's last position, show the review instead of next-move advice.
    const finalOfFinished = ctxName === 'review' && !pos.browsing;
    const turn = pos.fen.split(' ')[1];
    vm.key = key;
    vm.fen = pos.fen;

    // ---- Opening identification & book status
    if (allow.book) {
      if (pos.source === 'moves') {
        const a = book.analyzeGame(pos.sans);
        vm.opening = a.opening;
        if (a.leftBookPly === null) {
          vm.bookStatus = { inBook: true, text: pos.sans.length ? `In book after ${moveLabel(pos.sans.length, pos.sans[pos.sans.length - 1])}` : 'Starting position' };
        } else {
          const ply = a.leftBookPly;
          const byYou = (ply % 2 === 1 ? 'w' : 'b') === userColor;
          vm.bookStatus = { inBook: false, text: `Out of book since ${moveLabel(ply, pos.sans[ply - 1])} (${byYou ? 'you' : 'opponent'})` };
        }

        // ---- Last move
        const n = pos.sans.length;
        if (n > 0) {
          const san = pos.sans[n - 1];
          const mover = n % 2 === 1 ? 'w' : 'b';
          const beforeKey = positionKey(pos.fenBefore);
          const bookNote = book.noteFor(beforeKey, san);
          const inBook = !!bookNote || book.has(key) || (book.nodes.get(beforeKey) && book.nodes.get(beforeKey).edges.has(san));
          vm.lastMove = {
            label: moveLabel(n, san),
            byYou: mover === userColor,
            inBook: !!inBook,
            firstOut: a.leftBookPly === n,
            bookNote: bookNote || null,
            text: allow.tips && settings.showExplanations ? Coach.explainMove(pos.fenBefore, san, n > 1 ? pos.moves[n - 2] : null) : null
          };
        }
      } else {
        vm.opening = book.namedAt(key);
        vm.bookStatus = book.has(key)
          ? { inBook: true, text: 'Book position (move list not readable - using the board)' }
          : { inBook: false, text: 'Not in the coach\'s book' };
      }

      // ---- Book continuations (not on the final position of a finished game)
      if (book.has(key) && !finalOfFinished) {
        const ply = pos.source === 'moves' ? pos.sans.length + 1 : turn === 'w' ? 1 : 2;
        const explain = allow.tips && settings.showExplanations;
        vm.continuations = book.continuations(key).slice(0, 6).map((c, i) =>
          Object.assign({}, c, {
            main: i === 0 && c.main,
            label: pos.source === 'moves' ? moveLabel(ply, c.san) : c.san,
            note: c.note || (explain ? Coach.explainMove(pos.fen, c.san) : null)
          })
        );
        vm.toMoveIsYou = turn === userColor;
        vm.revealed = settings.revealBookMoves === 'auto' || state.revealedKey === key;
      }
    }

    // ---- Has the opening phase ended? Then the coach steps back.
    if (ctxName !== 'review' && pos.source === 'moves') {
      const a = book.analyzeGame(pos.sans);
      const outFor = a.leftBookPly === null ? 0 : pos.sans.length - a.leftBookPly + 1;
      if (outFor >= 6 || pos.sans.length >= 30) {
        vm.openingOver = { opening: a.opening, leftBook: a.leftBookPly ? moveLabel(a.leftBookPly, pos.sans[a.leftBookPly - 1]) : null };
        for (const k of ['opening', 'bookStatus', 'lastMove', 'continuations']) delete vm[k];
        return vm;
      }
    }

    // ---- Principles & tactics
    if (allow.tips && settings.showTips && !finalOfFinished) {
      const pt = Coach.principleTips(pos.fen, pos.sans, userColor);
      vm.meters = pt.meters;
      vm.tips = pt.tips;
    }
    if (allow.tactics && settings.showTactics && !finalOfFinished) vm.tactics = Coach.tacticalTips(pos.fen, userColor);

    // ---- Post-game review
    if (ctxName === 'review') {
      const full = Position.replay((page.sans || []).map(Position.cleanSan).filter(Boolean)).sans;
      if (full.length >= 2) {
        vm.review = Coach.reviewGame(full, userColor, book);
        if (settings.recordGames && page.signals.isPlayer && page.signals.gameId) {
          vm.gameRecord = {
            id: `${page.site}:${page.signals.gameId}`,
            site: page.site,
            date: Date.now(),
            color: userColor,
            opening: vm.review.opening ? { id: vm.review.opening.id, name: vm.review.opening.name, eco: vm.review.opening.eco } : null,
            leftBookPly: vm.review.leftBook ? vm.review.leftBook.ply : null,
            leftBookByYou: vm.review.leftBook ? vm.review.leftBook.byYou : false,
            leftBookMove: vm.review.leftBook ? vm.review.leftBook.move : null,
            plies: full.length
          };
        }
      }
    }
    return vm;
  }

  CC.buildViewModel = buildViewModel;
})(globalThis);
