// End-to-end gameplay verification in a real browser (headless Chromium + SwiftShader WebGL).
// Drives the game with real keyboard/mouse events and inspects state through window.__sc.
// Usage: node tests/gameplay.mjs [baseUrl]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:8080';
const out = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

let failures = 0;
const check = (name, ok, info = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!ok) failures++;
};
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const st = () =>
  page.evaluate(() => {
    const g = window.__sc.game;
    const p = g.player;
    const others = g.sim.fighters.filter((f) => f !== p);
    return {
      state: g.state,
      p: p && { x: p.pos.x, y: p.pos.y, z: p.pos.z, hp: p.hp, en: p.energy, so: p.standOut, act: p.action?.id ?? null, dead: p.dead, cds: p.cds, grounded: p.grounded, kos: p.stats.kos, dmg: p.stats.dmg },
      others: others.map((f) => ({ id: f.id, char: f.char, x: f.pos.x, y: f.pos.y, z: f.pos.z, hp: f.hp, max: f.maxHp, dead: f.dead, frozen: f.frozen, act: f.action?.id ?? null })),
      ts: g.sim.timeStop ? { t: g.sim.timeStop.t } : null,
      proj: g.sim.projectiles.length,
      canvasCls: g.canvas.className,
      views: g.views.size,
    };
  });
/** Poll until cond(state) is true (the game may render slowly in software WebGL). */
const until = async (cond, timeout = 8000) => {
  const t0 = Date.now();
  let s;
  while (Date.now() - t0 < timeout) {
    s = await st();
    if (cond(s)) return s;
    await wait(60);
  }
  return s;
};
const key = async (k, ms = 60) => {
  await page.keyboard.down(k);
  await wait(ms);
  await page.keyboard.up(k);
};
const click = async (button = 'left') => {
  await page.mouse.move(640, 360);
  await page.mouse.down({ button });
  await wait(40);
  await page.mouse.up({ button });
};
const start = async (kind, char, stage) => {
  await page.evaluate(
    ([kind, char, stage]) => {
      const m = window.__sc.menus;
      m.char = char;
      m.startLocal({ kind, stage });
    },
    [kind, char, stage],
  );
  await wait(1200);
};
/** Walk toward the first live non-player fighter until within `dist`. */
const approach = async (dist = 2.2) => {
  for (let i = 0; i < 60; i++) {
    const s = await st();
    const o = s.others.find((f) => !f.dead);
    if (!o) return;
    const d = Math.hypot(o.x - s.p.x, o.z - s.p.z);
    await page.evaluate(([ox, oz]) => {
      const g = window.__sc.game;
      const p = g.player;
      g.rig.yaw = Math.atan2(ox - p.pos.x, oz - p.pos.z);
      g.rig.pitch = -0.1;
    }, [o.x, o.z]);
    if (d <= dist) return;
    await page.keyboard.down('KeyW');
    const t0 = await page.evaluate(() => window.__sc.game.sim.time);
    while ((await page.evaluate(() => window.__sc.game.sim.time)) - t0 < Math.min(0.4, (d - dist) / 9)) await wait(20);
    await page.keyboard.up('KeyW');
    await wait(150);
  }
};

await page.goto(base + '/?test&lowgfx', { waitUntil: 'domcontentloaded' });
await wait(2000);

