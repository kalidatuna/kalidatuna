# Chess Coach for chess.com: Openings & Principles

A Chrome/Edge/Brave extension (Manifest V3) that helps you **learn** chess while you play on **chess.com**:

- **Live opening coach**: a panel next to the board that names your opening (with ECO code), says whether you are still "in book", explains why each move is played, and shows the book moves for the next turn. Book moves are hidden behind a "Show book moves" button by default, so you try to remember them first.
- **Plans and traps**: for each opening, the panel shows the typical plans for *your* color and the traps to watch for.
- **Move explanations**: plain-language notes for every move, such as "develops the knight toward the center", "pins an enemy piece", "double attack on the rook and queen", "early queen move: it can become a target".
- **Principle coach**: a development meter (minor pieces out of 4, castled or not) and warnings for undeveloped pieces, a king left in the center, early queen trips, moving the same piece twice, knights on the rim and missing central pawns.
- **Loose-piece alerts** for your pieces that are attacked and undefended, and for opponent pieces you can win.
- **Post-game review**: when a game ends, the panel shows who left the book first and with which move, what the book moves were, and when you castled and finished developing. With your permission each review is saved to your stats.
- **Opening trainer** (its own page):
  - **Learn**: step through a line on a board, with an explanation for every move. You can also try to play the next move yourself.
  - **Drill**: you play your side of the line and the trainer answers. Wrong moves are rejected with hints. Each line is then scheduled for review with spaced repetition (1 day, 3 days, then longer intervals).
  - **My progress**: the openings from your recorded games and the ones where you leave the book first, each with a link to drill it.
  - **Principles**: opening principles and a thinking checklist.

The opening book combines two sources:

- **3,865 named lines** from the [lichess chess-openings](https://github.com/lichess-org/chess-openings) data set (public domain / CC0), covering every ECO code with the precise variation names (for example "Ruy Lopez: Berlin Defense, Anti-Berlin Variation").
- **115 hand-written lines** for the major openings, with a summary, plans for both sides, traps and a note on the key moves. Deeper database lines inherit the plans of the hand-written opening they belong to, and every other book move gets a plain-language explanation.

Positions are matched by placement, so transpositions are recognized.

## Fair play

Help from outside the game (books, engines, hints) is **against chess.com's rules in live games against people**, and it can get your account closed. The coach therefore checks what kind of chess.com page it is on:

| Where | What the coach shows |
| --- | --- |
| Analysis board (`/analysis`), Game Review, lessons | Everything |
| Game vs the computer or a coach bot (`/play/computer`, `/play/coach`) | Everything. This is the best place to practice openings live. |
| Finished game | Everything, plus the post-game review |
| Daily game (`/game/daily/...`) | Opening name and book moves only (chess.com allows opening books in Daily games). No move advice and no tactical hints. |
| Live game vs a person (`/game/live/...`, `/play/online`, and any game page it can't identify) | **Paused.** It shows only a general thinking checklist; your review appears when the game ends. |
| Puzzles | Nothing, so you solve them yourself |

There is no setting to override the pause during live games. Use it to prepare (trainer, games vs the computer) and to review afterwards.

## Install (unpacked)

1. Download or clone this folder.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and select the `chess-coach-extension` folder.
4. On chess.com, open **Play → Play Bots** or the **Analysis** board. The panel appears on the right; drag it by its header or collapse it with **–**.
5. Click the extension icon for settings, or click **Open opening trainer**.

No build step is needed. The extension asks only for the `storage` permission and runs only on chess.com. Everything stays in your browser; nothing is sent anywhere.

## Suggested way to learn

1. Pick one opening for White and one defense each against 1.e4 and 1.d4 in the trainer.
2. **Learn** each line, then **Drill** it until you can play it without mistakes.
3. Play games against the computer with the panel open and try to recall the book moves before you reveal them.
4. Play your rated games without help, then read the post-game review. The **My progress** tab shows which openings you leave early; drill those.

## Development

```
npm install          # installs Playwright (only needed for the e2e test)
npm test             # unit tests: book integrity, explanations, principles, fair-play rules, SRS
npm run test:e2e     # loads the extension in Chromium against fake chess.com pages
node scripts/build-opening-db.js   # regenerates src/core/openings-db.js from data/chess-openings/*.tsv
```

Project layout:

```
manifest.json
vendor/chess.js            chess.js 1.4.0 (BSD-2), wrapped as a classic script
assets/pieces/             cburnett piece set (from lichess, BSD/GPL/GFDL)
src/core/                  site-independent logic (also loaded by the unit tests)
  openings-data.js         hand-written lines: notes, plans, traps
  openings-db.js           generated from the lichess opening data set (do not edit)
  opening-book.js          position index, transpositions, book continuations
  coach.js                 move explanations, principle tips, loose pieces, review
  fair-play.js             page-type classification and what may be shown
  position.js              reconciles move list vs. board pieces
  view-model.js            builds what the panel shows
  srs.js, storage.js
src/content/               content scripts: chess.com adapter, panel, main loop
src/trainer/               trainer page and board widget
src/popup/                 settings popup
src/background/            opens the trainer from the panel
```

### Known limitations

- **Site markup changes.** chess.com changes its page markup from time to time. All selectors are in `src/content/adapters.js`. The e2e test uses pages built to copy chess.com's board (`wc-chess-board`) and move-list markup, not the live site. If the panel stops updating, start there. If the move list can't be read, the coach falls back to reading the pieces on the board. It can still name book positions that way, but not explain the last move.
- **Unknown game pages are treated as live.** Watching someone else's live game looks the same as playing one, so it is also paused. A game vs the computer is only recognized from the `/play/computer`, `/play/coach` or `/game/computer/` URL.
- **Rule-based coaching.** There is no engine, by design. Explanations and loose-piece checks follow simple rules (attackers vs. defenders). They are meant for learning and are not a full evaluation of the position.
- **Firefox** is not supported yet: it needs a `background.scripts` entry in place of the MV3 service worker.

## Third-party code and assets

- Opening names and moves: lichess chess-openings data set, CC0 (see `data/chess-openings/LICENSE.txt`).
- chess.js 1.4.0 by Jeff Hlywa, BSD-2-Clause (see `vendor/LICENSE-chess.js.txt`).
- The piece images are the cburnett set by Colin M.L. Burnett, as used by lichess (see `assets/pieces/LICENSE.txt`).
