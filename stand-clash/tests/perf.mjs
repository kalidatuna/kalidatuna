// Real-GPU frame-rate check + screenshots at full quality (headed Chromium, hardware WebGL).
// Plays Training, Free Roam and Mission 3 as Jotaro and DIO, then a stress scene with 8 enemies.
// Usage: node tests/perf.mjs [baseUrl] [outDir]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8080';
const out = process.argv[3] ?? new URL('./out/perf/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit', '--disable-gpu-vsync', '--window-size=1920,1080'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
await page.goto(base + '/?test', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: out + n + '.png' });
const key = async (k, ms = 60) => {
  await page.keyboard.down(k);
  await wait(ms);
  await page.keyboard.up(k);
};
const click = async () => {
  await page.mouse.move(960, 540);
  await page.mouse.down();
  await wait(40);
  await page.mouse.up();
};
const start = async (kind, char, stage) => {
  await page.evaluate(([kind, char, stage]) => {
    const m = window.__sc.menus;
    m.char = char;
    m.startLocal({ kind, stage });
  }, [kind, char, stage]);
  await wait(1500);
};
const poll = async (fn, timeout = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(fn)) return true;
    await wait(50);
  }
  return false;
};
/** Wait for the player to be free, press F, and wait until time is actually stopped. */
const timeStop = async () => {
  // Enemies can keep the player in hit-stun, so retry the key until it takes.
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) {
    await page.evaluate(() => {
      const p = window.__sc.game.player;
      p.stun = 0;
      p.cds.timestop = 0;
    });
    await key('f');
    ok = await poll(() => !!window.__sc.game.sim.timeStop, 700);
  }
  // Mobbed players get their wind-up interrupted; start it directly so the stopped look is still measured.
  if (!ok) ok = await page.evaluate(() => (window.__sc.game.sim.startTimeStop(window.__sc.game.player), !!window.__sc.game.sim.timeStop));
  await wait(700);
  if (!ok)
    console.log('  (time stop did not start)', await page.evaluate(() => {
      const g = window.__sc.game, f = g.player;
      return JSON.stringify({ act: f.action?.id, stun: f.stun, en: f.energy, cd: f.cds.timestop, frozen: f.frozen, dead: f.dead, state: g.state });
    }));
};
/** Keep the player alive so long measurements are not cut short. */
const immortal = () =>
  page.evaluate(() => {
    clearInterval(window.__imm);
    window.__imm = setInterval(() => {
      const p = window.__sc.game.player;
      if (p) { p.hp = p.maxHp; p.energy = 100; }
    }, 200);
  });
/** Sample real frame times for `ms` with rAF; also report renderer.info and fighter count. */
const measure = (ms) =>
  page.evaluate((ms) => new Promise((res) => {
    const d = [];
    let last = performance.now();
    const t0 = last;
    const step = (t) => {
      d.push(t - last);
      last = t;
      if (t - t0 < ms) requestAnimationFrame(step);
      else {
        const g = window.__sc.game;
        const s = [...d].sort((a, b) => a - b);
        const avg = d.reduce((a, b) => a + b, 0) / d.length;
        res({
          fps: Math.round(1000 / avg),
          hudFps: window.__fps,
          p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1),
          p99ms: +s[Math.floor(s.length * 0.99)].toFixed(1),
          maxMs: +s[s.length - 1].toFixed(1),
          over16_7: d.filter((x) => x > 16.7).length,
          frames: d.length,
          calls: g.renderer.info.render.calls,
          tris: g.renderer.info.render.triangles,
          fighters: g.sim.fighters.filter((f) => !f.dead).length,
        });
      }
    };
    requestAnimationFrame(step);
  }), ms);

const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), dpr: devicePixelRatio, pr: window.__sc.game.renderer.getPixelRatio() };
});
console.log('GPU', JSON.stringify(gpu));
const results = { gpu, runs: {} };
const rec = async (name, ms = 4000) => {
  const r = await measure(ms);
  results.runs[name] = r;
  console.log(name.padEnd(28), JSON.stringify(r));
  return r;
};

for (const char of ['jotaro', 'dio']) {
  // Training: summon, combo, barrage, special, time stop
  await start('training', char);
  await immortal();
  await page.evaluate(() => {
    const g = window.__sc.game, p = g.player, d = g.sim.fighters.find((f) => f !== p);
    p.pos.x = d.pos.x; p.pos.z = d.pos.z + 2.2;
    g.rig.yaw = Math.PI; g.rig.pitch = -0.1;
  });
  await wait(300);
  await key('e');
  await wait(600);
  for (let i = 0; i < 3; i++) { await click(); await wait(250); }
  await shot(`${char}-training-combo`);
  await key('q');
  await wait(500);
  await shot(`${char}-training-barrage`);
  await rec(`${char}/training-barrage`, 1500);
  await wait(1200);
  await key('r');
  await wait(400);
  await timeStop();
  await shot(`${char}-training-timestop`);
  await rec(`${char}/training-timestop`, 1500);
  await wait(2500);

  // Free roam
  await start('free', char);
  await immortal();
  await wait(1500);
  await shot(`${char}-free-roam`);
  await rec(`${char}/free-roam`);

  // Mission 3 (boss)
  await start('mission', char, 3);
  await immortal();
  await wait(1500);
  await shot(`${char}-mission3`);
  await rec(`${char}/mission3`);
}

// Stress: free roam with 8 live enemies around the player, Stand out, fighting.
for (const char of ['jotaro', 'dio']) {
  await start('free', char);
  await immortal();
  await page.evaluate(() => {
    const g = window.__sc.game, p = g.player;
    const chars = ['zombie', 'rogue', 'gunner', 'zombie', 'rogue', 'zombie', 'gunner', 'rogue'];
    chars.forEach((c, i) => {
      const a = (i / chars.length) * Math.PI * 2;
      g.spawnEnemy(c, { x: p.pos.x + Math.sin(a) * 5, y: p.pos.y, z: p.pos.z + Math.cos(a) * 5 }, { level: 0.5, name: 'Stress ' + i });
    });
  });
  await key('e');
  await wait(2500);
  await shot(`${char}-stress-8-enemies`);
  await rec(`${char}/stress-8-enemies`, 6000);
  await key('q');
  await wait(300);
  await rec(`${char}/stress-barrage`, 1500);
  await timeStop();
  await shot(`${char}-stress-timestop`);
  await rec(`${char}/stress-timestop`, 1500);
}

results.errors = errors;
writeFileSync(out + 'perf.json', JSON.stringify(results, null, 2));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no console errors');
await browser.close();
