// Loads the extension's classic scripts into this Node process (they attach to globalThis).
const path = require('path');
const root = path.join(__dirname, '..', '..');
for (const f of [
  'vendor/chess.js',
  'src/core/openings-data.js',
  'src/core/opening-book.js',
  'src/core/coach.js',
  'src/core/fair-play.js',
  'src/core/position.js',
  'src/core/srs.js',
  'src/core/storage.js',
  'src/core/repertoire.js',
  'src/core/view-model.js'
]) {
  require(path.join(root, f));
}
module.exports = globalThis.ChessCoach;
