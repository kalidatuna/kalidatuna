// Full-quality screenshots of characters, Stands and key moves (for visual review / README).
// Usage: node tests/gallery.mjs [baseUrl]
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:8080';
const out = new URL('./out/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto(base + '/?test', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

/** Freeze the game loop's camera and pose fighters for a photo. */
async function photo(name, setup, settle = 2500) {
  await page.evaluate(setup);
  await page.waitForTimeout(settle);
  await page.screenshot({ path: out + name + '.png' });
  console.log('saved', name);
}

await page.evaluate(() => {
  const m = window.__sc.menus;
  m.char = 'jotaro';
  m.startLocal({ kind: 'training' });
});
await page.waitForTimeout(1500);

// Lineup of every character
await photo('60-lineup', () => {
  const g = window.__sc.game;
  g.resetSim();
  const chars = ['jotaro', 'dio', 'rogue', 'gunner', 'zombie'];
  chars.forEach((c, i) => {
    const f = g.sim.addFighter(c, { pos: { x: -11 + i * 3, y: 0, z: 14 } });
    f.yaw = 0;
    f.respawnDelay = -1;
  });
  g.player = null;
  g.state = 'results';
  g.hud.show(false);
  document.getElementById('training-panel')?.classList.add('hidden');
  const cam = g.rig.camera;
  cam.position.set(-5, 2.0, 21.5);
  cam.lookAt(-5, 1.2, 14);
});

// Jotaro + Star Platinum, pose
await photo('61-jotaro-star-platinum', () => {
  const g = window.__sc.game;
  g.resetSim();
  const f = g.sim.addFighter('jotaro', { pos: { x: -5, y: 0, z: 14 } });
  f.yaw = 0.35;
  f.standOut = true;
  f.action = { id: 'pose', t: 0, step: 0, nextHit: 0, yaw: 0, pitch: 0, landed: false };
  g.state = 'results';
  window.__poseLoop = setInterval(() => {
    for (const x of g.sim.fighters) if (x.action) x.action.t = 0.5;
  }, 50);
  const cam = g.rig.camera;
  cam.position.set(-3.6, 2.0, 19.4);
  cam.lookAt(-5.4, 1.45, 14);
});

// DIO + The World
await photo('62-dio-the-world', () => {
  const g = window.__sc.game;
  g.resetSim();
  const f = g.sim.addFighter('dio', { pos: { x: -5, y: 0, z: 14 } });
  f.yaw = 0.35;
  f.standOut = true;
  f.action = { id: 'pose', t: 0, step: 0, nextHit: 0, yaw: 0, pitch: 0, landed: false };
  g.state = 'results';
  const cam = g.rig.camera;
  cam.position.set(-3.6, 2.0, 19.4);
  cam.lookAt(-5.4, 1.45, 14);
});

// ORA rush from the side
await photo(
  '63-ora-rush-side',
  () => {
    clearInterval(window.__poseLoop);
    const g = window.__sc.game;
    g.resetSim();
    const p = g.sim.addFighter('jotaro', { pos: { x: -5, y: 0, z: 14 } });
    const d = g.sim.addFighter('rogue', { pos: { x: -5, y: 0, z: 16.6 }, team: 1 });
    d.yaw = Math.PI;
    d.maxHp = d.hp = 9999;
    p.yaw = 0;
    p.standOut = true;
    g.player = p;
    g.state = 'play';
    g.input.enabled = false;
    g.sim.input(p.id).yaw = 0;
    g.sim.tryAbility(p, 'barrage');
    g.rig.yaw = -Math.PI / 2 - 0.5;
    g.rig.pitch = -0.1;
  },
  1100,
);

await photo(
  '64-uppercut',
  () => {
    const g = window.__sc.game;
    const p = g.player;
    p.cds.uppercut = 0;
    p.energy = 100;
    p.action = null;
    g.sim.tryAbility(p, 'uppercut');
  },
  500,
);

await photo(
  '65-dio-knife-volley',
  () => {
    const g = window.__sc.game;
    g.resetSim();
    const p = g.sim.addFighter('dio', { pos: { x: -5, y: 0, z: 20 } });
    g.sim.addFighter('zombie', { pos: { x: -5, y: 0, z: 6 }, team: 1 });
    p.yaw = Math.PI;
    p.standOut = true;
    g.player = p;
    g.state = 'play';
    const inp = g.sim.input(p.id);
    inp.yaw = Math.PI;
    p.aimYaw = Math.PI;
    g.rig.yaw = Math.PI + 0.35;
    g.rig.pitch = -0.05;
    g.sim.tryAbility(p, 'knives');
  },
  420,
);

await photo(
  '66-za-warudo',
  () => {
    const g = window.__sc.game;
    g.resetSim();
    const p = g.sim.addFighter('dio', { pos: { x: -5, y: 0, z: 21 } });
    const z1 = g.sim.addFighter('zombie', { pos: { x: -6.5, y: 0, z: 12 }, team: 1 });
    const z2 = g.sim.addFighter('rogue', { pos: { x: -3, y: 0, z: 13 }, team: 1 });
    z1.yaw = z2.yaw = 0;
    z2.standOut = true;
    p.standOut = true;
    g.player = p;
    g.state = 'play';
    g.rig.snapTo(p.pos, Math.PI + 0.75);
    g.rig.pitch = -0.08;
    p.yaw = p.aimYaw = Math.PI;
    g.sim.startTimeStop(p);
    g.sim.timeStop.t = 60;
    setTimeout(() => {
      g.sim.input(p.id).yaw = Math.PI;
      p.aimYaw = Math.PI;
      g.sim.tryAbility(p, 'knives');
    }, 400);
  },
  3500,
);

await browser.close();
