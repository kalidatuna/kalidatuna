// Two real browser sessions in one room: lobby, movement sync, server-validated combat,
// projectiles, time stop, KO and respawn, plus a server bot.
// Usage: node tests/multiplayer.mjs [baseUrl]   (server must be running: npm run build && npm start)
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8080';
const out = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const errors = [];
async function open(label) {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(label + ': ' + m.text()));
  page.on('pageerror', (e) => errors.push(label + ' PAGEERROR ' + e.message));
  await page.goto(base + '/?test&lowgfx', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  return page;
}
const st = (page) =>
  page.evaluate(() => {
    const g = window.__sc.game;
    const p = g.player;
    return {
      state: g.state,
      mode: g.mode?.kind,
      me: p && { id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, hp: p.hp, dead: p.dead, frozen: p.frozen, kos: p.stats.kos, so: p.standOut },
      others: g.sim.fighters.filter((f) => f !== p).map((f) => ({ id: f.id, name: f.name, x: f.pos.x, y: f.pos.y, z: f.pos.z, hp: f.hp, dead: f.dead, frozen: f.frozen, act: f.action?.id ?? null, so: f.standOut })),
      proj: g.sim.projectiles.length,
      ts: !!g.sim.timeStop,
      net: window.__sc.menus.net.status,
      ping: window.__sc.menus.net.ping,
    };
  });

const A = await open('A');
const B = await open('B');

// A hosts as Jotaro
await A.evaluate(() => {
  const m = window.__sc.menus;
  m.char = 'jotaro';
  m.show('lobby');
});
await A.fill('#l-name', 'HostJotaro');
await A.click('#l-host');
await A.waitForSelector('.lobby .code', { timeout: 8000 });
const code = (await A.textContent('.lobby .code')).trim();
check('host receives a room code', /^[A-Z]{4}$/.test(code), code);

// B joins as DIO
await B.evaluate(() => {
  const m = window.__sc.menus;
  m.char = 'dio';
  m.show('lobby');
});
await B.fill('#l-name', 'GuestDIO');
await B.fill('#l-code', code);
await B.click('#l-join');
await B.waitForSelector('.lobby .code', { timeout: 8000 });
await A.waitForTimeout(500);
const playersA = await A.$$eval('.lobby .pl', (els) => els.map((e) => e.textContent));
check('both players listed in the lobby', playersA.length === 2 && playersA.some((t) => t.includes('GuestDIO')), playersA.join(' | '));
await A.screenshot({ path: out + '50-lobby.png' });

// add a bot then start
await A.click('#r-bot');
await A.waitForTimeout(400);
const n3 = await A.$$eval('.lobby .pl', (els) => els.length);
check('host can add a bot (3 fighters)', n3 === 3);
await A.click('#r-unbot');
await A.waitForTimeout(400);
check('host can remove the bot', (await A.$$eval('.lobby .pl', (els) => els.length)) === 2);
await A.selectOption('#r-target', '3');
await A.click('#r-start');
await A.waitForTimeout(2500);
let a = await st(A);
let b = await st(B);
check('match starts on both clients', a.mode === 'mp' && b.mode === 'mp' && a.state === 'play' && b.state === 'play');
check('each client sees the other fighter', a.others.length === 1 && b.others.length === 1, `A sees ${a.others.length}, B sees ${b.others.length}`);

// movement sync: B walks, A should see B move
const bId = b.me.id;
const bStart = a.others.find((o) => o.id === bId);
await B.keyboard.down('KeyW');
await B.waitForTimeout(1200);
await B.keyboard.up('KeyW');
await B.waitForTimeout(600);
b = await st(B);
a = await st(A);
const bOnA = a.others.find((o) => o.id === bId);
const moved = Math.hypot(bOnA.x - bStart.x, bOnA.z - bStart.z);
const err = Math.hypot(bOnA.x - b.me.x, bOnA.z - b.me.z);
check('B movement replicated to A', moved > 4 && err < 1.0, `moved=${moved.toFixed(1)} sync error=${err.toFixed(2)}m`);

// stand summon sync
await B.keyboard.press('KeyE');
await B.waitForTimeout(600);
a = await st(A);
check('Stand summon replicated', a.others.find((o) => o.id === bId).so === true);

// B (DIO) throws knives — A should see projectiles
await B.keyboard.press('KeyR');
let maxProj = 0;
for (let i = 0; i < 40 && maxProj < 3; i++) {
  await A.waitForTimeout(100);
  maxProj = Math.max(maxProj, (await st(A)).proj);
}
check('knife projectiles replicated', maxProj >= 3, `A saw ${maxProj} projectiles`);
await B.waitForTimeout(800);

