/*
 * End-to-end test: loads the unpacked extension into Chromium, serves fake
 * chess.com pages (built to mirror its board and move-list markup) and checks
 * what the coach panel shows. Also drives the trainer.
 *
 *   npm run test:e2e            (set SCREENSHOTS=dir to save screenshots)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');
require('../../vendor/chess.js');
const { Chess } = globalThis.ChessJS;

const EXT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SCREENSHOTS || null;
const FILES = 'abcdefgh';
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function play(moves) {
  const c = new Chess();
  const hist = [];
  for (const m of moves) hist.push(c.move(m));
  return { chess: c, hist };
}

function chesscomPage({ moves, flipped = false, over = false }) {
  const { chess, hist } = play(moves);
  const sqCls = (sq) => `square-${FILES.indexOf(sq[0]) + 1}${sq[1]}`;
  const pieces = [];
  for (const row of chess.board()) for (const p of row) if (p) pieces.push(`<div class="piece ${p.color}${p.type} ${sqCls(p.square)}"></div>`);
  const last = hist.length ? `<div class="highlight ${sqCls(hist[hist.length - 1].from)}"></div><div class="highlight ${sqCls(hist[hist.length - 1].to)}"></div>` : '';
  const fig = (m) => {
    if (m.piece === 'p' || m.san.startsWith('O-O')) return m.san;
    const color = m.color === 'w' ? 'white' : 'black';
    return `<span class="icon-font-chess ${NAMES[m.piece]}-${color}" data-figurine="${m.san[0]}"></span>${m.san.slice(1)}`;
  };
  let rows = '';
  for (let i = 0; i < hist.length; i += 2) {
    rows += `<div class="main-line-row move-list-row"><span class="move-number">${i / 2 + 1}.</span>`;
    rows += `<div class="node white-move main-line-ply"><span class="node-highlight-content offset-for-annotation-icon">${fig(hist[i])}</span></div>`;
    if (hist[i + 1]) rows += `<div class="node black-move main-line-ply"><span class="node-highlight-content">${fig(hist[i + 1])}</span></div>`;
    rows += `<div class="move-time-moveTime">3.2s</div></div>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>chess.com fixture</title></head><body>
    <wc-chess-board class="board${flipped ? ' flipped' : ''}" id="board-single" style="display:block;width:480px;height:480px;position:relative;">${last}${pieces.join('')}</wc-chess-board>
    <wc-simple-move-list>${rows}</wc-simple-move-list>
    ${over ? '<div class="game-over-modal-content"><div class="header-title-component">White won</div></div>' : ''}
  </body></html>`;
}

const CC = 'https://www.chess.com';
const pages = {
  [`${CC}/play/computer`]: chesscomPage({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] }),
  [`${CC}/game/live/111111111`]: chesscomPage({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] }),
  [`${CC}/game/daily/222222222`]: chesscomPage({ moves: ['d4', 'Nf6', 'c4', 'e6'] }),
  [`${CC}/game/live/333333333`]: chesscomPage({ moves: 'e4 e5 Nf3 Nc6 Bc4 Rb8 d4 exd4'.split(' '), flipped: true, over: true }),
  [`${CC}/analysis`]: chesscomPage({ moves: 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6'.split(' '), flipped: true }),
  [`${CC}/game/live/123456789`]: chesscomPage({ moves: 'd4 d5 c4 e6 Nc3 Nf6 Bg5 h6'.split(' '), over: true }),
  [`${CC}/game/live/444444444`]: chesscomPage({ moves: 'e4 e5 Nf3 Nc6 Bb5 Nf6 d3 Bc5 c3 O-O O-O d6 h3'.split(' '), over: true }),
  [`${CC}/play/online`]: chesscomPage({ moves: [] }),
  [`${CC}/game/185373995266`]: chesscomPage({ moves: [], over: true }),
  [`${CC}/puzzles/rated`]: chesscomPage({ moves: [] }),
  'https://lichess.org/abcdefgh': chesscomPage({ moves: ['e4'] })
};

async function panelText(page) {
  await page.waitForFunction(() => {
    const h = document.getElementById('chess-coach-root');
    return h && h.shadowRoot && h.shadowRoot.querySelector('.body') && h.shadowRoot.querySelector('.body').textContent.trim().length > 0;
  }, null, { timeout: 10000 });
  return page.evaluate(() => document.getElementById('chess-coach-root').shadowRoot.querySelector('.panel').innerText);
}

async function shot(page, name) {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') });
}

async function clickSquare(page, sq, orientation) {
  const box = await page.locator('#board').boundingBox();
  const s = box.width / 8;
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]);
  const x = orientation === 'w' ? f : 7 - f;
  const y = orientation === 'w' ? 8 - r : r - 1;
  await page.mouse.click(box.x + (x + 0.5) * s, box.y + (y + 0.5) * s);
}

(async () => {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chess-coach-e2e-'));
  const context = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`]
  });
  let failures = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      console.log('ok   -', name);
    } catch (e) {
      failures++;
      console.log('FAIL -', name, '\n      ', e.message.split('\n').join('\n       '));
    }
  };
  try {
    await context.route(/https:\/\/(www\.chess\.com|lichess\.org)\/.*/, (route) => {
      const url = route.request().url().split('?')[0];
      if (pages[url]) return route.fulfill({ status: 200, contentType: 'text/html', body: pages[url] });
      return route.fulfill({ status: 404, body: '' });
    });
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent('serviceworker');
    const extId = worker.url().split('/')[2];
    const page = await context.newPage();

    await check('game vs the computer gets full coaching', async () => {
      await page.goto(`${CC}/play/computer`);
      const text = await panelText(page);
      assert.match(text, /Game vs computer/);
      assert.match(text, /King's Knight Opening: Normal Variation/);
      assert.match(text, /Last move - opponent/i);
      assert.match(text, /Development 1\/4/);
      await page.evaluate(() => document.getElementById('chess-coach-root').shadowRoot.querySelector('[data-action="reveal"]').click());
      await page.waitForFunction(() => document.getElementById('chess-coach-root').shadowRoot.querySelector('.moves'));
      const after = await panelText(page);
      assert.match(after, /3\.Bc4/);
      assert.match(after, /Italian Game/);
      await shot(page, 'chesscom-bot');
    });

    await check('panel follows new moves', async () => {
      await page.evaluate(() => {
        // Simulate 3.Bc4: move the bishop element and add the move to the list.
        const bishop = document.querySelector('wc-chess-board .piece.wb.square-61');
        bishop.classList.replace('square-61', 'square-34');
        const row = document.createElement('div');
        row.className = 'main-line-row move-list-row';
        row.innerHTML = '<span class="move-number">3.</span><div class="node white-move main-line-ply"><span class="node-highlight-content"><span class="icon-font-chess bishop-white" data-figurine="B"></span>c4</span></div>';
        document.querySelector('wc-simple-move-list').append(row);
      });
      await page.waitForFunction(() => document.getElementById('chess-coach-root').shadowRoot.querySelector('.opening-name').textContent.startsWith('Italian Game'), null, { timeout: 5000 });
      const text = await panelText(page);
      assert.match(text, /Last move - yours/i);
      assert.match(text, /f7/);
    });

    await check('live game vs a person pauses coaching', async () => {
      await page.goto(`${CC}/game/live/111111111`);
      const text = await panelText(page);
      assert.match(text, /Live game vs a person/);
      assert.match(text, /Coaching is paused/);
      assert.match(text, /thinking checklist/i);
      assert.doesNotMatch(text, /King's Knight/);
      assert.doesNotMatch(text, /Show book moves/);
      await shot(page, 'chesscom-live');
    });

    await check('daily game shows book only', async () => {
      await page.goto(`${CC}/game/daily/222222222`);
      const text = await panelText(page);
      assert.match(text, /Daily game/);
      assert.match(text, /Indian Defense/);
      assert.doesNotMatch(text, /Development \d\/4/);
    });

    await check('Play page shows the openings to use in the next game', async () => {
      await page.goto(`${CC}/play/online`);
      const text = await panelText(page);
      assert.match(text, /Before your game/);
      assert.match(text, /Italian Game/);
      assert.match(text, /vs 1\.e4/i);
      assert.match(text, /vs 1\.d4/i);
      await shot(page, 'chesscom-prep');
    });

    await check('finished game with no moves shows no book moves', async () => {
      await page.goto(`${CC}/game/185373995266`);
      const text = await panelText(page);
      assert.match(text, /ended before any moves/);
      assert.doesNotMatch(text, /Show book moves/);
    });

    await check('puzzles get no hints', async () => {
      await page.goto(`${CC}/puzzles/rated`);
      const text = await panelText(page);
      assert.match(text, /Puzzle/);
      assert.doesNotMatch(text, /Opening/i);
    });

    await check('finished game as Black shows review and records it', async () => {
      await page.goto(`${CC}/game/live/333333333`);
      const text = await panelText(page);
      assert.match(text, /Finished game/);
      assert.match(text, /Post-game opening review/i);
      assert.match(text, /You left the book with 3\.\.\.Rb8/);
      await page.waitForFunction(() => /Saved to your opening stats/.test(document.getElementById('chess-coach-root').shadowRoot.textContent));
      await shot(page, 'chesscom-review');
    });

    await check('the Anti-Berlin (4.d3) is recognized as theory', async () => {
      await page.goto(`${CC}/game/live/444444444`);
      const text = await panelText(page);
      assert.match(text, /Anti-Berlin Variation/);
      assert.match(text, /Ideas below come from the parent opening, the Ruy Lopez: Berlin Defense/);
      assert.doesNotMatch(text, /4\.d3/);
      assert.doesNotMatch(text, /No warnings right now/);
      await shot(page, 'chesscom-berlin');
    });

    await check('extension does not run on other chess sites', async () => {
      await page.goto('https://lichess.org/abcdefgh');
      await page.waitForTimeout(800);
      assert.strictEqual(await page.evaluate(() => !!document.getElementById('chess-coach-root')), false);
    });

    await check('analysis board with figurine notation and flipped board', async () => {
      await page.goto(`${CC}/analysis`);
      const text = await panelText(page);
      assert.match(text, /Analysis board/);
      assert.match(text, /Najdorf/);
      assert.match(text, /Your plan as Black/i);
      await shot(page, 'chesscom-analysis');
    });

    await check('finished game as White is recorded', async () => {
      await page.goto(`${CC}/game/live/123456789`);
      const text = await panelText(page);
      assert.match(text, /Finished game/);
      assert.match(text, /QGD: Main Line|Queen's Gambit Declined/);
      await page.waitForFunction(() => /Saved to your opening stats/.test(document.getElementById('chess-coach-root').shadowRoot.textContent));
    });

    await check('popup shows settings and recent games', async () => {
      await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
      await page.waitForSelector('#games li');
      const text = await page.innerText('body');
      assert.match(text, /Italian Game/);
      assert.ok(await page.isChecked('#enabled'));
      await shot(page, 'popup');
    });

    await check('disabling in settings hides the panel', async () => {
      await page.click('#enabled');
      await page.goto(`${CC}/play/computer`);
      await page.waitForTimeout(800);
      const visible = await page.evaluate(() => {
        const h = document.getElementById('chess-coach-root');
        return !!h && h.style.display !== 'none';
      });
      assert.strictEqual(visible, false);
      await page.goto(`chrome-extension://${extId}/src/popup/popup.html`);
      await page.click('#enabled');
    });

    await check('trainer drill: wrong move is rejected, line can be completed', async () => {
      await page.goto(`chrome-extension://${extId}/src/trainer/trainer.html?line=italian-game&color=w&tab=drill`);
      await page.waitForFunction(() => /Play the/.test(document.querySelector('#feedback').textContent));
      // 1.d4 is book, but not this line: it is redirected without counting a mistake.
      await clickSquare(page, 'd2', 'w');
      await clickSquare(page, 'd4', 'w');
      await page.waitForFunction(() => /also a book move/.test(document.querySelector('#feedback').textContent));
      const play = async (mv) => {
        await clickSquare(page, mv.slice(0, 2), 'w');
        await clickSquare(page, mv.slice(2), 'w');
        await page.waitForTimeout(700); // the trainer answers after a short delay
      };
      await play('e2e4');
      await play('g1f3');
      await play('h2h3'); // not theory here: counts as a mistake
      await page.waitForFunction(() => /not the book move/.test(document.querySelector('#feedback').textContent));
      await play('f1c4');
      await page.waitForFunction(() => /Line complete/.test(document.querySelector('#feedback').textContent));
      const fb = await page.innerText('#feedback');
      assert.match(fb, /1 mistake/);
      await shot(page, 'trainer-drill');
    });

    await check('trainer learn mode steps through a line', async () => {
      await page.goto(`chrome-extension://${extId}/src/trainer/trainer.html?line=ruy-lopez-closed&tab=learn`);
      await page.waitForSelector('#line-card h2');
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
      const note = await page.innerText('#note-card');
      assert.match(note, /3\.Bb5/);
      assert.match(note, /e5/);
      await page.fill('#search', 'najdorf');
      const list = await page.innerText('#line-list');
      assert.match(list, /Najdorf/);
      await shot(page, 'trainer-learn');
    });
  } finally {
    await context.close();
    fs.rmSync(userDir, { recursive: true, force: true });
  }
  if (failures) {
    console.log(`\n${failures} e2e check(s) failed`);
    process.exit(1);
  }
  console.log('\nall e2e checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
