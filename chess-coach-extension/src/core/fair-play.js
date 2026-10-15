/*
 * Fair-play guard.
 *
 * Both lichess and chess.com forbid outside help (opening books, engines,
 * hints) during live games against people. Using it can get an account
 * closed. The coach therefore decides what it may show based on the kind
 * of page it is on. Unknown game pages are treated as live games.
 */
(function (root) {
  const CC = (root.ChessCoach = root.ChessCoach || {});

  const NONE = { book: false, explain: false, tips: false, tactics: false };
  const FULL = { book: true, explain: true, tips: true, tactics: true };

  const CONTEXTS = {
    analysis: { label: 'Analysis board', allow: FULL, note: 'Full coaching.' },
    bot: { label: 'Game vs computer', allow: FULL, note: 'Full coaching - practicing against a bot is the best place to learn openings live.' },
    review: { label: 'Finished game', allow: FULL, note: 'Game over - here is what happened.' },
    correspondence: {
      label: 'Correspondence / daily game',
      allow: { book: true, explain: true, tips: false, tactics: false },
      note: 'Opening books are allowed in correspondence games on lichess and chess.com, so book moves are shown. Position advice and tactical hints are off.'
    },
    live: {
      label: 'Live game vs a person',
      allow: NONE,
      note: 'Coaching is paused: outside help during live games breaks lichess and chess.com fair-play rules and can get your account closed. Your opening review appears as soon as the game ends.'
    },
    puzzle: { label: 'Puzzle', allow: NONE, note: 'Hints are off so you can solve it yourself.' },
    none: { label: 'No board', allow: NONE, note: '' }
  };

  /**
   * signals: {
   *   isAnalysis, isPuzzle, isGamePage, gameOver, opponentIsComputer, isCorrespondence
   * }
   */
  function classify(signals) {
    if (!signals) return 'none';
    if (signals.isPuzzle) return 'puzzle';
    if (signals.isAnalysis) return 'analysis';
    if (signals.isGamePage) {
      if (signals.gameOver) return 'review';
      if (signals.opponentIsComputer) return 'bot';
      if (signals.isCorrespondence) return 'correspondence';
      return 'live';
    }
    return 'none';
  }

  CC.FairPlay = { CONTEXTS, classify };
})(globalThis);