// ------------------------------------------------------------------ Jotaro in training
const simTime = () => page.evaluate(() => window.__sc.game.sim.time);
const log = () => page.evaluate(() => window.__sc.game.eventLog.map((e) => ({ ...e })));
const playerId = () => page.evaluate(() => window.__sc.game.player.id);
/** Wait until the event log satisfies cond (events are recorded inside the sim step, so nothing is missed). */
const untilLog = async (cond, timeout = 6000) => {
  const t0 = Date.now();
  let l;
  while (Date.now() - t0 < timeout) {
    l = await log();
    if (cond(l)) return l;
    await wait(60);
  }
  return l;
};
const trStat = (id) => page.evaluate((id) => Number(document.getElementById(id)?.textContent ?? 0), id);
await start('training', 'jotaro');
let s = await st();
check('training starts with player + dummy', s.state === 'play' && s.p && s.others.length === 1, `views=${s.views}`);
const z0 = s.p.z;
await page.keyboard.down('KeyW');
s = await until((q) => z0 - q.p.z > 3);
await page.keyboard.up('KeyW');
check('W moves forward (camera relative, accelerates to run speed)', z0 - s.p.z > 3, `dz=${(z0 - s.p.z).toFixed(2)}`);
await until((q) => q.p.grounded && Math.hypot(0, 0) === 0, 1000);
await page.keyboard.press('Space');
await until((q) => q.p.y > 1.2, 4000);
await page.keyboard.press('Space');
let peak = 0;
s = await until((q) => {
  peak = Math.max(peak, q.p.y);
  return peak > 2.6 && q.p.grounded;
}, 6000);
check('jump + double jump', peak > 2.6, `peak=${peak.toFixed(2)}`);
check('lands (grounded)', s.p.grounded);

await page.keyboard.press('KeyE');
s = await until((q) => q.p.so);
check('E summons Star Platinum', s.p.so);
await wait(800);
await shot('10-jotaro-stand');

// combo on dummy
await approach(2.2);
{
  const pid = await playerId();
  const t0 = await simTime();
  for (let i = 0; i < 3; i++) {
    await click();
    const t = await simTime();
    while ((await simTime()) - t < 0.22) await wait(25);
    if (i === 1) await shot('11-jotaro-combo');
  }
  const l = await untilLog((l) => l.filter((e) => e.k === 'hit' && e.a === pid && e.time > t0).length >= 3, 5000);
  const hits = l.filter((e) => e.k === 'hit' && e.a === pid && e.time > t0).length;
  const steps = l.filter((e) => e.k === 'action' && e.a === pid && e.ab === 'combo' && e.time > t0).length;
  check('3-hit combo lands on dummy', hits >= 3, `hits=${hits} combo actions=${steps}`);
  await until((q) => !q.p.act, 3000);
}

// barrage
await approach(2.2);
await page.keyboard.press('KeyQ');
s = await until((q) => q.p.act === 'barrage');
check('Q starts ORA barrage', s.p.act === 'barrage');
{
  const t = await simTime();
  while ((await simTime()) - t < 0.6) await wait(30);
}
await shot('12-jotaro-barrage');
await until((q) => !q.p.act, 4000);
check('barrage chains many hits', (await trStat('tr-best')) >= 10, `max combo=${await trStat('tr-best')}`);

// uppercut launches
await until((q) => q.others[0].y < 0.05 && q.others[0].hp > 0, 3000);
await approach(2.2);
await page.keyboard.press('KeyR');
let dmaxY = 0;
let shotDone = false;
await until((q) => {
  dmaxY = Math.max(dmaxY, q.others[0].y);
  return dmaxY > 1.5;
}, 4000);
await shot('13-jotaro-uppercut');
check('R uppercut launches the dummy', dmaxY > 1.5, `dummy peak y=${dmaxY.toFixed(2)}`);
await until((q) => !q.p.act && q.others[0].y < 0.05, 5000);

// stand leap (Shift with stand out)
s = await st();
const lx0 = s.p.x,
  lz0 = s.p.z;
await page.keyboard.press('ShiftLeft');
let lpeak = 0;
s = await until((q) => {
  lpeak = Math.max(lpeak, q.p.y);
  return lpeak > 1.5 && q.p.grounded && q.p.act === null;
}, 6000);
check('Shift (Stand out) performs Stand Leap', Math.hypot(s.p.x - lx0, s.p.z - lz0) > 5 && lpeak > 1.5, `dist=${Math.hypot(s.p.x - lx0, s.p.z - lz0).toFixed(1)} peak=${lpeak.toFixed(1)}`);

