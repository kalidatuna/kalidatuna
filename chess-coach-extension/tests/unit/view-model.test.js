const test = require('node:test');
const assert = require('node:assert');
const CC = require('./load');

const settings = Object.assign({}, CC.Storage.DEFAULT_SETTINGS);
const page = (signals, sans, orientation) => ({ site: 'chess.com', sans: sans.split(' '), pieces: null, lastMove: null, orientation: orientation || 'w', signals });

test('live games against people show only the thinking checklist', () => {
  const vm = CC.buildViewModel(page({ isGamePage: true }, 'e4 e5 Nf3'), settings, {});
  assert.strictEqual(vm.ctx.name, 'live');
  assert.ok(vm.checklist.length > 0);
  assert.strictEqual(vm.opening, undefined);
  assert.strictEqual(vm.continuations, undefined);
  assert.strictEqual(vm.tips, undefined);
  assert.strictEqual(vm.lastMove, undefined);
});

test('games vs the computer get full coaching', () => {
  const vm = CC.buildViewModel(page({ isGamePage: true, opponentIsComputer: true }, 'e4 e5 Nf3 Nc6'), settings, {});
  assert.strictEqual(vm.ctx.name, 'bot');
  assert.strictEqual(vm.opening.name, "King's Knight Opening: Normal Variation");
  assert.ok(vm.continuations.some((c) => c.label === '3.Bc4'));
  assert.strictEqual(vm.toMoveIsYou, true);
  assert.strictEqual(vm.revealed, false, 'book moves hidden until clicked by default');
  assert.ok(vm.lastMove.inBook);
  assert.ok(vm.meters);
});

test('reveal state and auto setting', () => {
  const p = page({ isAnalysis: true }, 'd4 d5');
  const first = CC.buildViewModel(p, settings, {});
  const revealed = CC.buildViewModel(p, settings, { revealedKey: first.key });
  assert.strictEqual(revealed.revealed, true);
  const auto = CC.buildViewModel(p, Object.assign({}, settings, { revealBookMoves: 'auto' }), {});
  assert.strictEqual(auto.revealed, true);
});

test('correspondence games show the book but no engine-like help', () => {
  const vm = CC.buildViewModel(page({ isGamePage: true, isCorrespondence: true }, 'e4 c5 Nf3 d6'), settings, {});
  assert.strictEqual(vm.ctx.name, 'correspondence');
  assert.ok(vm.opening);
  assert.ok(vm.continuations.length);
  assert.strictEqual(vm.tips, undefined);
  assert.strictEqual(vm.tactics, undefined);
  assert.strictEqual(vm.lastMove.text, null);
});

test('finished games produce a review and a record only for players', () => {
  const sans = 'e4 e5 Nf3 Nc6 Bc4 Rb8 d4';
  const spectator = CC.buildViewModel(page({ isGamePage: true, gameOver: true, gameId: 'abcdefgh' }, sans, 'b'), settings, {});
  assert.strictEqual(spectator.ctx.name, 'review');
  assert.ok(spectator.review);
  assert.strictEqual(spectator.gameRecord, undefined);
  const player = CC.buildViewModel(page({ isGamePage: true, gameOver: true, isPlayer: true, gameId: 'abcdefgh' }, sans, 'b'), settings, {});
  assert.strictEqual(player.gameRecord.id, 'chess.com:abcdefgh');
  assert.strictEqual(player.gameRecord.leftBookByYou, true);
  assert.strictEqual(player.gameRecord.leftBookMove, '3...Rb8');
  assert.strictEqual(player.gameRecord.opening.name, 'Italian Game');
});

test('out-of-book status names who deviated', () => {
  const vm = CC.buildViewModel(page({ isAnalysis: true }, 'e4 e5 Nf3 Nc6 Bc4 Rb8 d4'), settings, {});
  assert.match(vm.bookStatus.text, /Out of book since 3\.\.\.Rb8 \(opponent\)/);
  assert.strictEqual(vm.continuations, undefined);
});

test('the Play page (before a game) shows the repertoire, not live help', () => {
  const repertoire = CC.Repertoire.suggest(CC.getBook(), {}, []);
  const vm = CC.buildViewModel(page({ isLobby: true }, ''), settings, { repertoire });
  assert.strictEqual(vm.ctx.name, 'prep');
  assert.strictEqual(vm.repertoire.length, 3);
  assert.strictEqual(vm.continuations, undefined);
  assert.strictEqual(CC.FairPlay.classify({ isLobby: true, isGamePage: false }), 'prep');
});

test('repertoire prefers drilled lines, then played openings, then defaults', () => {
  const book = CC.getBook();
  const srs = { 'ruy-lopez': { reps: 3, due: 0 } };
  const games = [{ opening: { id: 'caro-kann-defense' } }];
  const [w, e4, d4] = CC.Repertoire.suggest(book, srs, games);
  assert.strictEqual(w.line.id, 'ruy-lopez');
  assert.strictEqual(e4.line.id, 'caro-kann-defense');
  assert.strictEqual(d4.line.id, 'queen-s-gambit-declined');
});

test('the opening coach steps back once the opening is over', () => {
  const sans = 'e4 e5 Nf3 Nc6 Bc4 Rb8 d3 a6 Nc3 b6 O-O Bb7';
  const vm = CC.buildViewModel(page({ isGamePage: true, opponentIsComputer: true }, sans), settings, {});
  assert.ok(vm.openingOver);
  assert.strictEqual(vm.openingOver.opening.name, 'Italian Game');
  assert.strictEqual(vm.continuations, undefined);
  assert.strictEqual(vm.lastMove, undefined);
});

test('a finished game without moves is not reviewed', () => {
  const start = new globalThis.ChessJS.Chess();
  const pieces = start.board().flat().filter(Boolean).map((p) => ({ sq: p.square, color: p.color, type: p.type }));
  const vm = CC.buildViewModel(Object.assign(page({ isGamePage: true, gameOver: true }, ''), { pieces }), settings, {});
  assert.ok(vm.emptyGame);
  assert.strictEqual(vm.continuations, undefined);
});
