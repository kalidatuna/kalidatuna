const test = require('node:test');
const assert = require('node:assert');
const CC = require('./load');

const settings = Object.assign({}, CC.Storage.DEFAULT_SETTINGS);
const page = (signals, sans, orientation) => ({ site: 'lichess', sans: sans.split(' '), pieces: null, lastMove: null, orientation: orientation || 'w', signals });

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
  const sans = 'e4 e5 Nf3 Nc6 Bc4 h6 d4';
  const spectator = CC.buildViewModel(page({ isGamePage: true, gameOver: true, gameId: 'abcdefgh' }, sans, 'b'), settings, {});
  assert.strictEqual(spectator.ctx.name, 'review');
  assert.ok(spectator.review);
  assert.strictEqual(spectator.gameRecord, undefined);
  const player = CC.buildViewModel(page({ isGamePage: true, gameOver: true, isPlayer: true, gameId: 'abcdefgh' }, sans, 'b'), settings, {});
  assert.strictEqual(player.gameRecord.id, 'lichess:abcdefgh');
  assert.strictEqual(player.gameRecord.leftBookByYou, true);
  assert.strictEqual(player.gameRecord.leftBookMove, '3...h6');
  assert.strictEqual(player.gameRecord.opening.name, 'Italian Game');
});

test('out-of-book status names who deviated', () => {
  const vm = CC.buildViewModel(page({ isAnalysis: true }, 'e4 e5 Nf3 Nc6 Bc4 h6 d4'), settings, {});
  assert.match(vm.bookStatus.text, /Out of book since 3\.\.\.h6 \(opponent\)/);
  assert.strictEqual(vm.continuations, undefined);
});