// time stop
await page.evaluate(() => {
  const p = window.__sc.game.player;
  p.energy = p.maxEnergy;
});
await approach(2.2);
const hpBefore = (await st()).others[0].hp;
await page.keyboard.press('KeyF');
s = await until((q) => !!q.ts, 5000);
check('F activates time stop & freezes dummy', !!s.ts && s.others[0].frozen, `ts=${JSON.stringify(s.ts)}`);
const tsT0 = await simTime();
const preClick = await page.evaluate(() => {
  const g = window.__sc.game;
  const p = g.player;
  const d = g.sim.fighters.find((f) => f !== p);
  return { dist: Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z).toFixed(2), dy: (d.pos.y - p.pos.y).toFixed(2), act: p.action?.id, stun: p.stun, block: p.blocking, ts: g.sim.timeStop?.t };
});
await click();
const tsLog = await untilLog((l) => l.some((e) => e.k === 'hit' && e.time > tsT0), 5000);
const firstHit = tsLog.find((e) => e.k === 'hit' && e.time > tsT0);
const tsEnd = tsLog.find((e) => e.k === 'ts' && e.phase === 'end' && e.time > tsT0);
const queuedSeen = firstHit && firstHit.q && (!tsEnd || firstHit.time < tsEnd.time) ? firstHit : null;
await shot('14-jotaro-timestop');
check('hits on frozen targets are queued while time is stopped', !!queuedSeen, JSON.stringify(firstHit) + ' pre=' + JSON.stringify(preClick) + ' log=' + JSON.stringify(tsLog.slice(-6)));
check('frozen target takes no damage before time resumes', (await st()).ts ? (await st()).others[0].hp === hpBefore : true);
await click();
s = await until((q) => !q.ts, 6000);
const tsDur = await page.evaluate(() => {
  const l = window.__sc.game.eventLog.filter((e) => e.k === 'ts');
  const st = l.filter((e) => e.phase === 'start').pop();
  const en = l.filter((e) => e.phase === 'end').pop();
  return st && en ? en.time - st.time : -1;
});
check('time resumes after 2s (Star Platinum)', !s.ts && !s.others[0].frozen && Math.abs(tsDur - 2) < 0.1, `duration=${tsDur.toFixed(2)}s`);
s = await st();
{
  const l = await log();
  const end = l.filter((e) => e.k === 'ts' && e.phase === 'end').pop();
  const release = l.find((e) => e.k === 'hit' && end && Math.abs(e.time - end.time) < 0.02 && !e.q);
  check('queued damage released as one hit when time resumes', !!release, JSON.stringify(release));
}

// pose
await until((q) => q.p.act === null, 3000);
await page.keyboard.press('KeyV');
s = await until((q) => q.p.act === 'pose', 3000);
{
  const t = await simTime();
  while ((await simTime()) - t < 0.9) await wait(30);
}
await shot('15-jotaro-pose');
check('V performs JoJo pose', s.p.act === 'pose');

// block
await page.mouse.move(640, 360);
await page.mouse.down({ button: 'right' });
const blocking = await page.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    if (window.__sc.game.player.blocking) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
});
await shot('16-block');
await page.mouse.up({ button: 'right' });
check('Right mouse blocks', blocking);

// dummy "fight back" behaviour
await page.evaluate(() => {
  const sel = document.getElementById('tr-beh');
  sel.value = 'fight';
  sel.dispatchEvent(new Event('change'));
});
s = await until((q) => q.others[0]?.char === 'rogue', 3000);
check('training dummy fight-back mode spawns sparring AI', s.others[0].char === 'rogue');

// ------------------------------------------------------------------ DIO
await start('training', 'dio');
await page.keyboard.press('KeyE');
s = await until((q) => q.p.so);
check('DIO summons The World', s.p.so);
await wait(600);
await shot('20-dio-stand');
const aimAtDummy = () =>
  page.evaluate(() => {
    const g = window.__sc.game;
    const p = g.player;
    const d = g.sim.fighters.find((f) => f !== p);
    g.rig.yaw = Math.atan2(d.pos.x - p.pos.x, d.pos.z - p.pos.z);
    g.rig.pitch = -0.05;
  });
