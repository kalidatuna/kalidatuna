const test = require('node:test');
const assert = require('node:assert');
const CC = require('./load');

const book = CC.getBook();
const sans = (s) => s.split(' ');

test('every opening line is legal, unique and documented', () => {
  assert.ok(book.lines.length >= 100, `expected a substantial book, got ${book.lines.length}`);
  for (const l of book.lines) {
    assert.ok(l.eco && /^[A-E]\d\d$/.test(l.eco), `${l.name}: bad ECO ${l.eco}`);
    assert.ok(l.why && l.summary, `${l.name}: missing why/summary`);
    assert.ok(Array.isArray(l.plans.w) && Array.isArray(l.plans.b), `${l.name}: plans`);
    for (const ply of Object.keys(l.notes)) assert.ok(Number(ply) >= 1 && Number(ply) <= l.sans.length, `${l.name}: note ply ${ply} out of range`);
  }
});

test('names the deepest opening reached', () => {
  const r = book.analyzeGame(sans('e4 e5 Nf3 Nc6 Bc4 Bc5 c3'));
  assert.strictEqual(r.opening.name, 'Italian Game: Giuoco Piano, Main Line');
  assert.strictEqual(r.leftBookPly, null);
});

test('detects where the game left the book', () => {
  const r = book.analyzeGame(sans('e4 e5 Nf3 Nc6 Bc4 h6 d4'));
  assert.strictEqual(r.opening.name, 'Italian Game');
  assert.strictEqual(r.leftBookPly, 6);
});

test('recognizes transpositions into book positions', () => {
  const r = book.analyzeGame(sans('c4 e6 d4 Nf6 Nc3 Bb4'));
  assert.strictEqual(r.opening.name, 'Nimzo-Indian Defense');
  assert.strictEqual(r.leftBookPly, null);
});

test('book continuations come with notes and are ordered by popularity', () => {
  const start = book.continuations(book.startKey);
  assert.strictEqual(start[0].san, 'e4');
  const r = book.analyzeGame(sans('e4 e5 Nf3 Nc6'));
  const next = book.continuations(r.positions[r.positions.length - 1].key);
  const bc4 = next.find((c) => c.san === 'Bc4');
  assert.ok(bc4, 'Bc4 is a book move');
  assert.strictEqual(bc4.opening, 'Italian Game');
  assert.match(bc4.note, /f7/);
  assert.ok(next.some((c) => c.san === 'Bb5') && next.some((c) => c.san === 'd4'));
});

test('lines are assigned to the side that chooses them', () => {
  assert.strictEqual(book.byId.get('italian-game').side, 'w');
  assert.strictEqual(book.byId.get('sicilian-defense').side, 'b');
  assert.ok(book.linesFor('b').some((l) => l.name === 'Caro-Kann Defense'));
});
