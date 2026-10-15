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
    if (ctxName === 'live') {
      vm.checklist = CC.PRINCIPLES.checklist;
      return vm;
    }
    if (ctxName === 'puzzle') return vm;

    const pos = Position.resolve({ sans: page.sans, pieces: page.pieces, lastMove: page.lastMove });
    if (!pos) return vm;
    const key = positionKey(pos.fen);
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

      // ---- Book continuations
      if (book.has(key)) {
        const ply = pos.source === 'moves' ? pos.sans.length + 1 : turn === 'w' ? 1 : 2;
        vm.continuations = book.continuations(key).map((c) => Object.assign({}, c, { label: pos.source === 'moves' ? moveLabel(ply, c.san) : c.san }));
        vm.toMoveIsYou = turn === userColor;
        vm.revealed = settings.revealBookMoves === 'auto' || state.revealedKey === key;
      }
    }

    // ---- Principles & tactics
    if (allow.tips && settings.showTips) {
      const pt = Coach.principleTips(pos.fen, pos.sans, userColor);
      vm.meters = pt.meters;
      vm.tips = pt.tips;
    }
    if (allow.tactics && settings.showTactics) vm.tactics = Coach.tacticalTips(pos.fen, userColor);

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