await aimAtDummy();
await wait(200);
await page.evaluate(() => {
  const g = window.__sc.game;
  const p = g.player;
  const d = g.sim.fighters.find((f) => f !== p);
  p.pos = { x: d.pos.x, y: 0, z: d.pos.z + 10 };
});
await wait(150);
const kT0 = await simTime();
await page.keyboard.press('KeyR');
const kl = await untilLog((l) => l.some((e) => e.k === 'proj' && e.time > kT0), 4000);
s = await st();
await shot('21-dio-knives');
check('R throws knife projectiles', kl.some((e) => e.k === 'proj' && e.ab === 'knife' && e.time > kT0), `in flight now=${s.proj}`);
await until((q) => q.proj === 0, 5000);
check('knives hit the dummy at range', (await trStat('tr-last')) > 0, `last hit=${await trStat('tr-last')}`);
// evasive dash
s = await st();
const ex = s.p.x,
  ez = s.p.z;
await page.keyboard.down('KeyD');
await page.keyboard.press('ShiftLeft');
s = await until((q) => Math.hypot(q.p.x - ex, q.p.z - ez) > 5, 4000);
await page.keyboard.up('KeyD');
check('Shift (Stand out) performs Evasive Dash', Math.hypot(s.p.x - ex, s.p.z - ez) > 5, `dist=${Math.hypot(s.p.x - ex, s.p.z - ez).toFixed(1)}`);
// barrage
await approach(2.2);
await page.keyboard.press('KeyQ');
s = await until((q) => q.p.act === 'barrage', 3000);
{
  const t = await simTime();
  while ((await simTime()) - t < 0.5) await wait(30);
}
await shot('22-dio-barrage');
check('DIO MUDA barrage', s.p.act === 'barrage');
await until((q) => q.p.act === null, 4000);
// time stop 3s with knives frozen mid-air
await page.evaluate(() => {
  const p = window.__sc.game.player;
  p.energy = p.maxEnergy;
  p.cds.knives = 0;
});
await page.evaluate(() => {
  const g = window.__sc.game;
  const p = g.player;
  const d = g.sim.fighters.find((f) => f !== p);
  p.pos = { x: d.pos.x, y: 0, z: d.pos.z + 10 };
  p.vel = { x: 0, y: 0, z: 0 };
});
await wait(200);
await page.keyboard.press('KeyF');
s = await until((q) => !!q.ts, 5000);
check('ZA WARUDO stops time', !!s.ts);
await aimAtDummy();
await wait(100);
await page.keyboard.press('KeyR');
const frozenKnives = await page.evaluate(async () => {
  for (let i = 0; i < 100; i++) {
    const n = window.__sc.game.sim.projectiles.filter((p) => p.frozen).length;
    if (n >= 3) return n;
    await new Promise((r) => setTimeout(r, 50));
  }
  return 0;
});
await wait(300);
await shot('23-dio-timestop-knives');
check('knives thrown in stopped time hang in the air', frozenKnives >= 3, `frozen=${frozenKnives}`);
s = await until((q) => !q.ts, 8000);
const tsLen = await page.evaluate(() => {
  const l = window.__sc.game.eventLog.filter((e) => e.k === 'ts');
  const st = l.filter((e) => e.phase === 'start').pop();
  const en = l.filter((e) => e.phase === 'end').pop();
  return st && en ? en.time - st.time : -1;
});
check('DIO time stop lasts 3s then resumes', !s.ts && Math.abs(tsLen - 3) < 0.1, `lasted ${tsLen.toFixed(2)}s`);
const dHit = await trStat('tr-last');
check('frozen knives resume and hit when time restarts', dHit > 0, `last hit=${dHit}`);

