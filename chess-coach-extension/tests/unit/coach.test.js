const test = require('node:test');
const assert = require('node:assert');
const CC = require('./load');
const { Chess } = globalThis.ChessJS;
const { Coach } = CC;

function fenAfter(moves) {
  const c = new Chess();
  for (const m of moves.split(' ').filter(Boolean)) c.move(m);
  return c.fen();
}

test('explains castling, development and central pawns', () => {
  assert.match(Coach.explainMove(fenAfter(''), 'e4'), /center/);
  assert.match(Coach.explainMove(fenAfter('e4 e5'), 'Nf3'), /Develops the knight/);
  assert.match(Coach.explainMove(fenAfter('e4 e5 Nf3 Nc6 Bc4 Bc5'), 'O-O'), /Castles kingside/);
  assert.match(Coach.explainMove(fenAfter('d4 Nf6 c4'), 'g6'), /fianchetto/);
  assert.match(Coach.explainMove(fenAfter('e4 e5 Nf3 Nc6 Bb5'), 'a6'), /Attacks the bishop on b5/);
});

test('explains captures, recaptures, checks and mate', () => {
  const fen = fenAfter('e4 d5');
  assert.match(Coach.explainMove(fen, 'exd5'), /Captures the pawn on d5/);
  const c = new Chess(fenAfter('e4 d5'));
  const prev = c.move('exd5');
  assert.match(Coach.explainMove(c.fen(), 'Qxd5', prev), /Recaptures the pawn/);
  assert.match(Coach.explainMove(fenAfter('e4 e5 Bc4 Nc6 Qh5 Nf6'), 'Qxf7#'), /Checkmate/);
  assert.match(Coach.explainMove(fenAfter('e4 e5 Nf3 d6'), 'Bb5+'), /Gives check/);
});

test('spots attacks and double attacks (forks)', () => {
  assert.match(Coach.explainMove('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 30', 'Nc7+'), /Attacks the rook on a8.*Gives check/);
  assert.match(Coach.explainMove('3q4/6r1/8/2N5/8/8/8/K6k w - - 0 30', 'Ne6'), /Double attack/);
});

test('principle tips flag undeveloped pieces, central king and early queen', () => {
  const moves = 'e4 e5 Qh5 Nc6 Qf3 Nf6 Qb3 d5 a3 Bc5 h3 O-O c3 Bd6';
  const fen = fenAfter(moves);
  const { tips, meters } = Coach.principleTips(fen, moves.split(' '), 'w');
  const text = tips.map((t) => t.text).join(' | ');
  assert.match(text, /minor pieces are still at home/);
  assert.match(text, /queen early/);
  assert.strictEqual(meters.developed, 0);
  const black = Coach.principleTips(fen, moves.split(' '), 'b');
  assert.ok(black.meters.castled);
});

test('loose pieces are reported for both sides', () => {
  // Black knight on e5 attacked by white Nf3 and undefended.
  const fen = 'rnbqkb1r/pppppppp/8/4n3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 3';
  const mine = Coach.tacticalTips(fen, 'b').map((t) => t.text).join(' ');
  assert.match(mine, /Your knight on e5 is attacked/);
  const theirs = Coach.tacticalTips(fen, 'w').map((t) => t.text).join(' ');
  assert.match(theirs, /knight on e5 is undefended/);
});

test('post-game review explains who left the book', () => {
  const book = CC.getBook();
  const game = 'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3'.split(' ');
  const rBlack = Coach.reviewGame(game, 'b', book);
  assert.strictEqual(rBlack.opening.name, 'Italian Game: Two Knights Defense, Fried Liver Attack');
  const rWhite = Coach.reviewGame('e4 e5 Nf3 Nc6 Bc4 Bc5 Kf1 Nf6'.split(' '), 'w', book);
  assert.ok(rWhite.leftBook.byYou);
  assert.match(rWhite.items[0].text, /You left the book with 4\.Kf1/);
});
