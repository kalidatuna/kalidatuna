const test = require('node:test');
const assert = require('node:assert');
const CC = require('./load');
const { FairPlay, Position, SRS } = CC;

test('fair-play classification', () => {
  assert.strictEqual(FairPlay.classify({ isAnalysis: true }), 'analysis');
  assert.strictEqual(FairPlay.classify({ isPuzzle: true, isAnalysis: true }), 'puzzle');
  assert.strictEqual(FairPlay.classify({ isGamePage: true }), 'live');
  assert.strictEqual(FairPlay.classify({ isGamePage: true, opponentIsComputer: true }), 'bot');
  assert.strictEqual(FairPlay.classify({ isGamePage: true, isCorrespondence: true }), 'correspondence');
  assert.strictEqual(FairPlay.classify({ isGamePage: true, gameOver: true }), 'review');
  assert.strictEqual(FairPlay.classify({}), 'none');
  const live = FairPlay.CONTEXTS.live.allow;
  assert.deepStrictEqual(live, { book: false, explain: false, tips: false, tactics: false });
  const corr = FairPlay.CONTEXTS.correspondence.allow; // chess.com Daily games
  assert.ok(corr.book && !corr.tips && !corr.tactics);
});

test('cleanSan handles figurines, castling zeros and annotations', () => {
  assert.strictEqual(Position.cleanSan('♘f3'), 'Nf3');
  assert.strictEqual(Position.cleanSan('12...Nxe4!?'), 'Nxe4');
  assert.strictEqual(Position.cleanSan('0-0'), 'O-O');
  assert.strictEqual(Position.cleanSan(' e8=Q+ '), 'e8=Q+');
});

test('resolve uses the move list, detects browsing, falls back to the board', () => {
  const { Chess } = globalThis.ChessJS;
  const piecesOf = (fen) => {
    const c = new Chess(fen);
    const out = [];
    for (const row of c.board()) for (const p of row) if (p) out.push({ sq: p.square, color: p.color, type: p.type });
    return out;
  };
  const c = new Chess();
  const moves = ['e4', 'e5', 'Nf3', 'Nc6'];
  const fens = [c.fen()];
  for (const m of moves) {
    c.move(m);
    fens.push(c.fen());
  }
  const full = Position.resolve({ sans: moves, pieces: piecesOf(fens[4]) });
  assert.strictEqual(full.source, 'moves');
  assert.strictEqual(full.sans.length, 4);
  assert.strictEqual(full.browsing, false);

  const browsing = Position.resolve({ sans: moves, pieces: piecesOf(fens[2]) });
  assert.strictEqual(browsing.sans.length, 2);
  assert.ok(browsing.browsing);

  const board = Position.resolve({ sans: [], pieces: piecesOf(fens[3]), lastMove: ['g1', 'f3'] });
  assert.strictEqual(board.source, 'board');
  assert.strictEqual(board.fen.split(' ')[1], 'b');
  assert.strictEqual(CC.positionKey(board.fen), CC.positionKey(fens[3]));
});

test('spaced repetition grows intervals on success and resets on failure', () => {
  const now = 1_000_000;
  let r = SRS.grade(null, 5, now);
  assert.strictEqual(r.interval, 1);
  r = SRS.grade(r, 5, now);
  assert.strictEqual(r.interval, 3);
  r = SRS.grade(r, 4, now);
  assert.ok(r.interval >= 7);
  const fail = SRS.grade(r, SRS.qualityFromMistakes(3), now);
  assert.strictEqual(fail.reps, 0);
  assert.strictEqual(fail.lapses, 1);
  assert.ok(fail.ease < r.ease);
  assert.ok(SRS.isDue(fail, now + 11 * 60 * 1000));
});