// ------------------------------------------------------------------ Missions
await start('mission', 'jotaro', 1);
s = await st();
check('mission 1 spawns 6 Stand users', s.others.length === 6);
s = await until((q) => q.others.some((o) => o.act || Math.hypot(o.x - q.p.x, o.z - q.p.z) < 10), 10000);
await shot('30-mission1');
check('enemy AI engages', s.others.some((o) => o.act || Math.hypot(o.x - s.p.x, o.z - s.p.z) < 10));
// fast-forward: defeat everyone via the sim (verifies completion flow)
await page.evaluate(() => {
  const g = window.__sc.game;
  for (const f of g.sim.fighters) if (f !== g.player) g.sim.ko(g.player, f);
});
s = await until((q) => q.state === 'results', 8000);
check('mission complete → results screen', s.state === 'results');
await page.waitForSelector('.results h2');
const resTitle = await page.evaluate(() => document.querySelector('.results h2')?.textContent);
check('results title', resTitle === 'MISSION COMPLETE', resTitle);
await shot('31-results');
await page.click('#b-next');
s = await until((q) => q.state === 'play' && q.others.length === 5, 5000);
check('NEXT MISSION starts wave mission', s.state === 'play' && s.others.length === 5);
// clear waves
for (let w = 0; w < 3; w++) {
  await page.evaluate(() => {
    const g = window.__sc.game;
    for (const f of g.sim.fighters) if (f !== g.player && !f.dead) g.sim.ko(g.player, f);
  });
  if (w < 2) s = await until((q) => q.others.some((o) => !o.dead), 10000);
}
s = await until((q) => q.state === 'results', 8000);
check('mission 2 completes after 3 waves', s.state === 'results');
await page.waitForSelector('#b-next');
await page.click('#b-next');
s = await until((q) => q.state === 'play' && q.others.some((o) => o.char === 'dio'), 5000);
const boss = s.others.find((o) => o.char === 'dio');
check('mission 3 spawns DIO boss with boosted HP', !!boss && boss.max > 600, `boss hp=${boss?.max}`);
await page.evaluate(() => {
  const g = window.__sc.game;
  const p = g.player;
  p.hp = 99999;
  p.maxHp = 99999;
  const b = g.sim.fighters.find((f) => f.char === 'dio');
  b.pos = { x: p.pos.x, y: 0, z: p.pos.z - 5 };
  b.hp = b.maxHp * 0.6;
});
s = await until((q) => q.p.hp < 99999, 15000);
check('DIO boss attacks the player', s.p.hp < 99999, `player took ${(99999 - s.p.hp).toFixed(0)}`);
await shot('32-boss');
let sawBossTS = false;
await until((q) => (sawBossTS = sawBossTS || (!!q.ts && q.others.some((o) => o.char === 'dio' && !o.frozen))), 25000);
check('DIO boss uses time stop on the player', sawBossTS);
if (sawBossTS) await shot('33-boss-timestop');
await until((q) => !q.ts, 6000);
// death → RETIRED → retry
await page.evaluate(() => {
  const g = window.__sc.game;
  g.sim.ko(undefined, g.player);
});
s = await until((q) => q.state === 'results', 10000);
await page.waitForSelector('.results h2');
const retTitle = await page.evaluate(() => document.querySelector('.results h2')?.textContent);
check('player death fails mission (RETIRED)', s.state === 'results' && retTitle === 'RETIRED', retTitle);
await page.click('#b-retry');
s = await until((q) => q.state === 'play' && q.others.some((o) => o.char === 'dio'), 5000);
check('RETRY restarts the mission', s.state === 'play' && !s.p.dead && s.others.some((o) => o.char === 'dio'));

// ------------------------------------------------------------------ Free roam
await start('free', 'jotaro');
s = await until((q) => q.others.length >= 2, 30000);
check('free roam spawns enemies around town', s.others.length >= 2, `enemies=${s.others.length}`);
await page.evaluate(() => {
  const g = window.__sc.game;
  g.sim.ko(undefined, g.player);
});
await until((q) => q.p.dead, 2000);
await wait(500);
await shot('40-freeroam-dead');
s = await until((q) => !q.p.dead, 10000);
check('free roam respawns the player', !s.p.dead && s.p.hp === 220);

// pause menu via the Escape key
await page.keyboard.press('Escape');
await wait(400);
await shot('41-pause');
check('pause menu', (await page.evaluate(() => !!document.getElementById('b-res'))) && (await st()).state === 'paused');
await page.keyboard.press('Escape');
await wait(300);
check('Escape resumes from pause', (await st()).state === 'play');

const fps = await page.evaluate(() => window.__fps);
console.log('fps (software WebGL)', fps);
check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
await browser.close();
process.exit(failures ? 1 : 0);