// A walks to B and attacks: damage must be validated by the server and seen by B
async function approach(page, targetId, dist = 2.0) {
  for (let i = 0; i < 30; i++) {
    const s = await st(page);
    const o = s.others.find((f) => f.id === targetId);
    if (!o) return;
    const d = Math.hypot(o.x - s.me.x, o.z - s.me.z);
    await page.evaluate(([ox, oz]) => {
      const g = window.__sc.game;
      g.rig.yaw = Math.atan2(ox - g.player.pos.x, oz - g.player.pos.z);
    }, [o.x, o.z]);
    if (d <= dist) return;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(Math.min(350, (d - dist) * 90));
    await page.keyboard.up('KeyW');
  }
}
// keep the bot out of the way so the duel is deterministic
await A.keyboard.press('KeyE');
await approach(A, bId);
const hpB0 = (await st(B)).me.hp;
for (let i = 0; i < 3; i++) {
  await A.mouse.click(480, 270);
  await A.waitForTimeout(220);
}
await A.waitForTimeout(500);
b = await st(B);
a = await st(A);
check('server-validated hits damage B (seen by B)', b.me.hp < hpB0, `B hp ${hpB0}→${b.me.hp}`);
check('A sees the same HP for B', Math.abs(a.others.find((o) => o.id === bId).hp - b.me.hp) < 12, `A sees ${a.others.find((o) => o.id === bId).hp}`);
await A.screenshot({ path: out + '51-mp-combat-A.png' });
await B.screenshot({ path: out + '52-mp-combat-B.png' });

// time stop by A freezes B
await A.evaluate(() => (window.__sc.game.player.energy = 100));
await approach(A, bId, 4);
await A.keyboard.press('KeyF');
await A.waitForTimeout(1100);
b = await st(B);
check('time stop freezes the remote player', b.me.frozen && b.ts, `frozen=${b.me.frozen} ts=${b.ts}`);
const bx = b.me.x;
await B.keyboard.down('KeyD');
await B.waitForTimeout(500);
await B.keyboard.up('KeyD');
b = await st(B);
check('frozen player cannot move', Math.abs(b.me.x - bx) < 0.05);
await B.screenshot({ path: out + '53-mp-timestop-B.png' });
await A.waitForTimeout(2200);
b = await st(B);
check('time resumes for the remote player', !b.me.frozen && !b.ts);

// fight until K.O.
let koed = false;
for (let round = 0; round < 100 && !koed; round++) {
  await approach(A, bId);
  await A.keyboard.press(round % 4 === 0 ? 'KeyQ' : round % 4 === 2 ? 'KeyR' : 'KeyZ');
  for (let i = 0; i < 3; i++) {
    await A.mouse.click(480, 270);
    await A.waitForTimeout(200);
  }
  b = await st(B);
  koed = b.me.dead;
}
check('remote player can be K.O.ed', koed);
await B.screenshot({ path: out + '54-mp-ko-B.png' });
a = await st(A);
check('K.O. credited to attacker', a.me.kos >= 1, `kos=${a.me.kos}`);
await B.waitForTimeout(3800);
b = await st(B);
check('remote player respawns', !b.me.dead && b.me.hp > 200, `hp=${b.me.hp}`);

// play the match out: first to 3 K.O.s → results on both clients → back to lobby
let ended = false;
for (let round = 0; round < 120 && !ended; round++) {
  b = await st(B);
  if (b.me.dead) {
    await B.waitForTimeout(500);
  } else {
    await approach(A, bId);
    await A.keyboard.press(round % 4 === 0 ? 'KeyQ' : round % 4 === 2 ? 'KeyR' : 'KeyZ');
    for (let i = 0; i < 3; i++) {
      await A.mouse.click(480, 270);
      await A.waitForTimeout(200);
    }
  }
  ended = (await st(A)).state === 'results';
}
await A.waitForTimeout(1000);
a = await st(A);
b = await st(B);
const titleA = await A.evaluate(() => document.querySelector('.results h2')?.textContent);
const titleB = await B.evaluate(() => document.querySelector('.results h2')?.textContent);
const subA = await A.evaluate(() => document.querySelector('.results .subtitle')?.textContent);
check('match ends (3 K.O.s or time limit) with results on both clients', a.state === 'results' && b.state === 'results', `A="${titleA}" B="${titleB}" — ${subA}`);
check('winner/loser screens', titleA === 'YOU WIN!' && titleB === 'MATCH OVER');
await A.screenshot({ path: out + '56-mp-results.png' });
await A.waitForTimeout(6500);
await A.click('#b-lobby');
await A.waitForTimeout(800);
check('room returns to the lobby after the match', (await A.$$eval('.lobby .pl', (els) => els.length)) === 2);

// separate room: practice against a server-side bot
const C = await open('C');
await C.evaluate(() => {
  const m = window.__sc.menus;
  m.char = 'dio';
  m.show('lobby');
});
await C.fill('#l-name', 'Solo');
await C.click('#l-host');
await C.waitForSelector('#r-bot', { timeout: 8000 });
await C.click('#r-bot');
await C.waitForTimeout(400);
await C.click('#r-start');
await C.waitForTimeout(2500);
let c = await st(C);
const bot0 = c.others[0];
check('bot practice room starts with a server bot', c.mode === 'mp' && c.others.length === 1, bot0 ? bot0.name : 'none');
let botActive = false;
for (let i = 0; i < 40 && !botActive; i++) {
  await C.waitForTimeout(500);
  c = await st(C);
  const bo = c.others[0];
  botActive = c.me.hp < 210 || (bo && Math.hypot(bo.x - bot0.x, bo.z - bot0.z) > 3);
}
check('server bot moves and attacks', botActive, `C hp=${c.me.hp.toFixed(0)}`);
await C.screenshot({ path: out + '55-mp-bot.png' });
console.log('ping A', Math.round(a.ping), 'ms');
check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
