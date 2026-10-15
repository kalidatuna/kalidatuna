/*
 * Picks the openings to play in your next game: one for White, one defense
 * against 1.e4 and one against 1.d4. Prefers lines you have drilled, then
 * openings you play often, then beginner-friendly defaults.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  const SLOTS = [
    { key: 'w', label: 'As White', test: (l) => l.side === 'w', fallback: 'italian-game' },
    { key: 'e4', label: 'As Black vs 1.e4', test: (l) => l.side === 'b' && l.sans[0] === 'e4', fallback: 'king-s-pawn-game' },
    { key: 'd4', label: 'As Black vs 1.d4', test: (l) => l.side === 'b' && l.sans[0] === 'd4', fallback: 'queen-s-gambit-declined' }
  ];

  const DEFAULT_REASON = {
    'italian-game': 'Beginner-friendly: quick development, an early castle and a clear target on f7.',
    'king-s-pawn-game': 'Beginner-friendly: answer 1.e4 with 1...e5, then develop knights and bishops and castle.',
    'queen-s-gambit-declined': 'Beginner-friendly: solid pawns on d5 and e6, simple development and few traps.'
  };

  function suggest(book, srs, games) {
    srs = srs || {};
    games = games || [];
    const played = {};
    for (const g of games) if (g.opening && g.opening.id) played[g.opening.id] = (played[g.opening.id] || 0) + 1;
    return SLOTS.map((slot) => {
      const candidates = book.lines.filter(slot.test);
      const drilled = candidates
        .filter((l) => srs[l.id] && srs[l.id].reps > 0)
        .sort((a, b) => srs[b.id].reps - srs[a.id].reps || b.sans.length - a.sans.length)[0];
      let line = drilled;
      let reason = drilled ? `You have drilled this line ${srs[drilled.id].reps} time(s) in a row without failing.` : null;
      if (!line) {
        const often = candidates.filter((l) => played[l.id]).sort((a, b) => played[b.id] - played[a.id])[0];
        if (often) {
          line = often;
          reason = `You reached it in ${played[often.id]} recorded game(s). Drill it in the trainer to go deeper.`;
        }
      }
      if (!line) {
        line = book.byId.get(slot.fallback);
        reason = DEFAULT_REASON[slot.fallback];
      }
      return { slot: slot.key, label: slot.label, line, reason };
    });
  }

  CC.Repertoire = { suggest };
})(globalThis);
